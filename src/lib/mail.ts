/**
 * Transactional email for Arvo (server-only; never imported from client code).
 *
 * Uses the same Gmail app-password SMTP the business already uses elsewhere
 * (admin@webdigitalassistants.com via EMAIL_USER / EMAIL_APP_PASSWORD).
 * SMTP_HOST/PORT/SECURE override the Gmail defaults (smtp.gmail.com / 465 /
 * true) when set.
 *
 * IMPORTANT — bounded await, never fire-and-forget: every send is raced against
 * a hard ~15s timeout so that in a serverless environment (where the request
 * lifecycle is the only thing keeping the function alive) a slow/hostile SMTP
 * resolves with an error instead of having its promise reaped. Callers must
 * additionally guard the send with try/catch — a mail failure must never break
 * the booking flow (see sendBookingConfirmation in db/server.ts).
 */
import nodemailer from "nodemailer";

const SEND_TIMEOUT_MS = 15_000;
const SMTP_TIMEOUT_MS = 10_000;

/** Reject `p` if it doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`SMTP send timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function senderEmail(): string {
  return process.env.EMAIL_USER || "";
}

function smtpConfig() {
  const rawSecure = process.env.SMTP_SECURE;
  const secure = rawSecure === undefined ? true : rawSecure === "true" || rawSecure === "1";
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    secure,
  };
}

function createTransporter() {
  return nodemailer.createTransport({
    host: smtpConfig().host,
    port: smtpConfig().port,
    secure: smtpConfig().secure,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    auth: {
      user: senderEmail(),
      pass: process.env.EMAIL_APP_PASSWORD || "",
    },
  });
}

export interface BookingConfirmationData {
  to: string;
  reference: string;
  shopName: string;
  serviceName: string;
  /** Date/time already formatted en-AU, e.g. "Monday 25 July, 10:00 am". */
  when: string;
  address: string | null;
}

/**
 * Send the booking confirmation email. Throws on failure — callers MUST guard
 * this with try/catch so a mail failure never blocks the booking flow.
 */
export async function sendBookingConfirmationEmail(
  data: BookingConfirmationData,
): Promise<unknown> {
  const fromUser = senderEmail();
  if (!fromUser) {
    throw new Error("EMAIL_USER is not set — cannot send confirmation email.");
  }
  if (!process.env.EMAIL_APP_PASSWORD) {
    throw new Error("EMAIL_APP_PASSWORD is not set — cannot send confirmation email.");
  }

  const when = data.when;
  const address = data.address || "";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;">
      <p style="font-size:13px;letter-spacing:.15em;color:#B45309;text-transform:uppercase;font-weight:bold;">Arvo · Car Detailing</p>
      <h1 style="font-size:24px;line-height:1.3;margin:8px 0 4px;">Your booking is confirmed</h1>
      <p style="font-size:15px;color:#4b5563;">Thanks ${data.to ? "" : ""}— we've reserved your appointment. See you at the shop!</p>
      <div style="background:#FFF7ED;border:1px solid #FDE1BC;border-radius:14px;padding:20px;margin:20px 0;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#6b7280;">Reference</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${data.reference}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Shop</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${data.shopName}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Service</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${data.serviceName}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">When</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${when}</td></tr>
          ${address ? `<tr><td style="padding:6px 0;color:#6b7280;">Address</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${address}</td></tr>` : ""}
        </table>
      </div>
      <p style="font-size:14px;color:#4b5563;">We'll email you 1 day before and text you 1 hour before your appointment.</p>
    </div>
  `.trim();

  const text = `
Arvo · Car Detailing

Your booking is confirmed.

Reference: ${data.reference}
Shop:      ${data.shopName}
Service:   ${data.serviceName}
When:      ${when}${address ? `\nAddress:   ${address}` : ""}

We'll email you 1 day before and text you 1 hour before your appointment.
  `.trim();

  const transporter = createTransporter();
  return await withTimeout(
    transporter.sendMail({
      from: `"Arvo" <${fromUser}>`,
      to: data.to,
      subject: `Your Arvo booking is confirmed — ${data.reference}`,
      html,
      text,
    }),
    SEND_TIMEOUT_MS,
  );
}
