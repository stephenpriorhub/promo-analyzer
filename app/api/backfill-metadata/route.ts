import { NextResponse } from "next/server";
import { backfillMetadataCanonical } from "@/lib/reviews-store";

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
  return NextResponse.json({ ok: true, ...result });
}
