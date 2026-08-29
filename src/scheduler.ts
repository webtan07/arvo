/**
 * Booking reminder scheduler (server-only; never imported from client code).
 *
 * Wires `runReminderJob` into a node-cron schedule that fires every 15 minutes.
 * The sweep itself is wrapped in a top-level try/catch and, more importantly,
 * each per-booking send inside `runReminderJob` is individually guarded — so a
 * transient DB/mail/SMS error never crashes the process or aborts the run.
 *
 * The scheduler is only started (and the very first run kicked off) when a real
 * server boots (see serve.ts). In serverless (Vercel) the per-request lifecycle
 * means cron doesn't persist, so this guards against being started twice and
 * unrefs the interval so it never keeps a process alive on its own.
 */
import cron from "node-cron";
import { runReminderJob } from "./lib/reminders";

const REMINDER_CRON = process.env.REMINDER_CRON || "*/15 * * * *";
export const REMINDER_ENABLED =
  (process.env.REMINDERS_ENABLED ?? "true").toLowerCase() !== "false";

let started = false;
let task: { stop: () => void } | null = null;

async function safeRun(): Promise<void> {
  try {
    const summary = await runReminderJob();
    if (summary.emailsSent || summary.smsSent || summary.emailFallbacks) {
      console.log(
        `[arvo:reminders] sweep ok — scanned=${summary.scanned} ` +
          `email24h=${summary.emailsSent} sms1h=${summary.smsSent} ` +
          `emailFallback1h=${summary.emailFallbacks} failed=${summary.failed}`,
      );
    }
  } catch (e) {
    console.error(
      "[arvo:reminders] sweep failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Start the reminder cron. Safe to call more than once (only the first call
 * registers the schedule). Does nothing when REMINDERS_ENABLED=false.
 */
export function startScheduler(): void {
  if (started || !REMINDER_ENABLED) {
    if (!REMINDER_ENABLED) {
      console.log("[arvo:reminders] REMINDERS_ENABLED=false — scheduler disabled.");
    }
    return;
  }
  started = true;
  try {
    task = cron.schedule(REMINDER_CRON, () => {
      void safeRun();
    }, {
      name: "arvo-booking-reminders",
      unref: true,
    });
    console.log(`[arvo:reminders] scheduler started (cron "${REMINDER_CRON}").`);
    // Run once immediately at boot so reminders don't wait up to 15 min.
    void safeRun();
  } catch (e) {
    started = false;
    console.error(
      "[arvo:reminders] failed to start scheduler:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Stop the scheduler (used by tests / shutdown). */
export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
  started = false;
}
