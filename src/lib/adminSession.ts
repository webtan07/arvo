/**
 * Client-side ADMIN session token storage for Arvo — deliberately SEPARATE from
 * the customer/owner token: a different localStorage key, a different issue
 * path (loginAdmin), a different resolution path (getAdminSession /
 * resolveAdminSession) and different page guards. An admin token can never be
 * mistaken for a customer/owner token.
 */
const ADMIN_SESSION_KEY = "arvo.admin.session";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ADMIN_SESSION_KEY);
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_SESSION_KEY, token);
}

export function clearAdminToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_SESSION_KEY);
}