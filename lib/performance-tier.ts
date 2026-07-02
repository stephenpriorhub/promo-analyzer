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

/**
 * Metric whitelist, priority order, all higher-is-better. First hit wins.
 * Lower-is-better columns (CPA, refund rate…) are deliberately absent — adding
 * one requires adding direction handling, not just a pattern.
 */
const METRIC_PRIORITY: Array<{
  match: (h: string) => boolean;
  kind: "rate" | "absolute";
  /** Sanity range — cells outside it are rejected as mis-parses. */
  sane?: (v: number) => boolean;
}> = [
  { match: (h) => h.includes("conversion") || h === "conv" || h.startsWith("conv%") || h.includes("convrate"), kind: "rate", sane: (v) => v >= 0 && v <= 100 },
  { match: (h) => h === "epc" || h.includes("earningsperclick"), kind: "rate", sane: (v) => v >= 0 },
  { match: (h) => h.includes("revenuepername") || h === "rpn" || h.includes("revpername") || h.includes("revenuepersend") || h === "epm", kind: "rate", sane: (v) => v >= 0 },
  { match: (h) => h.includes("aov") || h.includes("avgorder"), kind: "rate", sane: (v) => v >= 0 },
  { match: (h) => h.includes("roi"), kind: "rate" },
  { match: (h) => h.includes("netrevenue") || h.includes("netrev"), kind: "absolute", sane: (v) => v >= 0 },
  { match: (h) => h.includes("grossrevenue") || h.includes("grossrev") || h.includes("totalrevenue") || h === "revenue", kind: "absolute", sane: (v) => v >= 0 },
  { match: (h) => h.includes("orders") || h.includes("sales"), kind: "absolute", sane: (v) => v >= 0 },
];

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_%()-]+/g, "");
}

/**
 * Headers that must never drive a tier even when they substring-match a
 * whitelisted pattern — lower-is-better columns ("Conversion Cost", "Refund
 * Orders", CPA…) would rank the worst promos as winners.
 */
function isDisqualifiedHeader(h: string): boolean {
  return /cost|refund|cancel|cpa|spend|chargeback|unsub/.test(h);
}

/** Parse "$1,234.56", "3.2%", "1,204" → number. Null for non-numeric. */
export function parseStatNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Pick the tiering metric for a record: explicit override (must still be whitelisted), else priority scan. */
export function detectPrimaryMetric(rec: PerformanceRecord): { metric: string; kind: "rate" | "absolute" } | null {
  const candidates = rec.primaryMetricOverride
    ? [rec.primaryMetricOverride, ...Object.keys(rec.stats)]
    : Object.keys(rec.stats);
  for (const pri of METRIC_PRIORITY) {
    const hit = candidates.find((h) => {
      const n = normHeader(h);
      if (isDisqualifiedHeader(n) || !pri.match(n)) return false;
      const v = parseStatNumber(rec.stats[h]);
      return v != null && (pri.sane ? pri.sane(v) : true);
    });
    if (hit) return { metric: hit, kind: pri.kind };
  }
  return null;
}

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
      const rawScore = Math.round((1 + 9 * percentile) * 10) / 10;
      const performanceScore =
        v.rec.tierOverride != null
          ? TIER_SCORE[v.rec.tierOverride]
          : scheme === "3-tier"
            ? Math.min(8.5, Math.max(2.5, rawScore))
            : rawScore;
      out.set(v.rec.promoCode, {
        promoCode: v.rec.promoCode,
        metric: v.metric,
        metricKind: bucket === "acquisition" ? "absolute" : "absolute",
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
