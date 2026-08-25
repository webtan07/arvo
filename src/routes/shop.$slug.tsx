import { createFileRoute, Link } from "@tanstack/react-router";
import { getShop } from "~/db/server";
import { formatDuration, formatGBP } from "~/lib/format";
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
    const data = await getShop({ data: params.slug });
    return { data };
  },
});

function ShopPage() {
  const { data } = Route.useLoaderData();
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <p className="text-lg font-semibold">Shop not found.</p>
        <Link to="/" className="btn mt-4">
          Back to shops
        </Link>
      </div>
    );
  }
  const { shop, services } = data;

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
          ← All shops
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
                    {formatGBP(s.price_cents)}
                  </span>
                </div>
                {s.description && (
                  <p className="flex-1 text-sm text-ink-soft">{s.description}</p>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <span className="chip bg-surface text-ink-soft">
                    {formatDuration(s.duration_min)}
                  </span>
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
    </div>
  );
}
