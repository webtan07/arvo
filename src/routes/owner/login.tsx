import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { loginOwner } from "~/db/auth";
import { getOwnerShop } from "~/db/server";
import { setSessionToken } from "~/lib/session";

export const Route = createFileRoute("/owner/login")({
  component: OwnerLoginPage,
});

function OwnerLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noShop, setNoShop] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNoShop(false);
    const res = await loginOwner({ data: { email, password } });
    if (!res.ok || !res.sessionToken) {
      setSubmitting(false);
      setError(res.error || "Login failed. Please try again.");
      return;
    }
    setSessionToken(res.sessionToken);
    const shop = await getOwnerShop({ data: res.sessionToken });
    setSubmitting(false);
    if (shop) {
      navigate({ to: "/dashboard/$slug", params: { slug: shop.slug } });
    } else {
      // Owner has no shop yet (shouldn't normally happen — registration creates
      // one) — point them at shop setup.
      setNoShop(true);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="card p-6">
        <p className="text-xs uppercase tracking-wide text-ink-soft">Shop owners</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Owner login</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Sign in to manage your shop's dashboard and bookings.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
            <label className="mb-1 block text-sm font-semibold" htmlFor="opassword">
              Password
            </label>
            <input
              id="opassword"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            <div className="mt-1 text-right">
              <Link
                to="/forgot-password"
                search={{ kind: "owner" }}
                className="text-xs font-semibold text-brand hover:text-brand-dark"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          {noShop && (
            <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-700">
              Your account doesn't have a shop yet.{" "}
              <Link to="/owner/register" className="font-bold underline">
                Set up your shop
              </Link>
              .
            </p>
          )}

          <button className="btn w-full" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-soft">
          New to Arvo?{" "}
          <Link to="/owner/register" className="font-bold text-brand hover:text-brand-dark">
            Register your shop
          </Link>
        </p>
      </div>

      <div className="mt-6 text-center text-sm text-ink-soft">
        <Link to="/login" className="hover:text-brand">
          Customer login
        </Link>{" "}
        ·{" "}
        <Link to="/" className="hover:text-brand">
          Browse shops
        </Link>
      </div>
    </div>
  );
}
