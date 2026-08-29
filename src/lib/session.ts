/**
 * Client-side session token storage for Arvo. The backend issues an opaque
 * session token (see src/db/auth.ts); this module persists it in localStorage
 * and reads it back for authenticated calls (getSessionUser, getMyBookings,
 * logout). Guest bookings simply have no token stored.
 */
const SESSION_KEY = "arvo.session";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}
