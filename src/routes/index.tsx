import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { listShops } from "~/db/server";
import { SmartImage } from "~/components/SmartImage";
import { shopCoverImage } from "~/lib/images";
import type { ShopRow } from "~/db/server";

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

function matchesQuery(shop: ShopRow, q: string): boolean {
  const haystack = [
    shop.name,
    shop.address ?? "",
    shop.description ?? "",
    ...(shop.services ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function HomePage() {
  const { shops, error } = Route.useLoaderData();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) => matchesQuery(s, q));
  }, [shops, query]);

  const topPicks = useMemo(() => shops.slice(0, 3), [shops]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const el = document.getElementById("shops-list");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      {/* ── HERO + search widget ─────────────────────────────── */}
      <section className="bg-gradient-to-b from-brand/10 to-paper">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:py-20">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-brand">
            Car detail · ceramic · interior
          </p>
          <h1 className="mx-auto max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-6xl">
            Book your <span className="text-brand">detail</span>, not your time.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-soft">
            Arvo is a home for the best car-detailing shops. Pick a shop, choose
            a service and grab a slot — pay online or on the day.
          </p>

          {/* Prominent, centered search widget */}
          <form
            onSubmit={handleSearch}
            className="mx-auto mt-9 flex w-full max-w-2xl items-stretch gap-2 rounded-2xl border border-line bg-paper p-2 shadow-lg shadow-brand/5"
          >
            <div className="flex flex-1 items-center gap-2 pl-3">
              <svg
                className="h-5 w-5 shrink-0 text-ink-soft"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                />
              </svg>
              <input
                type="search"
                className="w-full border-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-soft"
                placeholder="Search by shop, town or service (e.g. ceramic, valet)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search shops"
              />
            </div>
            <button type="submit" className="btn shrink-0 whitespace-nowrap">
              Search
            </button>
          </form>
          <p className="mt-3 text-sm text-ink-soft">
            {submitted
              ? `${filtered.length} ${filtered.length === 1 ? "shop" : "shops"} match "${
                  query.trim() || "all"
                }"`
              : `${shops.length} detailers across the UK — book in under a minute.`}
          </p>
        </div>
      </section>

      {/* ── TOP RECOMMENDATIONS ─────────────────────────────── */}
      {topPicks.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-12">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Top recommendations</h2>
            <span className="text-sm text-ink-soft">Hand-picked for you</span>
          </div>
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2">
            {topPicks.map((shop) => (
              <Link
                key={shop.slug}
                to="/shop/$slug"
                params={{ slug: shop.slug }}
                className="group w-72 shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-paper transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="relative">
                  <SmartImage
                    src={shopCoverImage(shop.slug)}
                    alt={shop.name}
                    className="h-40 w-full object-cover transition group-hover:scale-105"
                    fallbackClassName="h-40 w-full"
                  />
                  <span className="chip absolute left-3 top-3 bg-white/90 text-brand shadow-sm">
                    ★ Recommended
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="font-display text-lg font-bold">{shop.name}</h3>
                  {shop.address && (
                    <p className="mt-0.5 truncate text-sm text-ink-soft">
                      {shop.address}
                    </p>
                  )}
                  <span className="chip mt-3 bg-brand/10 text-brand">
                    {shop.serviceCount ?? 0} services
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── SHOPS LIST (searchable) ─────────────────────────── */}
      <section id="shops-list" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-20">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">All detailers</h2>
          <span className="text-sm text-ink-soft">
            {filtered.length} {filtered.length === 1 ? "shop" : "shops"}
            {query.trim() ? " found" : ""}
          </span>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            Could not load shops: {error}
          </p>
        )}

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((shop) => (
            <Link
              key={shop.slug}
              to="/shop/$slug"
              params={{ slug: shop.slug }}
              className="card group overflow-hidden transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="h-44 overflow-hidden bg-surface">
                <SmartImage
                  src={shopCoverImage(shop.slug) ?? shop.photos?.[0]}
                  alt={shop.name}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  fallbackClassName="h-full w-full"
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

        {filtered.length === 0 && !error && (
          <p className="rounded-xl bg-surface p-6 text-center text-ink-soft">
            No shops match “{query}”. Try a different search.
          </p>
        )}

        {shops.length === 0 && !error && (
          <p className="rounded-xl bg-surface p-6 text-center text-ink-soft">
            No shops yet — seed data hasn't been applied.
          </p>
        )}
      </section>
    </div>
  );
}
