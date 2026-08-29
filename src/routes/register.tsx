import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { registerCustomer } from "~/db/auth";
import { setSessionToken } from "~/lib/session";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await registerCustomer({
      data: { name, email, password, phone: phone || undefined },
    });
    setSubmitting(false);
    if (!res.ok || !res.sessionToken) {
      setError(res.error || "Registration failed. Please try again.");
      return;
    }
    setSessionToken(res.sessionToken);
    navigate({ to: "/account" });
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="card p-6">
        <h1 className="font-display text-2xl font-extrabold">Create your account</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Save your details and manage your bookings in one place.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="input"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Morgan"
              required
            />
          </div>
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
            <p className="mt-1 text-xs text-ink-soft">Min 8 characters.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="phone">
              Phone <span className="font-normal text-ink-soft">(optional)</span>
            </label>
            <input
              id="phone"
              className="input"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0400 000 000"
            />
          </div>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

          <button className="btn w-full" type="submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-soft">
          Already have an account?{" "}
          <Link to="/login" className="font-bold text-brand hover:text-brand-dark">
            Log in
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
