# Arvo image assets (created by designer)

Photorealistic car-detailing library + header logo treatment for the Arvo directory.
All files live in `public/img/` → served at `/img/<file>`.

## Header logo (use in HEADER ONLY — not as shop/service imagery)

**Recommended primary:** `logo-header.png` — transparent PNG (900×180), a wide
horizontal wordmark generated from the client's `F950D59B-...JPG`.

- Both client JPGs are orange/gold on a solid WHITE square. On the app's cream
  `bg-paper/90` header they show as a jarring white box, and the current
  `<img class="h-11 w-11 rounded-xl object-cover">` **strips the wide wordmark
  into a 44×44 square**, which mangles it.
- **Fix:** point the header `<img>` at `/img/logo-header.png` and let it render
  at its natural wide aspect (e.g. `h-9 w-auto`) instead of a square crop. The
  transparent PNG sits cleanly on the cream header. You may drop the redundant
  `arvo.` text span beside it (the wordmark already reads "ARVO"), or keep it if
  you prefer the stacked lockup.
- `logo-emblem.png` (700px, transparent) is the more compact emblem lockup built
  from the client's `3BDF19EC-...JPG` — alternate/compact use (favicon, avatars),
  not needed for the header.

## Shop cover images (3 shops)

| Shop (slug) | Cover | Suggested additional photos |
|---|---|---|
| shine-dog-detailing | `shop-1.jpg` | `full-detail.jpg`, `ceramic.jpg` |
| apex-auto-spa | `shop-2.jpg` | `ceramic.jpg`, `full-detail.jpg` |
| urban-swirl-studio | `shop-3.jpg` | `exterior-wash.jpg`, `paint-correction.jpg` |

## Service images (match `SERVICE_MENU` slugs in seed.ts)

| Service slug | Image |
|---|---|
| exterior-wash-dry | `exterior-wash.jpg` |
| interior-valet | `interior-valet.jpg` |
| full-detail | `full-detail.jpg` |
| ceramic-coating-bronze | `ceramic.jpg` |
| ceramic-coating-premium | `ceramic.jpg` |
| paint-correction-panel | `paint-correction.jpg` |

## Files (all 1536×1024 JPG unless noted)
exterior-wash.jpg · interior-valet.jpg · full-detail.jpg · ceramic.jpg ·
paint-correction.jpg · shop-1.jpg · shop-2.jpg · shop-3.jpg ·
logo-header.png (900×180, transparent) · logo-emblem.png (transparent)

_Regeneration script for transparent logos: `scripts/make_logo_transparent.py`._
