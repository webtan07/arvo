import { sql } from "./connection";
import { ensureSchema } from "./schema";

/**
 * Seed data for the Arvo demo: 3 realistic car-detailing shops, a shared
 * service menu, and recurring daily availability slots.
 *
 * Idempotent: `ensureSeed()` only inserts a shop's services/slots if that shop
 * has none yet, so re-running never duplicates or clobbers real bookings.
 */

export const PRIMARY_LOGO = "/logo/F950D59B-C1EE-49E6-A524-065C166C61CD.JPG";
export const ALT_LOGO = "/logo/3BDF19EC-EDCA-405F-AA97-BEBDC8E8FEEE.JPG";

const SERVICE_MENU = [
  {
    slug: "exterior-wash-dry",
    name: "Exterior Wash & Dry",
    durationMin: 45,
    priceCents: 2500,
    description:
      "Hand wash, wheels & tyres dressed, and a full dry to a streak-free finish.",
  },
  {
    slug: "interior-valet",
    name: "Interior Valet",
    durationMin: 90,
    priceCents: 5000,
    description:
      "Full interior vacuum, dash & trim wipe-down, glass clean and leather care.",
  },
  {
    slug: "full-detail",
    name: "Full Detail",
    durationMin: 180,
    priceCents: 12000,
    description:
      "Complete inside-and-out detail — washes, decontamination, polish and a deep interior.",
  },
  {
    slug: "ceramic-coating-bronze",
    name: "Ceramic Coating (Bronze)",
    durationMin: 240,
    priceCents: 25000,
    description:
      "A 12-month ceramic sealant for durable gloss and easier cleaning.",
  },
  {
    slug: "ceramic-coating-premium",
    name: "Ceramic Coating (Premium)",
    durationMin: 360,
    priceCents: 40000,
    description:
      "A 3-year professional ceramic coating with paint prep and high-gloss finish.",
  },
  {
    slug: "paint-correction-panel",
    name: "Paint Correction (per panel)",
    durationMin: 120,
    priceCents: 9000,
    description:
      "Machine polishing to remove swirls and light scratches from a single panel.",
  },
];

interface ShopSeed {
  slug: string;
  name: string;
  address: string;
  description: string;
  /** array of photo URLs to show on the shop page */
  photos: string[];
}

const SHOPS: ShopSeed[] = [
  {
    slug: "shine-dog-detailing",
    name: "Shine Dog Detailing",
    address: "14 Progress Way, Manchester M12 4HN",
    description:
      "A family-run studio specialising in paint protection and full details. Every car leaves with a shine you can feel.",
    photos: ["/img/shop-1.jpg", "/img/full-detail.jpg", "/img/ceramic.jpg"],
  },
  {
    slug: "apex-auto-spa",
    name: "Apex Auto Spa",
    address: "3 Riverside Industrial Estate, Birmingham B5 5RH",
    description:
      "Ceramic coatings and showroom-ready finishes. Our technicians train on the latest coatings so your paint lasts.",
    photos: ["/img/shop-2.jpg", "/img/ceramic.jpg", "/img/paint-correction.jpg"],
  },
  {
    slug: "urban-swirl-studio",
    name: "Urban Swirl Studio",
    address: "22 Kelvin Road, Leeds LS12 3AB",
    description:
      "From a quick wash to a full correction, we keep the city's best cars looking brand new. Easy to book, easy to park.",
    photos: ["/img/shop-3.jpg", "/img/interior-valet.jpg", "/img/exterior-wash.jpg"],
  },
];

/** Operating hours for slot generation (24h clock, start hours). Mon–Sat. */
const OPEN_START_HOUR = 8;
const OPEN_END_HOUR = 17; // last slot starts at 16:00
const DAYS_AHEAD = 21;

/** Build recurring daily hour-aligned slots for a shop (idempotent per shop). */
async function seedSlotsForShop(db: ReturnType<typeof sql>, shopId: number) {
  const count = await db`SELECT count(*)::int AS n FROM arvo.slots WHERE shop_id = ${shopId}`;
  if ((count[0] as { n: number }).n > 0) return;

  const rows: { starts_at: Date; ends_at: Date }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let day = 0; day < DAYS_AHEAD; day++) {
    const d = new Date(today.getTime() + day * 86400000);
    // Mon(1)..Sat(6) open; Sunday(0) closed.
    if (d.getDay() === 0) continue;
    for (let h = OPEN_START_HOUR; h < OPEN_END_HOUR; h++) {
      const starts = new Date(d);
      starts.setHours(h, 0, 0, 0);
      const ends = new Date(d);
      ends.setHours(h + 1, 0, 0, 0);
      rows.push({ starts_at: starts, ends_at: ends });
    }
  }
  // Batch insert in chunks (filter-save style).
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    for (const r of chunk) {
      await db`INSERT INTO arvo.slots (shop_id, starts_at, ends_at) VALUES (${shopId}, ${r.starts_at}, ${r.ends_at})`;
    }
  }
}

/** Ensure shops + their services + slots exist. Call before serving the UI. */
export async function ensureSeed(): Promise<void> {
  await ensureSchema();
  const db = sql();

  for (const shop of SHOPS) {
    const existing = await db`SELECT id FROM arvo.shops WHERE slug = ${shop.slug}`;
    let shopId: number;
    if (existing.length === 0) {
      const inserted = await db`
        INSERT INTO arvo.shops (slug, name, address, photos, description)
        VALUES (${shop.slug}, ${shop.name}, ${shop.address}, ${JSON.stringify(shop.photos)}::jsonb, ${shop.description})
        RETURNING id
      `;
      shopId = Number((inserted[0] as { id: number }).id);
    } else {
      shopId = Number((existing[0] as { id: number }).id);
    }

    // Keep photos current on seeded shops (idempotent — we always set the seed
    // images, so kitchens/DBs seeded before the real detail photos were added
    // pick them up on the next run without touching real bookings).
    await db`UPDATE arvo.shops SET photos = ${JSON.stringify(shop.photos)}::jsonb WHERE id = ${shopId}`;

    // Seed services only if the shop has none.
    const svcCount = await db`SELECT count(*)::int AS n FROM arvo.services WHERE shop_id = ${shopId}`;
    if ((svcCount[0] as { n: number }).n === 0) {
      for (const s of SERVICE_MENU) {
        await db`
          INSERT INTO arvo.services (shop_id, slug, name, duration_min, price_cents, description)
          VALUES (${shopId}, ${s.slug}, ${s.name}, ${s.durationMin}, ${s.priceCents}, ${s.description})
        `;
      }
    }

    await seedSlotsForShop(db, shopId);
  }
}
