# Arvo — Car Detailing Booking Web App

A booking web app for car-detailing shops. TanStack Start (React + TypeScript +
Tailwind) with Neon Postgres under a dedicated `arvo` schema.

## Stack
- **TanStack Start** (React 19 + Vite 7 + Tailwind 4)
- **Neon serverless Postgres** — all tables under the `arvo` schema
- Runs on its own port: **3102** (never 3000/3100/3101)

## Local dev
```bash
ln -s /opt/node_modules node_modules   # deps live on root fs (disk-constrained)
cp .env.example .env                   # add DATABASE_URL (Neon)
bun install --ignore-scripts
bun run build                          # generates routeTree.gen.ts (gitignored)
bun run typecheck
bun run start                          # serves on :3102
```

## DB schema (`arvo`)
- `shops` — name, slug, address, photos (jsonb), description
- `services` — name, slug, duration_min, price_cents, description, shop_id
- `slots` — shop_id, starts_at, ends_at, is_open
- `bookings` — customer name/email/phone, service_id, slot_id, status,
  payment_option, notes

> `ensureSchema()` in `src/db/schema.ts` self-heals a fresh DB (CREATE ... IF
> NOT EXISTS). Health check: `src/routes/api/health.ts` (`getHealth` server fn).

## Status
Scaffold complete. **Next:** brand assets (client logos pending), booking UI,
availability generation, payments. See the lead for the logo email retrieval.
