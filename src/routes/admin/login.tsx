import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { loginAdmin } from "~/db/admin";
import { setAdminToken } from "~/lib/adminSession";
import { useAdminSession } from "~/lib/useAdminSession";

export const Route = createFileRoute("/admin/login")({
  component: AdminLoginPage,
});

/**
 * Admin login (Arvo owner superadmin + view-only analytics account). Uses the
 * SEPARATE admin session token (arvo.admin.session localStorage key) — never
 * the customer/owner token. Admins are bootstrapped from env at deploy time
 * (SUPERADMIN_EMAIL/… + ANALYTICS_EMAIL/…), so there is no self-registration
 * and no forgot-password flow (the owner resets via env + redeploy).
 */
function AdminLoginPage() {
  const navigate = useNavigate();
  const session = useAdminSession();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // An admin who is ALREADY logged in goes straight to the dashboard.
  useEffect(() => {
    if (session.status === "loading") return;
    if (session.status === "admin") {
      navigate({ to: "/admin" });
      return;
    }
    setChecking(false);
  }, [session, navigate]);

  if (checking && session.status !== "admin") {
    return (
      <div className="mx-auto max-w-md px-5 py-12 text-center text-ink-soft">
        <p className="text-xs uppercase tracking-wide text-ink-soft">Arvo analytics</p>
        <h1 className="mt-2 font-display text-2xl font-extrabold">Admin login</h1>
        <p className="mt-6">Checking your session…</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await loginAdmin({ data: { email, password } });
    setSubmitting(false);
    if (!res.ok || !res.sessionToken) {
      setError(res.error || "Login failed. Please try again.");
      return;
    }
    setAdminToken(res.sessionToken);
    navigate({ to: "/admin" });
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="card p-6">
        <p className="text-xs uppercase tracking-wide text-ink-soft">Arvo analytics</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Admin login</h1>
        <p className="mt-1 text-sm text-ink-soft">
          View-only access to the analytics dashboard — bookings, transactions and
          earnings across all mobile businesses.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="aemail">
              Email
            </label>
            <input
              id="aemail"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@arvo.com.au"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="apassword">
              Password
            </label>
            <input
              id="apassword"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

          <button className="btn w-full" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link to="/" className="hover:text-brand">
          ← Back to Arvo
        </Link>
      </p>
    </div>
  );
}