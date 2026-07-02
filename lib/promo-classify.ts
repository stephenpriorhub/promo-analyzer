/**
 * Promo type classification + how a real-world result should be judged.
 *
 * Publisher rules (2026-07-02):
 *  - Price point sets the promo type: < $700 = Front-end, $700–$4,000 =
 *    Backend VSL, > $4,000 = Mega-Bundle. Manual type always wins.
 *  - Front-ends are ACQUISITION plays — judged by ORDER VOLUME.
 *    Backends and mega-bundles are MONETIZATION plays — judged by REVENUE.
 *
 * For analyzed promos the price comes from the offer copy. For raw industry
 * rows (no copy) the Avg. Cart Value column is the price proxy, so every row
 * can be bucketed and ranked against its own kind.
 */

import type { PromoType } from "./promo-types";
import { classifyStatColumn, toNumber } from "./stat-format";

export const FRONT_END_MAX = 700;
export const BACKEND_MAX = 4000;

/** All dollar amounts in a string, largest-first. */
function dollarAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out.sort((a, b) => b - a);
}

const DISCOUNT_RE = /discount|promotional|promo price|% off|percent off|now just|now only|regular price|reg\.?\s*price|\bwas \$|slashed|marked down|today only/i;

/**
 * The representative price the customer actually pays, from the offer section's
 * "Price(s)" bullet ONLY — never the rest of the offer, so gains/value claims
 * ("$67,000 in profits") can't masquerade as a price.
 *
 * When the line shows a discount ("regular $997; promotional $149"), the ASK
 * (lowest) price wins — that's what determines whether the promo is an
 * acquisition play. Otherwise (a single price or a payment plan like
 * "$5,000 or 5× $1,200") the full (largest) price wins. Null when the Price(s)
 * line has no dollar figure — the promo is left unclassified for manual typing.
 */
export function extractPricePoint(offerText: string | undefined): number | null {
  if (!offerText) return null;
  for (const raw of offerText.split("\n")) {
    const line = raw.replace(/^\s*[-•*]\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1");
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key === "price(s)" || key === "price" || key === "prices") {
      const rest = line.slice(colon + 1);
      const amts = dollarAmounts(rest); // largest-first
      if (!amts.length) return null;
      return DISCOUNT_RE.test(rest) ? amts[amts.length - 1] : amts[0];
    }
  }
  return null;
}

/** Price → promo type. Null when no price is available. */
export function classifyByPrice(price: number | null): PromoType | null {
  if (price == null) return null;
  if (price < FRONT_END_MAX) return "Front-end";
  if (price <= BACKEND_MAX) return "Backend VSL";
  return "Mega-Bundle VSL";
}

export type PerfBucket = "acquisition" | "monetization";

/** How a promo of this type is judged. Front-ends on volume; everything else on revenue. */
export function bucketForType(t: PromoType | null | undefined): PerfBucket | null {
  if (!t) return null;
  return t === "Front-end" ? "acquisition" : "monetization";
}

export const BUCKET_METRIC: Record<PerfBucket, { label: string; kind: "orders" | "revenue" }> = {
  acquisition: { label: "order volume", kind: "orders" },
  monetization: { label: "revenue", kind: "revenue" },
};

/** Find the orders column (a count column named orders/sales) in a stat row. */
export function findOrdersColumn(stats: Record<string, string>): string | null {
  const keys = Object.keys(stats);
  return (
    keys.find((h) => /gross\s*orders?/i.test(h)) ??
    keys.find((h) => classifyStatColumn(h) === "number" && /orders?\b/i.test(h)) ??
    keys.find((h) => classifyStatColumn(h) === "number" && /\bsales\b/i.test(h)) ??
    null
  );
}

/** Find the revenue column (prefer gross/total revenue) in a stat row. */
export function findRevenueColumn(stats: Record<string, string>): string | null {
  const keys = Object.keys(stats);
  return (
    keys.find((h) => /gross\s*revenue|total\s*revenue/i.test(h)) ??
    keys.find((h) => classifyStatColumn(h) === "currency" && /revenue/i.test(h)) ??
    null
  );
}

/** Find the average cart value column — the price proxy for un-analyzed industry rows. */
export function findCartValueColumn(stats: Record<string, string>): string | null {
  const keys = Object.keys(stats);
  return (
    keys.find((h) => /cart\s*value|avg.*value|\baov\b/i.test(h)) ??
    null
  );
}

/** Best-effort promo type for a raw industry row, from its Avg. Cart Value price proxy. */
export function classifyRowByCartValue(stats: Record<string, string>): PromoType | null {
  const col = findCartValueColumn(stats);
  if (!col) return null;
  return classifyByPrice(toNumber(stats[col]));
}
