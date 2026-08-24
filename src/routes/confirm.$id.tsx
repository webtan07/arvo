import { createFileRoute, Link } from "@tanstack/react-router";
import { getBooking } from "~/db/server";
import { formatDateTime, formatGBP } from "~/lib/format";

export const Route = createFileRoute("/confirm/$id")({
  component: ConfirmPage,
  loader: async ({ params }) => {
    const booking = await getBooking({ data: Number(params.id) });
    return { booking };
  },
});

function ConfirmPage() {
  const { booking } = Route.useLoaderData();

  if (!booking) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className="text-lg font-semibold">Booking not found.</p>
        <Link to="/" className="btn mt-4">Browse shops</Link>
      </div>
    );
  }

  const paidOnline = booking.payment_option === "pay_online" && booking.paid;
  const payOnDay = booking.payment_option === "pay_on_day";

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="card overflow-hidden">
        <div className="bg-green-600 px-6 py-8 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-3xl">
            ✓
          </div>
          <h1 className="font-display text-2xl font-extrabold">Booking confirmed!</h1>
          <p className="mt-1 text-sm text-white/90">
            Reference{" "}
            <span className="font-bold">ARVO-{String(booking.id).padStart(4, "0")}</span>
          </p>
        </div>

        <div className="p-6">
          <dl className="space-y-3 text-sm">
            <Row label="Shop" value={booking.shopName} />
            <Row label="Service" value={booking.serviceName || "—"} />
            {booking.slotStartsAt && (
              <Row label="When" value={formatDateTime(booking.slotStartsAt)} />
            )}
            <Row label="Name" value={booking.customer_name} />
            <Row label="Email" value={booking.customer_email} />
            {booking.customer_phone && <Row label="Phone" value={booking.customer_phone} />}
            <Row
              label="Payment"
              value={
                paidOnline
                  ? `Paid online (${formatGBP(booking.priceCents ?? 0)})`
                  : payOnDay
                    ? "Pay on the day"
                    : "Payment pending"
              }
            />
          </dl>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-soft">
        {payOnDay ? (
          <p>
            Nothing was charged today — please settle with the shop on the day of
            your visit.
          </p>
        ) : paidOnline ? (
          <p>Thank you! Your card payment was successful. See you at the shop.</p>
        ) : (
          <p>Your booking is being processed. We'll confirm shortly.</p>
        )}
        <p className="mt-2">
          A confirmation email has been sent to <b>{booking.customer_email}</b>.
        </p>
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <Link to="/" className="btn">Book another</Link>
        <Link to="/shop/$slug" params={{ slug: booking.shopSlug }} className="btn-outline">
          Back to shop
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
