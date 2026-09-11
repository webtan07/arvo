import { createFileRoute, Link } from "@tanstack/react-router";
import { getShop, getShopReviews } from "~/db/server";
import type { ShopReviewRow } from "~/db/server";
import { formatDuration, formatAUD, reviewerDisplayName } from "~/lib/format";
import { SmartImage } from "~/components/SmartImage";
import {
  DEFAULT_COVER,
  SHOP_GALLERIES,
  serviceImage,
  shopCoverImage,
} from "~/lib/images";

export const Route = createFileRoute("/shop/$slug")({
  component: ShopPage,
  loader: async ({ params }) => {
    const [data, reviews] = await Promise.all([
      getShop({ data: params.slug }),
      getShopReviews({ data: params.slug }),
    ]);
    return { data, reviews };
  },
});

/** Mean rating rounded to one decimal (4.75 → 4.8). */
function ratingAverage(reviews: ShopReviewRow[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Read-only 5-star display (filled = rating, remainder faint). */
function Stars({ rating }: { rating: number }) {
  return (
    <span
      className="text-sm"
      role="img"
      aria-label={`${rating} out of 5 stars`}
      title={`${rating} out of 5 stars`}
    >
      <span className="text-amber-400">{"★★★★★".slice(0, rating)}</span>
      <span className="text-ink-200">{"★★★★★".slice(rating)}</span>
    </span>
  );
}

/** Compact "★ 4.8 · 12 reviews" summary (per service + shop-wide). */
function RatingSummary({
  reviews,
  className = "",
}: {
  reviews: ShopReviewRow[];
  className?: string;
}) {
  if (reviews.length === 0) {
    return (
      <span className={`text-xs text-ink-soft ${className}`}>No reviews yet</span>
    );
  }
  const avg = ratingAverage(reviews);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <span className="text-amber-400" aria-hidden="true">
        ★
      </span>
      <span className="font-bold">{avg.toFixed(1)}</span>
      <span className="text-xs text-ink-soft">
        ({reviews.length} review{reviews.length === 1 ? "" : "s"})
      </span>
    </span>
  );
}

function ReviewCard({ r }: { r: ShopReviewRow }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold">{reviewerDisplayName(r.customer_name)}</span>
          <Stars rating={r.rating} />
        </div>
        <span className="text-xs text-ink-soft">{formatReviewDate(r.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-ink">{r.comment}</p>
    </div>
  );
}

function ShopPage() {
  const { data, reviews } = Route.useLoaderData();
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <p className="text-lg font-semibold">Mobile service not found.</p>
        <Link to="/" className="btn mt-4">
          Back to services
        </Link>
      </div>
    );
  }
  const { shop, services } = data;
  const total = ratingAverage(reviews);

  // Group reviews by service id so each service card shows its own rating and
  // the listing below can render per-service sections (reviews keep the
  // service_id even if the service row is later deleted).
  const byService = new Map<number, ShopReviewRow[]>();
  for (const r of reviews) {
    const key = r.service_id ?? -1;
    byService.set(key, [...(byService.get(key) ?? []), r]);
  }
  const orphanReviews = byService.get(-1) ?? [];

  // Real car-detailing imagery keyed by slug; fall back to a detail photo and
  // let <SmartImage> degrade to a gradient if the file isn't live yet.
  const gallery = SHOP_GALLERIES[shop.slug] ?? [
    shopCoverImage(shop.slug) ?? DEFAULT_COVER,
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      {/* Hero / gallery */}
      <div className="overflow-hidden rounded-2xl">
        {gallery.length === 1 ? (
          <SmartImage
            src={gallery[0]}
            alt={shop.name}
            className="h-64 w-full object-cover sm:h-80"
            fallbackClassName="h-64 w-full sm:h-80"
          />
        ) : (
          <div
            className={`grid gap-1 ${gallery.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
          >
            {gallery.slice(0, 3).map((p, i) => (
              <SmartImage
                key={i}
                src={p}
                alt={`${shop.name} ${i + 1}`}
                className={`w-full object-cover ${
                  gallery.length >= 3 && i === 0
                    ? "sm:row-span-2 sm:h-full"
                    : "h-40"
                }`}
                fallbackClassName={`w-full ${
                  gallery.length >= 3 && i === 0
                    ? "sm:row-span-2 sm:h-full"
                    : "h-40"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
            {shop.name}
          </h1>
          {shop.address && <p className="mt-1 text-ink-soft">{shop.address}</p>}
        </div>
        <Link to="/" className="text-sm font-semibold text-brand hover:underline">
          ← All mobile services
        </Link>
      </div>

      {shop.description && (
        <p className="mt-4 max-w-2xl text-ink-soft">{shop.description}</p>
      )}

      {/* Services */}
      <div className="mt-10">
        <h2 className="mb-5 font-display text-2xl font-bold">
          Services &amp; pricing
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <div key={s.id} className="card flex flex-col overflow-hidden p-0">
              <SmartImage
                src={serviceImage(s.slug)}
                alt={s.name}
                className="h-32 w-full object-cover"
                fallbackClassName="h-32 w-full"
                label={s.name}
              />
              <div className="flex flex-1 flex-col p-5">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg font-bold">{s.name}</h3>
                  <span className="font-display text-lg font-extrabold text-brand">
                    {formatAUD(s.price_cents)}
                  </span>
                </div>
                {s.description && (
                  <p className="flex-1 text-sm text-ink-soft">{s.description}</p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="chip bg-surface text-ink-soft">
                      {formatDuration(s.duration_min)}
                    </span>
                    <RatingSummary reviews={byService.get(s.id) ?? []} />
                  </div>
                  <Link
                    to="/book"
                    search={{ shop: shop.slug, service: s.slug }}
                    className="btn"
                  >
                    Book
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Customer reviews */}
      <div className="mt-12">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold">Customer reviews</h2>
          {reviews.length > 0 && (
            <span className="chip bg-amber-50 text-amber-700">
              ★ {total.toFixed(1)} · {reviews.length} review
              {reviews.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {reviews.length === 0 ? (
          <p className="mt-4 rounded-xl bg-surface p-6 text-center text-sm text-ink-soft">
            No reviews yet — be the first to leave one after your service.
          </p>
        ) : (
          <div className="mt-5 space-y-8">
            {services.map((s) => {
              const svcReviews = byService.get(s.id) ?? [];
              if (svcReviews.length === 0) return null;
              return (
                <section key={s.id}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 className="font-display text-lg font-bold">{s.name}</h3>
                    <RatingSummary reviews={svcReviews} />
                  </div>
                  <div className="grid gap-3">
                    {svcReviews.map((r) => (
                      <ReviewCard key={r.id} r={r} />
                    ))}
                  </div>
                </section>
              );
            })}
            {orphanReviews.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="font-display text-lg font-bold">Other services</h3>
                  <RatingSummary reviews={orphanReviews} />
                </div>
                <div className="grid gap-3">
                  {orphanReviews.map((r) => (
                    <ReviewCard key={r.id} r={r} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
