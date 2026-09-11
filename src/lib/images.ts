/**
 * Car-detailing image library.
 *
 * The designer drops real photos into `public/img/` under these exact names
 * (see ARVO-BRIEF + team coordination). Files may not all exist yet, so every
 * consumer should render through <SmartImage/>, which falls back to a neutral
 * gradient if the file is missing (onError). The Arvo logo (public/logo/*.JPG)
 * is intentionally NOT used anywhere here — it belongs only in the header.
 */

export const IMG_DIR = "/img";

/** Service → cover image (matched by the seeded service slugs). */
export const SERVICE_IMAGES: Record<string, string> = {
  "exterior-wash-dry": "/img/exterior-wash.jpg",
  "interior-valet": "/img/interior-valet.jpg",
  "full-detail": "/img/full-detail.jpg",
  "ceramic-coating-bronze": "/img/ceramic.jpg",
  "ceramic-coating-premium": "/img/ceramic.jpg",
  "paint-correction-panel": "/img/paint-correction.jpg",
};

export function serviceImage(slug: string): string | undefined {
  return SERVICE_IMAGES[slug];
}

/** Shop slug → cover image. */
const SHOP_COVER_IMAGES: Record<string, string> = {
  "shine-dog-detailing": "/img/shop-1.jpg",
  "apex-auto-spa": "/img/shop-2.jpg",
  "urban-swirl-studio": "/img/shop-3.jpg",
};

export function shopCoverImage(slug: string): string | undefined {
  return SHOP_COVER_IMAGES[slug];
}

/** Shop slug → gallery of detail shots shown on the shop page. */
export const SHOP_GALLERIES: Record<string, string[]> = {
  "shine-dog-detailing": [
    "/img/shop-1.jpg",
    "/img/full-detail.jpg",
    "/img/ceramic.jpg",
  ],
  "apex-auto-spa": [
    "/img/shop-2.jpg",
    "/img/ceramic.jpg",
    "/img/paint-correction.jpg",
  ],
  "urban-swirl-studio": [
    "/img/shop-3.jpg",
    "/img/interior-valet.jpg",
    "/img/exterior-wash.jpg",
  ],
};

/** Default cover used when a shop has no mapped image (still a detail photo). */
export const DEFAULT_COVER = "/img/full-detail.jpg";

/* ═══════════════════════════════════════════════════════════
 * Service-completion photo (Phase B part 3)
 *
 * The owner uploads a REQUIRED photo of the serviced vehicle when completing a
 * job from their dashboard. The photo is stored as a data URL on the booking
 * (bookings.completion_photo_path) and embedded inline in the customer email.
 *
 * Policy shared by the client (size/type pre-check before upload) and the
 * server (authoritative validation): JPEG/PNG/WebP, original file up to 8 MB.
 * The client downscales the image to ≤1600px JPEG before upload, so the
 * wire/base64 payload stays ~a few hundred KB — comfortably inside serverless
 * body limits and email attachment sizes.
 * ═══════════════════════════════════════════════════════════ */
export const COMPLETION_PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
export const COMPLETION_PHOTO_MAX_BYTES = 8 * 1024 * 1024; // raw file (client pre-check)
export const COMPLETION_PHOTO_MAX_BASE64_LEN = 4_200_000; // ≈3.1 MB binary — server-side cap
/** Longest edge of the client-side downscale (keeps emails + DB rows small). */
export const COMPLETION_PHOTO_MAX_EDGE = 1600;

/**
 * Data-URL → { mimeType, base64 }. Returns null when the value isn't a
 * `data:<mime>;base64,<payload>` URL. Server-side canonicalisation before
 * storage; the mail helper uses the same parse to embed the photo inline.
 */
export function parseDataUrl(
  dataUrl: string,
): { mimeType: string; base64: string } | null {
  const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    dataUrl.trim(),
  );
  if (!m) return null;
  return { mimeType: m[1].toLowerCase(), base64: m[2].replace(/\s/g, "") };
}

/**
 * Server-relative path of the future reviews feature — the "review link" the
 * customer gets in their service-completed email. The route lands in the next
 * phase (src/routes/review.$id.tsx); until then the link is formatted
 * consistently and will start resolving once reviews ship.
 */
export function reviewPath(bookingId: number): string {
  return `/review/${bookingId}`;
}
