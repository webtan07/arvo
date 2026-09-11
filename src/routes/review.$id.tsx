import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getReviewPage, submitReview } from "~/db/server";
import type { ReviewPageData, SubmitReviewResult } from "~/db/server";
import { getSessionToken } from "~/lib/session";
import { formatCreated } from "~/lib/format";

/**
 * Customer review page — /review/<bookingId>, the link in the "service
 * complete" email (reviewPath() in src/lib/images.ts is the single source of
 * the path). Server-enforced in db/server.ts:
 *   - the booking must exist and be status 'completed' (no review before
 *     completion — anyone hitting the link early gets a clear message),
 *   - only the booking's own customer (customer session with matching email or
 *     customer_id) can leave a review; guests are prompted to log in,
 *   - one review per booking — once a review exists the form is replaced by
 *     "You've already reviewed this service" showing the stored review.
 */
export const Route = createFileRoute("/review/$id")({
  component: ReviewPage,
});

const STAR_LABELS = ["Terrible", "Poor", "OK", "Good", "Excellent"];

/** Read-only 5-star display (filled = rating, remainder faint). */
function Stars({ rating, className = "text-lg" }: { rating: number; className?: string }) {
  const filled = "★★★★★".slice(0, rating);
  const rest = "★★★★★".slice(rating);
  return (
    <span
      className={className}
      role="img"
      aria-label={`${rating} out of 5 stars`}
      title={`${rating} out of 5 stars`}
    >
      <span className="text-amber-400">{filled}</span>
      <span className="text-ink-200">{rest}</span>
    </span>
  );
}

/**
 * Accessible keyboard-friendly star input: five visually-hidden radio inputs
 * (arrow keys select, screen readers announce "N stars — label") styled as
 * stars via Tailwind's peer-* utilities.
 */
function StarRatingInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-ink">Your rating</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((v) => (
          <label key={v} className="cursor-pointer" title={STAR_LABELS[v - 1]}>
            <input
              type="radio"
              name="rating"
              value={v}
              checked={value === v}
              onChange={() => onChange(v)}
              className="peer sr-only"
              aria-label={`${v} star${v === 1 ? "" : "s"} — ${STAR_LABELS[v - 1]}`}
            />
            <span
              className={`block px-0.5 text-3xl leading-none transition hover:scale-110 ${
                value >= v ? "text-amber-400" : "text-ink-200"
              } peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand`}
            >
              ★
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BookingSummary({
  booking,
}: {
  booking: NonNullable<ReviewPageData["booking"]>;
}) {
  return (
    <div className="card mt-6 p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-brand">
        {booking.reference}
      </p>
      <h3 className="mt-1 font-display text-lg font-extrabold">{booking.shopName}</h3>
      {booking.serviceName && <p className="text-sm text-ink-soft">{booking.serviceName}</p>}
    </div>
  );
}

function ReviewPage() {
  const { id } = Route.useParams();
  const bookingId = Number(id);
  const [token] = useState<string | null>(() => getSessionToken());
  const [data, setData] = useState<ReviewPageData | null>(null);
  const [loading, setLoading] = useState(true);

  // Review form state
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmitReviewResult | null>(null);

  useEffect(() => {
    let active = true;
    if (!Number.isFinite(bookingId)) {
      setData({ ok: false, error: "This link isn't quite right — please open it from your email." });
      setLoading(false);
      return;
    }
    (async () => {
      const res = await getReviewPage({ data: { bookingId, token: token ?? undefined } });
      if (active) {
        setData(res);
        setLoading(false);
      }
    })().catch(() => {
      if (active) {
        setData({ ok: false, error: "Couldn't load this review page. Please try again." });
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [bookingId, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError("Please pick a star rating.");
      return;
    }
    if (comment.trim().length < 10) {
      setError("Please write a short review (at least 10 characters).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitReview({
        data: { bookingId, token: token ?? undefined, rating, comment },
      });
      if (!res.ok) {
        setError(res.error || "Couldn't save your review. Please try again.");
      } else {
        setSubmitted(res);
      }
    } catch {
      setError("Couldn't save your review. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-xs uppercase tracking-wide text-ink-soft">Your feedback</p>
      <h1 className="mt-1 font-display text-3xl font-extrabold">How did we do?</h1>

      {loading ? (
        <p className="mt-6 rounded-xl bg-surface p-6 text-center text-sm text-ink-soft">
          Loading…
        </p>
      ) : !data ? null : data.error && !data.booking ? (
        /* Booking not found / not completed / bad link */
        <div className="card mt-6 p-6">
          <p className="text-ink-soft">{data.error}</p>
          <p className="mt-4">
            <Link to="/" className="btn-outline">
              ← Browse mobile services
            </Link>
          </p>
        </div>
      ) : (
        <>
          <BookingSummary booking={data.booking!} />

          {data.alreadyReviewed && data.review ? (
            /* Already reviewed — show their stored review instead of the form */
            <div className="card mt-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-lg font-extrabold">
                  You've already reviewed this service
                </p>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Stars rating={data.review.rating} className="text-xl" />
                <span className="text-sm text-ink-soft">
                  {formatCreated(data.review.created_at)}
                </span>
              </div>
              <p className="mt-3 text-ink">{data.review.comment}</p>
              <p className="mt-4">
                <Link
                  to="/shop/$slug"
                  params={{ slug: data.booking!.shopSlug }}
                  className="btn-outline"
                >
                  ← Back to {data.booking!.shopName}
                </Link>
              </p>
            </div>
          ) : !data.canReview ? (
            /* Guest (log in first) or a session that isn't the booking's customer */
            <div className="card mt-6 p-6">
              <p className="text-ink-soft">
                Only the customer who booked this service can review it.{" "}
                {token
                  ? "The sign-in you're using isn't the one used for this booking."
                  : "Log in with the email you used to book, then open this link again."}
              </p>
              {!token && (
                <p className="mt-4">
                  <Link
                    to="/login"
                    search={{ next: `/review/${bookingId}` }}
                    className="btn"
                  >
                    Log in to review
                  </Link>
                </p>
              )}
            </div>
          ) : submitted?.ok && submitted.booking && submitted.review ? (
            /* Success */
            <div className="card mt-6 p-6 text-center">
              <p className="font-display text-2xl font-extrabold text-green-700">
                Thanks for your review! 🎉
              </p>
              <div className="mt-3 flex justify-center">
                <Stars rating={submitted.review.rating} className="text-2xl" />
              </div>
              <p className="mt-3 text-sm text-ink-soft">
                Your {submitted.review.rating}-star review for{" "}
                {submitted.booking.serviceName || "your service"} at{" "}
                {submitted.booking.shopName} is live on their page.
              </p>
              <p className="mt-5">
                <Link
                  to="/shop/$slug"
                  params={{ slug: submitted.booking.shopSlug }}
                  className="btn"
                >
                  Back to {submitted.booking.shopName}
                </Link>
              </p>
            </div>
          ) : (
            /* The review form */
            <form onSubmit={handleSubmit} className="card mt-6 p-6">
              <StarRatingInput value={rating} onChange={setRating} />
              <div className="mt-5">
                <label
                  htmlFor="review-comment"
                  className="mb-1 block text-sm font-semibold text-ink"
                >
                  Your review
                </label>
                <textarea
                  id="review-comment"
                  className="input min-h-28 w-full"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What was the service like? What stood out?"
                  minLength={10}
                  maxLength={2000}
                  required
                />
                <p className="mt-1 text-xs text-ink-soft">
                  {comment.trim().length < 10
                    ? "A short review helps the business and future customers (at least 10 characters)."
                    : `${comment.length}/2000`}
                </p>
              </div>
              {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button className="btn" type="submit" disabled={submitting}>
                  {submitting ? "Posting review…" : "Post review"}
                </button>
                <Link
                  to="/shop/$slug"
                  params={{ slug: data.booking!.shopSlug }}
                  className="text-sm font-semibold text-ink-soft hover:text-brand"
                >
                  Skip — back to {data.booking!.shopName}
                </Link>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
