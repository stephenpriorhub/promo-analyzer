/**
 * Performance tiering — turns raw sheet stats into a defensible tier + 1-10
 * performance score by percentile ranking.
 *
 * Rules (publisher direction 2026-07-02) that keep this honest:
 *   - A promo is judged by its TYPE's metric: front-ends (acquisition) by
 *     ORDER VOLUME, backends & mega-bundles (monetization) by REVENUE.
 *   - It is ranked only against promos in the SAME bucket, so a front-end's
 *     order count is never compared to a mega-bundle's revenue.
 *   - Type comes from the analyzed promo when matched; for raw industry rows
 *     it's inferred from the Avg. Cart Value price proxy — so the full dataset
 *     forms the baseline pool.
 *   - Cohort ladder: n >= 20 → full 5-tier scheme; 8 <= n < 20 → 3-tier scheme
 *     (no gold_standard/failed claims without real deciles); n < 8 → no tier.
 *   - Every derivation carries its bucket + metric + n so the UI and brain show
 *     HOW the tier was computed, and that it recomputes as data arrives.
 */

import type { PerformanceTier } from "./learning-kb";
import type { PerformanceRecord } from "./performance-db";
import type { PromoType } from "./promo-types";
import { classifyStatColumn, normalizedStatNumber } from "./stat-format";
import {
  bucketForType,
  classifyRowByCartValue,
  findOrdersColumn,
  findRevenueColumn,
  BUCKET_METRIC,
  type PerfBucket,
} from "./promo-classify";
import { normalizeCode } from "./promo-stats";

/** Full 5-tier scheme needs real deciles. */
export const FULL_TIER_POOL = 20;
/** Below this, no tier at all — "insufficient comparables". */
export const MIN_TIER_POOL = 8;

export interface TierDerivation {
  promoCode: string;
  metric: string;
  metricKind: "rate" | "absolute";
  value: number;
  /** 0..1 — fraction of the pool this record beats or ties (excluding itself). */
  percentile: number;
  /** 1–10 performance score mapped linearly from the percentile. */
  performanceScore: number;
  tier: PerformanceTier;
  /** Whether the shown tier came from the derivation or a manual override. */
  tierSource: "derived" | "manual";
  /** "5-tier" when the pool supports deciles, "3-tier" for 8-19 pools. */
  scheme: "5-tier" | "3-tier";
  /** How this promo was judged — acquisition (order volume) vs monetization (revenue). */
  bucket: PerfBucket;
  pool: { bucket: PerfBucket; n: number };
}

/** Percentile → tier, full scheme (pool n >= 20). */
function fullTier(p: number): PerformanceTier {
  if (p >= 0.9) return "gold_standard"; // top 10%
  if (p >= 0.65) return "strong";       // next 25%
  if (p >= 0.3) return "average";       // middle 35%
  if (p >= 0.1) return "weak";          // next 20%
  return "failed";                      // bottom 10%
}

/** Percentile → tier, reduced scheme (8 <= pool n < 20): no decile claims. */
function reducedTier(p: number): PerformanceTier {
  if (p >= 0.75) return "strong";  // top 25%
  if (p >= 0.25) return "average"; // middle 50%
  return "weak";                   // bottom 25%
}

const TIER_SCORE: Record<PerformanceTier, number> = {
  gold_standard: 9.5,
  strong: 7.5,
  average: 5.5,
  weak: 3.5,
  failed: 1.5,
};

/**
 * Percentile → 1–10 performance score with a compressed top end (publisher
 * direction 2026-07-02: "too many 9s — 8 is still very great, 7 is great, 6 is
 * above average"). The old linear 1+9p handed a 9+ to anything past the 89th
 * percentile; this curve reserves 9s for the top ~5% and 10 for the top ~1%,
 * interpolating smoothly between anchors rather than hard bands.
 *
 *   p=0.50 → 5.5   p=0.70 → 7.0   p=0.85 → 8.0   p=0.95 → 9.0   p=0.99 → 9.7
 */
const SCORE_ANCHORS: Array<[number, number]> = [
  [0.0, 1.0],
  [0.05, 2.0],
  [0.12, 3.0],
  [0.25, 4.0],
  [0.40, 5.0],
  [0.55, 6.0],
  [0.70, 7.0],
  [0.85, 8.0],
  [0.95, 9.0],
  [0.99, 9.7],
  [1.0, 10.0],
];

export function scoreFromPercentile(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  for (let i = 1; i < SCORE_ANCHORS.length; i++) {
    const [p1, s1] = SCORE_ANCHORS[i - 1];
    const [p2, s2] = SCORE_ANCHORS[i];
    if (x <= p2) {
      const t = p2 === p1 ? 0 : (x - p1) / (p2 - p1);
      return Math.round((s1 + t * (s2 - s1)) * 10) / 10;
    }
  }
  return 10;
}

/**
 * Derive tiers, bucketing each promo by type and ranking it on that bucket's
 * metric (acquisition→orders, monetization→revenue) against same-bucket peers.
 * `promoTypeByCode` supplies the type for analyzed promos (keyed by normalized
 * creative code); raw industry rows fall back to the cart-value price proxy.
 * Pure — takes the full record set so pools/percentiles are consistent.
 */
export function deriveTiers(
  records: PerformanceRecord[],
  promoTypeByCode?: Map<string, PromoType>
): Map<string, TierDerivation> {
  const valued = records
    .map((rec) => {
      const type =
        promoTypeByCode?.get(normalizeCode(rec.promoCode)) ?? classifyRowByCartValue(rec.stats);
      const bucket = bucketForType(type);
      if (!bucket) return null;
      const metric =
        bucket === "acquisition" ? findOrdersColumn(rec.stats) : findRevenueColumn(rec.stats);
      if (!metric) return null;
      const value = normalizedStatNumber(rec.stats[metric], classifyStatColumn(metric));
      if (value == null) return null;
      return { rec, bucket, metric, value };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // Pool by bucket — front-ends rank against front-ends, backends/megas together
  const byBucket = new Map<PerfBucket, typeof valued>();
  for (const v of valued) {
    const arr = byBucket.get(v.bucket) ?? [];
    arr.push(v);
    byBucket.set(v.bucket, arr);
  }

  const out = new Map<string, TierDerivation>();
  for (const [bucket, pool] of byBucket) {
    if (pool.length < MIN_TIER_POOL) continue; // too few peers to rank honestly
    const scheme: "5-tier" | "3-tier" = pool.length >= FULL_TIER_POOL ? "5-tier" : "3-tier";
    for (const v of pool) {
      const peers = pool.filter((p) => p.rec.promoCode !== v.rec.promoCode);
      if (peers.length === 0) continue;
      const beaten = peers.filter((p) => p.value < v.value).length;
      const tied = peers.filter((p) => p.value === v.value).length;
      const percentile = (beaten + tied / 2) / peers.length;
      const derivedTier = scheme === "5-tier" ? fullTier(percentile) : reducedTier(percentile);
      const tier = v.rec.tierOverride ?? derivedTier;
      // 3-tier pools may not make decile claims: clamp away from gold/failed bands.
      const rawScore = scoreFromPercentile(percentile);
      const performanceScore =
        v.rec.tierOverride != null
          ? TIER_SCORE[v.rec.tierOverride]
          : scheme === "3-tier"
            ? Math.min(8.5, Math.max(2.5, rawScore))
            : rawScore;
      out.set(v.rec.promoCode, {
        promoCode: v.rec.promoCode,
        metric: v.metric,
        metricKind: "absolute", // both order counts and revenue are absolute totals
        value: v.value,
        percentile: Math.round(percentile * 1000) / 1000,
        performanceScore,
        tier,
        tierSource: v.rec.tierOverride != null ? "manual" : "derived",
        scheme,
        bucket,
        pool: { bucket, n: pool.length },
      });
    }
  }

  // Records with a manual tier override but no derivable pool still get a tier.
  for (const rec of records) {
    if (rec.tierOverride && !out.has(rec.promoCode)) {
      const type = promoTypeByCode?.get(normalizeCode(rec.promoCode)) ?? classifyRowByCartValue(rec.stats);
      const bucket = bucketForType(type) ?? "monetization";
      out.set(rec.promoCode, {
        promoCode: rec.promoCode,
        metric: "manual",
        metricKind: "absolute",
        value: NaN,
        percentile: NaN,
        performanceScore: TIER_SCORE[rec.tierOverride],
        tier: rec.tierOverride,
        tierSource: "manual",
        scheme: "3-tier",
        bucket,
        pool: { bucket, n: 0 },
      });
    }
  }
  return out;
}

/** Human-readable rank phrase: "top 12%" for winners, "bottom 8%" for losers. */
export function rankPhrase(percentile: number): string {
  if (percentile >= 0.5) return `top ${Math.max(Math.round((1 - percentile) * 100), 1)}%`;
  return `bottom ${Math.max(Math.round(percentile * 100), 1)}%`;
}

/** Human-readable cohort line, e.g. "top 12% by order volume among 23 acquisition promos". */
export function describeDerivation(d: TierDerivation): string {
  if (d.metric === "manual") return "manual tier set by publisher";
  const kind = BUCKET_METRIC[d.bucket].label;
  const cohort = d.bucket === "acquisition" ? "front-end promos" : "backend/mega-bundle promos";
  return `${rankPhrase(d.percentile)} by ${kind} among ${d.pool.n} ${cohort}`;
}
