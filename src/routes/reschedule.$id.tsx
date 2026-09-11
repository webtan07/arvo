import { createFileRoute, Link } from "@tanstack/react-router";
import CancellationAction from "~/components/CancellationAction";
import { getSessionToken } from "~/lib/session";

/**
 * Landing page for the two links in the "your appointment was cancelled by the
 * mobile business" email. The customer picks a new time (reschedule — same
 * booking + payment) or cancels for credit (90-day credit, no card refund).
 * The ?token= search param is the single-use decision token from the email;
 * the page also accepts a logged-in session as a fallback (account page flow).
 */
export const Route = createFileRoute("/reschedule/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    action: typeof search.action === "string" ? search.action : undefined,
  }),
  component: ReschedulePage,
});

function ReschedulePage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const bookingId = Number(id);
  const token =
    search.token ||
    (typeof window !== "undefined" ? getSessionToken() : undefined) ||
    undefined;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-xs uppercase tracking-wide text-ink-soft">
        Your appointment
      </p>
      <h1 className="mt-1 font-display text-3xl font-extrabold">
        What happens next?
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        The mobile business cancelled this appointment. Your payment is safe —
        reschedule to a new time, or convert what you paid into credit.
      </p>

      <div className="mt-6">
        {Number.isFinite(bookingId) ? (
          <CancellationAction
            bookingId={bookingId}
            token={token}
            initialAction={search.action === "credit" ? "credit" : undefined}
          />
        ) : (
          <p className="rounded-xl bg-surface p-6 text-center text-sm text-ink-soft">
            This link isn't quite right — please open it from your email.
          </p>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link to="/" className="font-semibold text-brand hover:underline">
          ← Browse mobile services
        </Link>
      </p>
    </div>
  );
}
