/**
 * Provider-agnostic SMS/phone reminders for Arvo (server-only; never imported
 * from client code).
 *
 * Deliberately gated so the feature ships WITHOUT any SMS credentials: if
 * `SMS_PROVIDER` is unset we log a warning and the reminder falls back to email
 * only (the ~24h email reminder still goes out). When the owner adds keys the
 * ~1h reminder lights up in the same code path with no further change.
 *
 * To keep this dependency-light and portable across the dev/Bun server and the
 * Vercel Node runtime, the Twilio path is a plain REST call via global fetch
 * (no SDK, no node:crypto) and is bounded by a timeout. Unknown providers are
 * refused loudly rather than silently doing nothing.
 */
export interface SmsReminderData {
  toPhone: string;
  shopName: string;
  serviceName: string;
  /** Date/time already formatted en-AU, e.g. "Monday 25 July, 10:00 am". */
  when: string;
  address: string | null;
}
const SMS_TIMEOUT_MS = 15_000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SMS send timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function formatWhenForSms(data: SmsReminderData): string {
  return `Your ${data.serviceName} at ${data.shopName} is coming up — ${data.when}.${
    data.address ? ` Address: ${data.address}.` : ""
  } See you soon! (Arvo)`;
}
/** Send an SMS via Twilio's Messages REST API. Throws on failure. */
async function sendTwilio(data: SmsReminderData, phone: string): Promise<Response> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";
  if (!accountSid || !authToken || !from) {
    throw new Error(
      "SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM are not all set.",
    );
  }
  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: formatWhenForSms(data),
  });
  const res = await withTimeout(
    fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }),
    SMS_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}
/**
 * Send the ~1h-before appointment SMS reminder. Returns true if a message was
 * actually dispatched; false when no provider is configured (email fallback).
 * Throws only on genuine send failure (callers guard with try/catch).
 */
export async function sendSmsReminder(
  data: SmsReminderData,
): Promise<boolean> {
  const provider = process.env.SMS_PROVIDER;
  if (!provider) {
    console.warn("[arvo:sms] SMS_PROVIDER not set — skipping SMS reminder (email fallback active).");
    return false;
  }
  const p = provider.trim().toLowerCase();
  if (p === "twilio") {
    await sendTwilio(data, data.toPhone);
    console.log(`[arvo:sms] sent Twilio reminder to ${data.toPhone}`);
    return true;
  }
  console.warn(`[arvo:sms] unknown SMS_PROVIDER "${provider}" — skipping SMS reminder.`);
  return false;
}
