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
