/**
 * Shared small UI pieces for the /admin analytics dashboard (Phase B part 5).
 * Kept deliberately tiny: status pills + the status label/color maps, matching
 * the dashboard's chip conventions (src/styles/app.css .chip).
 */

/** Human label for booking + transaction status values. */
export function adminStatusLabel(s: string): string {
  switch (s) {
    case "completed":
      return "Completed";
    case "confirmed":
    case "paid":
      return "Paid";
    case "pending":
      return "Pending";
    case "awaiting_payment":
      return "Awaiting payment";
    case "cancellation_pending":
      return "Customer choosing";
    case "rescheduled":
      return "Rescheduled";
    case "cancelled":
      return "Cancelled";
    case "credited":
      return "Credited";
    default:
      return s;
  }
}

export function adminStatusBadgeClass(s: string): string {
  switch (s) {
    case "completed":
      return "bg-green-100 text-green-700";
    case "confirmed":
    case "paid":
      return "bg-green-50 text-green-700";
    case "cancelled":
    case "credited":
      return "bg-surface text-ink-soft";
    case "cancellation_pending":
      return "bg-amber-100 text-amber-700";
    case "awaiting_payment":
    case "pending":
      return "bg-amber-50 text-amber-700";
    case "rescheduled":
      return "bg-sky-100 text-sky-700";
    default:
      return "bg-surface text-ink-soft";
  }
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`chip ${adminStatusBadgeClass(status)}`}>
      {adminStatusLabel(status)}
    </span>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs text-ink-soft">—</span>;
  return (
    <span className="font-semibold text-amber-600" title={`${rating.toFixed(1)} / 5`}>
      {"★".repeat(Math.round(rating))}
      <span className="text-ink-soft">
        {"★".repeat(5 - Math.round(rating))} {rating.toFixed(1)}
      </span>
    </span>
  );
}