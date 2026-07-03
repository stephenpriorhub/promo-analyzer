import { NextResponse } from "next/server";
import { backfillMetadataCanonical, backfillSubScores, backfillPromoTypes, backfillProxyPromoTypes } from "@/lib/reviews-store";
import { getAllPerformanceRecords } from "@/lib/performance-db";
import { normalizeCode } from "@/lib/promo-stats";
import { classifyRowByCartValue } from "@/lib/promo-classify";
import type { PromoType } from "@/lib/promo-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/backfill-metadata
 * Match existing reviews against the brain's Financial Publishing Directory and
 * set publisher/gurus/product to CANONICAL names (uniform brain linking).
 * Overwrites only on a confident directory match; fills remaining blanks from
 * detection/offer-parse; normalizes the legacy verbose MTA label.
 */
export async function POST() {
  const result = await backfillMetadataCanonical();
  // Also fill missing sub-score profiles so older reviews can participate in
  // Similar-Promo Outcomes (derived from their stored effectiveness text).
  const subScores = backfillSubScores();
  const promoTypes = backfillPromoTypes();
  // Cart-value fallback for matched promos whose offer had no parseable price.
  const typeByCode = new Map<string, PromoType>();
  for (const rec of getAllPerformanceRecords()) {
    const t = classifyRowByCartValue(rec.stats);
    if (t) typeByCode.set(normalizeCode(rec.promoCode), t);
  }
  const proxyTypes = backfillProxyPromoTypes(typeByCode, normalizeCode);
  return NextResponse.json({
    ok: true,
    ...result,
    subScoresBackfilled: subScores.updated,
    promoTypesBackfilled: promoTypes.updated,
    proxyTypesBackfilled: proxyTypes.updated,
  });
}
