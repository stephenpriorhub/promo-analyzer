/**
 * Similar-Promo Outcomes for a saved review.
 * GET ?reviewId=<id> — see lib/predict.ts for the modes and gates.
 */

import { NextRequest, NextResponse } from "next/server";
import { getReviewById } from "@/lib/reviews-store";
import { computeOutlook } from "@/lib/predict";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const reviewId = req.nextUrl.searchParams.get("reviewId");
  if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  const review = getReviewById(reviewId);
  if (!review) return NextResponse.json({ error: "review not found" }, { status: 404 });
  return NextResponse.json(computeOutlook(review));
}
