import { NextResponse } from "next/server";
import { backfillMetadataCanonical, backfillSubScores, backfillPromoTypes } from "@/lib/reviews-store";

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
  return NextResponse.json({ ok: true, ...result, subScoresBackfilled: subScores.updated, promoTypesBackfilled: promoTypes.updated });
}
