import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { registerOwner, type ShopSchedule } from "~/db/auth";
import { setSessionToken } from "~/lib/session";

export const Route = createFileRoute("/owner/register")({
  component: OwnerRegisterPage,
});

interface ServiceDraft {
  name: string;
  priceAu: string; // dollars as typed
  durationMin: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = (() => {
  const arr: string[] = [];
  for (let h = 0; h < 24; h++) {
    const ampm = h >= 12 ? "pm" : "am";
    const hr = (h % 12 || 12).toString();
    arr.push(`${hr}:00 ${ampm}`);
  }
  return arr;
})();

function OwnerRegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1 — identity
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 — shop details
  const [shopName, setShopName] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [openDays, setOpenDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(17);

  // Step 3 — services
  const [services, setServices] = useState<ServiceDraft[]>([
    { name: "", priceAu: "", durationMin: "" },
  ]);

  // Step 4 — photos (optional; one URL per line)
  const [photosText, setPhotosText] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const steps = ["Your details", "Shop & hours", "Services", "Photos"];

  function toggleDay(d: number) {
    setOpenDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  function updateService(i: number, field: keyof ServiceDraft, value: string) {
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  }

  const validServices = services.filter((s) => s.name.trim());
  const schedule: ShopSchedule = { openDays, startHour, endHour };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const photos = photosText
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const res = await registerOwner({
      data: {
        ownerName: ownerName.trim() || undefined,
        email,
        password,
        shop: {
          name: shopName.trim() || businessName.trim(),
          address: address.trim(),
          description: description.trim() || undefined,
          photos: photos.length ? photos : undefined,
          schedule,
        },
        services: validServices.map((s) => ({
          name: s.name.trim(),
          durationMin: Math.max(1, Number(s.durationMin) || 60),
          priceCents: Math.round((Number(s.priceAu) || 0) * 100),
        })),
      },
    });
    setSubmitting(false);
    if (!res.ok || !res.sessionToken || !res.shopSlug) {
      setError(res.error || "Registration failed. Please try again.");
      return;
    }
    setSessionToken(res.sessionToken);
    navigate({ to: "/dashboard/$slug", params: { slug: res.shopSlug } });
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-xs uppercase tracking-wide text-ink-soft">Shop owners</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold">List your shop on Arvo</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Set up your detailer profile, your services and your hours — then head
        straight to your dashboard.
      </p>

      {/* Step indicator */}
      <ol className="mt-6 flex items-center gap-2 text-xs font-semibold text-ink-soft">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                i === step
                  ? "bg-brand text-white"
                  : i < step
                    ? "bg-brand/20 text-brand"
                    : "bg-surface text-ink-soft"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? "text-ink" : ""}>{label}</span>
            {i < steps.length - 1 && <span className="text-line">—</span>}
          </li>
        ))}
      </ol>

      <form onSubmit={step < 3 ? (e) => { e.preventDefault(); setStep(step + 1); } : handleSubmit} className="mt-6">
        <div className="card space-y-4 p-6">
          {step === 0 && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="biz">
                  Business name
                </label>
                <input
                  id="biz"
                  className="input"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Shine Dog Detailing"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="oname">
                  Your name
                </label>
                <input
                  id="oname"
                  className="input"
                  autoComplete="name"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Alex Morgan"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="oemail">
                  Email
                </label>
                <input
                  id="oemail"
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourshop.com.au"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="opass">
                  Password
                </label>
                <input
                  id="opass"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
                <p className="mt-1 text-xs text-ink-soft">Min 8 characters.</p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="shopName">
                  Shop name
                </label>
                <input
                  id="shopName"
                  className="input"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder={businessName || "e.g. Shine Dog Detailing"}
                />
                <p className="mt-1 text-xs text-ink-soft">
                  Leave blank to use your business name. This is shown to customers.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="addr">
                  Street address
                </label>
                <input
                  id="addr"
                  className="input"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="14 Progress Way, Alexandria NSW 2015"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="desc">
                  About your shop <span className="font-normal text-ink-soft">(optional)</span>
                </label>
                <textarea
                  id="desc"
                  className="input min-h-20"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A one-liner about what you specialise in…"
                />
              </div>

              <div>
                <p className="mb-1 text-sm font-semibold">Open days</p>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, d) => {
                    const active = openDays.includes(d);
                    return (
                      <button
                        type="button"
                        key={label}
                        onClick={() => toggleDay(d)}
                        className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                          active
                            ? "border-brand bg-brand text-white"
                            : "border-line bg-surface text-ink-soft"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-semibold" htmlFor="startH">
                    Open from
                  </label>
                  <select
                    id="startH"
                    className="input"
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                  >
                    {HOUR_LABELS.map((l, h) => (
                      <option key={l} value={h}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold" htmlFor="endH">
                    Open until
                  </label>
                  <select
                    id="endH"
                    className="input"
                    value={endHour}
                    onChange={(e) => setEndHour(Number(e.target.value))}
                  >
                    {HOUR_LABELS.map((l, h) => (
                      <option key={l} value={h + 1} disabled={h + 1 <= startHour}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Services you offer</p>
                <button
                  type="button"
                  className="text-sm font-bold text-brand hover:text-brand-dark"
                  onClick={() => setServices((p) => [...p, { name: "", priceAu: "", durationMin: "" }])}
                >
                  + Add service
                </button>
              </div>
              <div className="space-y-3">
                {services.map((s, i) => (
                  <div key={i} className="grid grid-cols-12 items-center gap-3">
                    <input
                      className="input col-span-5"
                      value={s.name}
                      onChange={(e) => updateService(i, "name", e.target.value)}
                      placeholder="Exterior Wash & Dry"
                    />
                    <input
                      className="input col-span-3"
                      value={s.durationMin}
                      onChange={(e) => updateService(i, "durationMin", e.target.value)}
                      placeholder="mins"
                      inputMode="numeric"
                    />
                    <div className="relative col-span-3">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-soft">
                        A$
                      </span>
                      <input
                        className="input pl-8"
                        value={s.priceAu}
                        onChange={(e) => updateService(i, "priceAu", e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                      />
                    </div>
                    {services.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setServices((p) => p.filter((_, idx) => idx !== i))}
                        className="col-span-1 text-sm text-ink-soft hover:text-red-600"
                        aria-label="Remove service"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-soft">
                Add at least one service. Price is the amount charged to the customer
                when they pay online.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="photos">
                  Shop photos <span className="font-normal text-ink-soft">(optional)</span>
                </label>
                <textarea
                  id="photos"
                  className="input min-h-24"
                  value={photosText}
                  onChange={(e) => setPhotosText(e.target.value)}
                  placeholder={"One image URL per line\nhttps://…/your-shop-1.jpg\nhttps://…/your-shop-2.jpg"}
                />
                <p className="mt-1 text-xs text-ink-soft">
                  Leave blank to use the default Arvo placeholder gallery.
                </p>
              </div>

              <div className="rounded-xl bg-surface p-4 text-sm">
                <p className="mb-1 font-bold">Review</p>
                <p>
                  <span className="text-ink-soft">Shop:</span>{" "}
                  {shopName.trim() || businessName.trim() || "—"}
                </p>
                <p>
                  <span className="text-ink-soft">Hours:</span>{" "}
                  {openDays.length ? openDays.map((d) => DAY_LABELS[d]).join(", ") : "None"} ·{" "}
                  {HOUR_LABELS[startHour]}–{HOUR_LABELS[endHour - 1]}
                </p>
                <p>
                  <span className="text-ink-soft">Services:</span>{" "}
                  {validServices.length ? validServices.map((s) => s.name.trim()).join(", ") : "None yet"}
                </p>
              </div>
            </>
          )}

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          {step > 0 ? (
            <button type="button" className="btn-outline" onClick={() => setStep(step - 1)}>
              ← Back
            </button>
          ) : (
            <Link to="/owner/login" className="text-sm font-semibold text-ink-soft hover:text-brand">
              Already registered? Sign in
            </Link>
          )}
          {step < 3 ? (
            <button className="btn" type="submit">
              Continue →
            </button>
          ) : (
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? "Creating your shop…" : "Create my shop"}
            </button>
          )}
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link to="/" className="hover:text-brand">
          ← Back to browsing shops
        </Link>
      </p>
    </div>
  );
}
