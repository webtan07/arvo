import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <nav className="flex items-center justify-between py-4">
        <span className="font-display text-2xl font-bold">Arvo</span>
        <span className="text-sm text-ink-soft">Car detailing · booking</span>
      </nav>

      <section className="py-14 text-center">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-brand">
          Car detail · ceramic · interior
        </p>
        <h1 className="font-display text-5xl font-bold leading-tight sm:text-6xl">
          Book your <span className="text-brand">detail</span>, not your time.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft">
          Arvo is a booking web app for car-detailing shops. Pick a shop, choose
          a service, and grab a slot — no phone tag, no back-and-forth.
        </p>
        <div className="mt-8">
          <span className="rounded-full bg-brand px-6 py-3 font-semibold text-white">
            Booking coming soon
          </span>
        </div>
      </section>

      <footer className="border-t border-line pt-6 text-center text-sm text-ink-soft">
        Arvo — scaffold preview. Shop / service / slot / booking flow is the next step.
      </footer>
    </main>
  );
}
