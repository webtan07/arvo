import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { loginCustomer } from "~/db/auth";
import { setSessionToken } from "~/lib/session";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await loginCustomer({ data: { email, password } });
    setSubmitting(false);
    if (!res.ok || !res.sessionToken) {
      setError(res.error || "Login failed. Please try again.");
      return;
    }
    setSessionToken(res.sessionToken);
    navigate({ to: "/account" });
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="card p-6">
        <h1 className="font-display text-2xl font-extrabold">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Log in to view and manage your Arvo bookings.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="password">
              Password
            </label>
            <input
              id="password"
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
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-soft">
          No account?{" "}
          <Link to="/register" className="font-bold text-brand hover:text-brand-dark">
            Create one
          </Link>
        </p>
      </div>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link to="/" className="hover:text-brand">
          ← Browse shops
        </Link>
      </p>
    </div>
  );
}
