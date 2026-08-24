import { Link, createFileRoute } from "@tanstack/react-router";
import { listShops } from "~/db/server";

export const Route = createFileRoute("/")({
  component: HomePage,
  loader: async () => {
    try {
      const shops = await listShops();
      return { shops };
    } catch (e) {
      return { shops: [], error: e instanceof Error ? e.message : String(e) };
    }
  },
});

const LOGO = "/logo/F950D59B-C1EE-49E6-A524-065C166C61CD.JPG";

function HomePage() {
  const { shops, error } = Route.useLoaderData();

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand/10 to-paper">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:py-20">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-brand">
            Car detail · ceramic · interior
          </p>
          <h1 className="mx-auto max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-6xl">
            Book your <span className="text-brand">detail</span>, not your time.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-soft">
            Arvo is a home for the best car-detailing shops. Pick a shop, choose a
            service and grab a slot — pay online or on the day.
          </p>
        </div>
      </section>

      {/* Shops */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">Featured detailers</h2>
          <span className="text-sm text-ink-soft">
            {shops ? `${shops.length} shops` : "…"}
          </span>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            Could not load shops: {error}
          </p>
        )}

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shops.map((shop) => (
            <Link
              key={shop.slug}
              to="/shop/$slug"
              params={{ slug: shop.slug }}
              className="card group overflow-hidden transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="h-44 overflow-hidden bg-surface">
                <img
                  src={shop.photos?.[0] || LOGO}
                  alt={shop.name}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="p-5">
                <h3 className="mb-1 font-display text-xl font-bold">{shop.name}</h3>
                {shop.address && (
                  <p className="mb-2 text-sm text-ink-soft">{shop.address}</p>
                )}
                <p className="mb-4 text-sm text-ink-soft line-clamp-2">
                  {shop.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="chip bg-brand/10 text-brand">
                    {shop.serviceCount ?? 0} services
                  </span>
                  <span className="text-sm font-bold text-brand group-hover:underline">
                    View &amp; book →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {shops.length === 0 && !error && (
          <p className="rounded-xl bg-surface p-6 text-center text-ink-soft">
            No shops yet — seed data hasn't been applied.
          </p>
        )}
      </section>
    </div>
  );
}
