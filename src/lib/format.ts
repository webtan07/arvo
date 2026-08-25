/** Shared formatting helpers for the Arvo UI. */

export function formatAUD(cents: number): string {
  return `A$${(cents / 100).toFixed(2)}`;
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h}h ${m}m`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatSlotDate(iso: string): string {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export function formatDateTime(iso: string): string {
  return `${formatSlotDate(iso)} · ${formatTime(iso)}`;
}

export function formatCreated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
