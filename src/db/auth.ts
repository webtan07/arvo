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
// node:crypto is loaded lazily via dynamic import so importing auth.ts from
// client components never pulls server-only Node builtins into the browser
// bundle. All of these helpers are only ever invoked inside server-fn handlers.
let _crypto: typeof import("node:crypto") | null = null;
async function nodeCrypto() {
  if (!_crypto) _crypto = await import("node:crypto");
  return _crypto;
}

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

async function hashPassword(password: string): Promise<string> {
  const { randomBytes, scryptSync } = await nodeCrypto();
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { scryptSync, timingSafeEqual } = await nodeCrypto();
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/* ── sessions ─────────────────────────────────────────────────── */

async function newSessionToken(): Promise<string> {
  const { randomBytes } = await nodeCrypto();
  return randomBytes(32).toString("base64url");
}

async function tokenHash(token: string): Promise<string> {
  const { createHash } = await nodeCrypto();
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
    VALUES (${await tokenHash(token)}, ${role}, ${userId}, ${sessionExpiry()})
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
        VALUES (${email}, ${await hashPassword(data.password)}, ${data.name || null}, ${data.phone || null})
        RETURNING id
      `;
      const id = Number((inserted[0] as { id: number }).id);
      const token = await newSessionToken();
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
    if (!row || !(await verifyPassword(data.password, row.password_hash))) {
      return { ok: false, error: "Incorrect email or password." };
    }
    const token = await newSessionToken();
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

/* ── owner shop setup ─────────────────────────────────────────── */

/** Weekly availability: which days are open + hourly operating window. */
export interface ShopSchedule {
  /** 0 = Sunday … 6 = Saturday */
  openDays: number[];
  /** first bookable hour of the day (24h), e.g. 8 */
  startHour: number;
  /** first hour NOT bookable (24h), e.g. 17 = last slot starts 16:00 */
  endHour: number;
}

/** A service the detailer offers, entered during shop setup. */
export interface ServiceInput {
  name: string;
  priceCents: number;
  durationMin: number;
  description?: string;
}

/** Fields needed to create a shop branch (shop row + services + slots). */
export interface ShopBranchInput {
  name: string;
  address: string;
  description?: string;
  photos?: string[];
  schedule?: ShopSchedule;
  services?: ServiceInput[];
}

export interface ShopBranchResult {
  id: number;
  slug: string;
  schedule: ShopSchedule;
}

/** Default availability when the owner skips scheduling: Mon–Sat, 8am–5pm. */
export function normalizeSchedule(s?: ShopSchedule): ShopSchedule {
  if (s && Array.isArray(s.openDays) && s.openDays.length > 0) {
    const openDays = [...new Set(s.openDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))].sort();
    const startHour = Math.max(0, Math.min(23, Math.floor(Number(s.startHour))));
    const endHour = Math.max(startHour + 1, Math.min(24, Math.floor(Number(s.endHour))));
    return { openDays, startHour, endHour };
  }
  return { openDays: [1, 2, 3, 4, 5, 6], startHour: 8, endHour: 17 };
}

/** Generate recurring hourly slots for a shop from its weekly schedule. */
async function generateSlotsForShop(
  db: ReturnType<typeof sql>,
  shopId: number,
  schedule: ShopSchedule,
): Promise<void> {
  const count = await db`SELECT count(*)::int AS n FROM arvo.slots WHERE shop_id = ${shopId}`;
  if ((count[0] as { n: number }).n > 0) return;
  const DAYS_AHEAD = 14;
  const rows: { starts_at: Date; ends_at: Date }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let day = 0; day < DAYS_AHEAD; day++) {
    const d = new Date(today.getTime() + day * 86400000);
    if (!schedule.openDays.includes(d.getDay())) continue;
    for (let h = schedule.startHour; h < schedule.endHour; h++) {
      const starts = new Date(d);
      starts.setHours(h, 0, 0, 0);
      const ends = new Date(d);
      ends.setHours(h + 1, 0, 0, 0);
      rows.push({ starts_at: starts, ends_at: ends });
    }
  }
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    for (const r of chunk) {
      await db`INSERT INTO arvo.slots (shop_id, starts_at, ends_at) VALUES (${shopId}, ${r.starts_at}, ${r.ends_at})`;
    }
  }
}

/**
 * Create a shop branch: shop row (unique slug + schedule), service menu and
 * recurring bookable slots. Shared by owner registration and createShopForOwner
 * so an owner-created shop is immediately bookable online. Client-safe: only
 * touches connection/schema (no server-only modules).
 */
export async function createOwnerShopBranch(
  db: ReturnType<typeof sql>,
  input: ShopBranchInput,
): Promise<ShopBranchResult> {
  const schedule = normalizeSchedule(input.schedule);

  // Unique slug from the shop name.
  const base = slugify(input.name);
  let slug = base;
  let n = 1;
  for (;;) {
    const clash = await db`SELECT id FROM arvo.shops WHERE slug = ${slug}`;
    if (clash.length === 0) break;
    slug = `${base}-${n++}`;
  }

  const photos = input.photos?.length ? input.photos : DEFAULT_SHOP_PHOTOS;
  const shop = await db`
    INSERT INTO arvo.shops (slug, name, address, photos, description, schedule)
    VALUES (${slug}, ${input.name}, ${input.address},
            ${JSON.stringify(photos)}::jsonb,
            ${input.description || null},
            ${JSON.stringify(schedule)}::jsonb)
    RETURNING id
  `;
  const shopId = Number((shop[0] as { id: number }).id);

  // Service menu (per-shop unique slugs).
  const usedSlugs = new Set<string>();
  for (const s of input.services ?? []) {
    if (!s.name) continue;
    let sSlug = slugify(s.name) || "service";
    let m = 1;
    while (usedSlugs.has(sSlug)) sSlug = `${slugify(s.name) || "service"}-${m++}`;
    usedSlugs.add(sSlug);
    await db`
      INSERT INTO arvo.services (shop_id, slug, name, duration_min, price_cents, description)
      VALUES (${shopId}, ${sSlug}, ${s.name}, ${s.durationMin}, ${s.priceCents}, ${s.description || null})
    `;
  }

  await generateSlotsForShop(db, shopId, schedule);
  return { id: shopId, slug, schedule };
}

/** Success result for owner registration — includes the new shop's slug. */
export interface OwnerRegisterResult extends AuthResult {
  shopSlug?: string;
}

/**
 * Register a new owner account + their linked shop row (slug auto-generated
 * from the shop name; services + weekly schedule persisted; photos default to
 * the existing /img placeholders). Returns an opaque session token + shop slug.
 */
export const registerOwner = createServerFn()
  .validator(
    (d: {
      ownerName?: string;
      email: string;
      password: string;
      shop: {
        name: string;
        address: string;
        description?: string;
        photos?: string[];
        schedule?: ShopSchedule;
      };
      services?: ServiceInput[];
    }) => d,
  )
  .handler(async ({ data }): Promise<OwnerRegisterResult> => {
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

    const branch = await createOwnerShopBranch(db, {
      name: data.shop.name,
      address: data.shop.address,
      description: data.shop.description,
      photos: data.shop.photos,
      schedule: data.shop.schedule,
      services: data.services,
    });

    const owner = await db`
      INSERT INTO arvo.owners (email, password_hash, name, shop_id)
      VALUES (${email}, ${await hashPassword(data.password)}, ${data.ownerName || null}, ${branch.id})
      RETURNING id
    `;
    const ownerId = Number((owner[0] as { id: number }).id);

    const token = await newSessionToken();
    await insertSession(token, "owner", ownerId);
    return { ok: true, sessionToken: token, shopSlug: branch.slug };
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
    if (!row || !(await verifyPassword(data.password, row.password_hash))) {
      return { ok: false, error: "Incorrect email or password." };
    }
    const token = await newSessionToken();
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
    await db`DELETE FROM arvo.sessions WHERE token_hash = ${await tokenHash(token)}`;
    return true;
  });

/**
 * Resolve a session token → user, verifying it exists, is unexpired, and the
 * referenced user still exists. Returns null for invalid/expired tokens.
 * Plain (non-server-fn) helper so other server functions can reuse the same
 * session-resolution logic server-side.
 */
export async function resolveSessionUser(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT s.user_role, s.user_id, s.expires_at
    FROM arvo.sessions s
    WHERE s.token_hash = ${await tokenHash(token)}
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
    SELECT id, email, name, shop_id FROM arvo.owners WHERE id = ${userId}
  `;
  if (o.length === 0) return null;
  const row = o[0] as { id: number; email: string; name: string | null; shop_id: number | null };
  return {
    role: "owner",
    id: Number(row.id),
    email: row.email,
    name: row.name,
    shopId: row.shop_id == null ? null : Number(row.shop_id),
  };
}

/** Resolve a session token → user (server-fn wrapper for client calls). */
export const getSessionUser = createServerFn()
  .validator((d: string) => d)
  .handler(async ({ data: token }): Promise<SessionUser | null> => resolveSessionUser(token));
