import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { resetPassword } from "~/db/auth";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    kind: search.kind === "owner" ? "owner" : "customer",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token, kind } = Route.useSearch();
  const isOwner = kind === "owner";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // No (or malformed) link — nothing to validate against.
  if (!token) {
    return (
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="card p-6 text-center">
          <h1 className="font-display text-2xl font-extrabold">Invalid reset link</h1>
          <p className="mt-3 text-sm text-ink-soft">
            This reset link is missing or malformed. Please request a new one.
          </p>
          <Link
            to="/forgot-password"
            search={{ kind }}
            className="mt-5 inline-block font-bold text-brand hover:text-brand-dark"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const res = await resetPassword({ data: { token, newPassword: password, kind } });
    setSubmitting(false);
    if (!res.ok) {
      setError(
        res.error ||
          "This reset link is invalid or has expired. Please request a new one.",
      );
      return;
    }
    navigate({ to: isOwner ? "/owner/login" : "/login" });
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="card p-6">
        <p className="text-xs uppercase tracking-wide text-ink-soft">
          {isOwner ? "Shop owners" : ""}
        </p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Choose a new password</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Pick a new password (at least 8 characters) for your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="np">
              New password
            </label>
            <input
              id="np"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="np2">
              Confirm new password
            </label>
            <input
              id="np2"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              required
              minLength={8}
            />
          </div>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

          <button className="btn w-full" type="submit" disabled={submitting}>
            {submitting ? "Resetting…" : "Reset password"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-soft">
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
