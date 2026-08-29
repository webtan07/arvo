/**
 * Booking reminder engine (server-only; never imported from client code).
 *
 * One idempotent sweep (`runReminderJob`) that the scheduler calls every ~15
 * minutes. It finds *future, non-cancelled* appointments and sends each channel
 * exactly once:
 *
 *   - ~24h before  → reminder EMAIL (tracked in `reminder_email_sent_at`)
 *   - ~1h before   → SMS if a provider is configured (tracked in
 *                    `reminder_sms_sent_at`), otherwise an email fallback.
 *
 * Every booking is processed inside its own try/catch so one failure (a dead
 * SMTP host, a missing env var, a bad phone number) never stops the rest of the
 * run. Columns are stamped only AFTER a send succeeds, which makes re-runs safe
 * and prevents duplicate sends. Call this function directly for testing.
 */
import { sql } from "../db/connection";
import { ensureSchema } from "../db/schema";
import { sendBookingReminderEmail } from "./mail";
import { sendSmsReminder } from "./sms";

/** How far ahead each channel fires (with a slack buffer for cron frequency). */
const EMAIL_AHEAD_MAX_MS = 26 * 60 * 60 * 1000; // 26h — first tick picks it up ~24h out
const EMAIL_AHEAD_MIN_MS = 2 * 60 * 60 * 1000; // don't email someone <2h out (the 1h channel owns that)
const SMS_AHEAD_MAX_MS = 2 * 60 * 60 * 1000; // 2h — first tick picks it up ~1h out

interface BookingRow {
  id: number;
  customer_email: string;
  customer_phone: string | null;
  shop_name: string;
  shop_address: string | null;
  service_name: string | null;
  slot_starts: Date | string;
}

function reference(id: number): string {
  return `ARVO-${String(id).padStart(4, "0")}`;
}

function formatWhen(starts: Date | string): string {
  const d = starts instanceof Date ? starts : new Date(starts);
  return d.toLocaleString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Pick the bookings that still need a reminder, with their appointment time. */
async function loadDueBookings(): Promise<BookingRow[]> {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT
      b.id, b.customer_email, b.customer_phone,
      s.name AS shop_name, s.address AS shop_address,
      sv.name AS service_name,
      sl.starts_at AS slot_starts
    FROM arvo.bookings b
    JOIN arvo.shops s ON s.id = b.shop_id
    LEFT JOIN arvo.services sv ON sv.id = b.service_id
    LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
    WHERE b.status <> 'cancelled'
      AND sl.starts_at IS NOT NULL
      AND sl.starts_at > now()
    ORDER BY sl.starts_at ASC
  `;
  return (rows as Record<string, unknown>[]).map((r) => {
    const anyR = r as unknown as BookingRow;
    return anyR;
  });
}

async function stamp(bookingId: number, column: "reminder_email_sent_at" | "reminder_sms_sent_at"): Promise<void> {
  const db = sql();
  await db`UPDATE arvo.bookings SET ${db.unsafe(`${column}`)} = now() WHERE id = ${bookingId}`;
}

interface ReminderSummary {
  scanned: number;
  emailsSent: number;
  smsSent: number;
  emailFallbacks: number;
  failed: number;
}

/** Run one full reminder sweep. Returns a summary for logging/tests. */
export async function runReminderJob(): Promise<ReminderSummary> {
  const summary: ReminderSummary = {
    scanned: 0,
    emailsSent: 0,
    smsSent: 0,
    emailFallbacks: 0,
    failed: 0,
  };
  const bookings = await loadDueBookings();
  summary.scanned = bookings.length;
  const now = Date.now();

  for (const b of bookings) {
    const starts = b.slot_starts instanceof Date ? b.slot_starts : new Date(b.slot_starts);
    const tAhead = starts.getTime() - now;

    /* ── ~24h email ─────────────────────────────────────────────── */
    try {
      const dueEmail =
        tAhead > EMAIL_AHEAD_MIN_MS && tAhead < EMAIL_AHEAD_MAX_MS;
      const emailRows = await sql()`
        SELECT reminder_email_sent_at FROM arvo.bookings WHERE id = ${b.id}
      `;
      const emailSent =
        (emailRows[0] as { reminder_email_sent_at: Date | null } | undefined)
          ?.reminder_email_sent_at != null;
      if (dueEmail && !emailSent) {
        await sendBookingReminderEmail({
          to: b.customer_email,
          reference: reference(b.id),
          shopName: b.shop_name,
          serviceName: b.service_name || "Car detailing",
          when: formatWhen(starts),
          address: b.shop_address,
          soonLabel: "tomorrow",
        });
        await stamp(b.id, "reminder_email_sent_at");
        summary.emailsSent += 1;
      }
    } catch (e) {
      summary.failed += 1;
      console.error(
        `[arvo:reminders] 24h email failed for booking ${b.id}:`,
        e instanceof Error ? e.message : e,
      );
    }

    /* ── ~1h SMS (or email fallback) ────────────────────────────── */
    try {
      const dueSms = tAhead > 0 && tAhead < SMS_AHEAD_MAX_MS;
      const smsRows = await sql()`
        SELECT reminder_sms_sent_at FROM arvo.bookings WHERE id = ${b.id}
      `;
      const smsSent =
        (smsRows[0] as { reminder_sms_sent_at: Date | null } | undefined)
          ?.reminder_sms_sent_at != null;
      if (dueSms && !smsSent) {
        const dispatched = await sendSmsReminder({
          toPhone: b.customer_phone || "",
          shopName: b.shop_name,
          serviceName: b.service_name || "Car detailing",
          when: formatWhen(starts),
          address: b.shop_address,
        });
        if (dispatched) {
          await stamp(b.id, "reminder_sms_sent_at");
          summary.smsSent += 1;
        } else if (b.customer_email) {
          // No SMS provider configured → email fallback for the ~1h reminder.
          await sendBookingReminderEmail({
            to: b.customer_email,
            reference: reference(b.id),
            shopName: b.shop_name,
            serviceName: b.service_name || "Car detailing",
            when: formatWhen(starts),
            address: b.shop_address,
            soonLabel: "in about an hour",
          });
          await stamp(b.id, "reminder_sms_sent_at");
          summary.emailFallbacks += 1;
        }
      }
    } catch (e) {
      summary.failed += 1;
      console.error(
        `[arvo:reminders] 1h reminder failed for booking ${b.id}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return summary;
}
