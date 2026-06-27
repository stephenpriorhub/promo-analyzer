import { NextResponse } from "next/server";
import { backfillMetadata } from "@/lib/reviews-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/backfill-metadata
 * One-time: fill missing publisher/gurus/product on existing reviews from
 * detection + offer parse. Idempotent — only fills blanks, never overwrites
 * a user-corrected value.
 */
export async function POST() {
  const result = backfillMetadata();
  return NextResponse.json({ ok: true, ...result });
}
