// Client-safe constants — no Node.js imports.
// Import from here in client components; reviews-store re-exports for server code.

export const PROMO_TYPES = [
  "Front-end",
  "Backend Live Webinar",
  "Backend VSL",
  "Mega-Bundle Live Webinar",
  "Mega-Bundle VSL",
] as const;

export type PromoType = (typeof PROMO_TYPES)[number];
