import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { requestPasswordReset } from "~/db/auth";

export const Route = createFileRoute("/forgot-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: search.kind === "owner" ? "owner" : "customer",
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { kind } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const isOwner = kind === "owner";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await requestPasswordReset({ data: { email, kind } });
    setSubmitting(false);
    // Ignore the response — we always show the same confirmation to prevent
    // account enumeration.
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="card p-6 text-center">
          <h1 className="font-display text-2xl font-extrabold">Check your email</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            If an account exists for <span className="font-semibold text-ink">{email}</span>,
            we've sent a password-reset link. It expires in 40 minutes and can only be
            used once.
          </p>
          <Link
            to={isOwner ? "/owner/login" : "/login"}
            className="mt-5 inline-block font-bold text-brand hover:text-brand-dark"
          >
            Back to {isOwner ? "owner" : ""} login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="card p-6">
        <h1 className="font-display text-2xl font-extrabold">Forgot your password?</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Enter the email on your {isOwner ? "shop owner" : ""} account and we'll email you a
          reset link.
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

          <button className="btn w-full" type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-soft">
          Remembered it?{" "}
          <Link
            to={isOwner ? "/owner/login" : "/login"}
            className="font-bold text-brand hover:text-brand-dark"
          >
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
