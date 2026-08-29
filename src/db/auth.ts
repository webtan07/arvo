/**
 * Auth server functions for Arvo — customer & owner accounts + opaque session
 * tokens. Server-only (imported by server functions / API routes, never from
 * client components).
 *
 * Password hashing: node:crypto scrypt with a random per-user salt; stored as
 * `salt:hash` (hex). Comparison uses timingSafeEqual.
 *
 * Session tokens: a random 32-byte base64url string is issued to the client; only
 * its SHA-256 hex is stored in `sessions.token_hash`, so a leaked DB can never
 * be replayed. Tokens expire after 30 days.
 *
 * Auth errors are deliberately generic ("Incorrect email or password") to avoid
 * user enumeration — we never reveal whether an email exists.
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "./connection";
import { ensureSchema } from "./schema";
import { scryptSync, randomBytes, createHash, timingSafeEqual } from "node:crypto";

const SESSION_DAYS = 30;

export type UserRole = "customer" | "owner";

export interface SessionUser {
  role: UserRole;
  id: number;
  email: string;
  name: string | null;
  shopId?: number | null;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  sessionToken?: string;
}

/* ── password hashing ─────────────────────────────────────────── */

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/* ── sessions ─────────────────────────────────────────────────── */

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

async function insertSession(
  token: string,
  role: UserRole,
  userId: number,
): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO arvo.sessions (token_hash, user_role, user_id, expires_at)
    VALUES (${tokenHash(token)}, ${role}, ${userId}, ${sessionExpiry()})
  `;
}

/* ── customers ────────────────────────────────────────────────── */

/** Register a new customer account. Returns an opaque session token. */
export const registerCustomer = createServerFn()
  .validator((d: { email: string; password: string; name: string; phone?: string }) => d)
  .handler(
    async ({ data }): Promise<AuthResult> => {
      await ensureSchema();
      const db = sql();
      const email = data.email.trim().toLowerCase();
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return { ok: false, error: "Please enter a valid email address." };
      }
      if (!data.password || data.password.length < 8) {
        return { ok: false, error: "Password must be at least 8 characters." };
      }
      const existing = await db`SELECT id FROM arvo.customers WHERE email = ${email}`;
      if (existing.length > 0) {
        return { ok: false, error: "An account with this email already exists." };
      }
      const inserted = await db`
        INSERT INTO arvo.customers (email, password_hash, name, phone)
        VALUES (${email}, ${hashPassword(data.password)}, ${data.name || null}, ${data.phone || null})
        RETURNING id
      `;
      const id = Number((inserted[0] as { id: number }).id);
      const token = newSessionToken();
      await insertSession(token, "customer", id);
      return { ok: true, sessionToken: token };
    },
  );

/** Log in an existing customer. Generic error on any mismatch. */
export const loginCustomer = createServerFn()
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    await ensureSchema();
    const db = sql();
    const email = data.email.trim().toLowerCase();
    const rows = await db`
      SELECT id, password_hash, name FROM arvo.customers WHERE email = ${email}
    `;
    const row = rows[0] as { id: number; password_hash: string; name: string | null } | undefined;
    if (!row || !verifyPassword(data.password, row.password_hash)) {
      return { ok: false, error: "Incorrect email or password." };
    }
    const token = newSessionToken();
    await insertSession(token, "customer", Number(row.id));
    return { ok: true, sessionToken: token };
  });

/* ── owners ───────────────────────────────────────────────────── */

/** Slugify a shop name (lowercase, hyphens). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "shop";
}

/** Existing /img placeholders used as the default gallery for new shops. */
const DEFAULT_SHOP_PHOTOS = ["/img/shop-1.jpg", "/img/full-detail.jpg", "/img/ceramic.jpg"];

/**
 * Register a new owner account + their linked shop row (slug auto-generated
 * from the shop name; photos default to the existing /img placeholders).
 * Returns an opaque session token.
 */
export const registerOwner = createServerFn()
  .validator(
    (d: {
      email: string;
      password: string;
      shop: { name: string; address: string; description?: string; photos?: string[] };
    }) => d,
  )
  .handler(async ({ data }): Promise<AuthResult> => {
    await ensureSchema();
    const db = sql();
    const email = data.email.trim().toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    if (!data.password || data.password.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters." };
    }
    if (!data.shop.name || !data.shop.address) {
      return { ok: false, error: "Shop name and address are required." };
    }
    const existing = await db`SELECT id FROM arvo.owners WHERE email = ${email}`;
    if (existing.length > 0) {
      return { ok: false, error: "An account with this email already exists." };
    }

    // Build a unique slug for the shop.
    const base = slugify(data.shop.name);
    let slug = base;
    let n = 1;
    for (;;) {
      const clash = await db`SELECT id FROM arvo.shops WHERE slug = ${slug}`;
      if (clash.length === 0) break;
      slug = `${base}-${n++}`;
    }

    const shop = await db`
      INSERT INTO arvo.shops (slug, name, address, photos, description)
      VALUES (${slug}, ${data.shop.name}, ${data.shop.address},
              ${JSON.stringify(data.shop.photos?.length ? data.shop.photos : DEFAULT_SHOP_PHOTOS)}::jsonb,
              ${data.shop.description || null})
      RETURNING id
    `;
    const shopId = Number((shop[0] as { id: number }).id);

    const owner = await db`
      INSERT INTO arvo.owners (email, password_hash, shop_id)
      VALUES (${email}, ${hashPassword(data.password)}, ${shopId})
      RETURNING id
    `;
    const ownerId = Number((owner[0] as { id: number }).id);

    const token = newSessionToken();
    await insertSession(token, "owner", ownerId);
    return { ok: true, sessionToken: token };
  });

/** Log in an existing owner. Generic error on any mismatch. */
export const loginOwner = createServerFn()
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    await ensureSchema();
    const db = sql();
    const email = data.email.trim().toLowerCase();
    const rows = await db`
      SELECT id, password_hash, shop_id FROM arvo.owners WHERE email = ${email}
    `;
    const row =
      rows[0] as { id: number; password_hash: string; shop_id: number | null } | undefined;
    if (!row || !verifyPassword(data.password, row.password_hash)) {
      return { ok: false, error: "Incorrect email or password." };
    }
    const token = newSessionToken();
    await insertSession(token, "owner", Number(row.id));
    return { ok: true, sessionToken: token };
  });

/* ── shared session ops ───────────────────────────────────────── */

/** Revoke a session token (logout). */
export const logout = createServerFn()
  .validator((d: string) => d)
  .handler(async ({ data: token }): Promise<boolean> => {
    if (!token) return false;
    const db = sql();
    await db`DELETE FROM arvo.sessions WHERE token_hash = ${tokenHash(token)}`;
    return true;
  });

/**
 * Resolve a session token → user, verifying it exists, is unexpired, and the
 * referenced user still exists. Returns null for invalid/expired tokens.
 */
export const getSessionUser = createServerFn()
  .validator((d: string) => d)
  .handler(async ({ data: token }): Promise<SessionUser | null> => {
    if (!token) return null;
    await ensureSchema();
    const db = sql();
    const rows = await db`
      SELECT s.user_role, s.user_id, s.expires_at
      FROM arvo.sessions s
      WHERE s.token_hash = ${tokenHash(token)}
    `;
    const s = rows[0] as { user_role: UserRole; user_id: number; expires_at: Date } | undefined;
    if (!s) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) return null;

    const userId = Number(s.user_id);
    if (s.user_role === "customer") {
      const c = await db`
        SELECT id, email, name FROM arvo.customers WHERE id = ${userId}
      `;
      if (c.length === 0) return null;
      const row = c[0] as { id: number; email: string; name: string | null };
      return { role: "customer", id: Number(row.id), email: row.email, name: row.name };
    }

    const o = await db`
      SELECT id, email, shop_id FROM arvo.owners WHERE id = ${userId}
    `;
    if (o.length === 0) return null;
    const row = o[0] as { id: number; email: string; shop_id: number | null };
    return {
      role: "owner",
      id: Number(row.id),
      email: row.email,
      name: null,
      shopId: row.shop_id == null ? null : Number(row.shop_id),
    };
  });
