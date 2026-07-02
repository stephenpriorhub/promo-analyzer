/**
 * Real-world outlook for a saved review.
 * GET ?reviewId=<id> — returns the predicted 1–10 performance score for a promo
 * without real data (from copy-similar promos that DO have results). Null when
 * the promo already has real data or there aren't enough comparables.
 */

import { NextRequest, NextResponse } from "next/server";
import { getReviewById } from "@/lib/reviews-store";
import { predictPerformanceScore } from "@/lib/predict";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const reviewId = req.nextUrl.searchParams.get("reviewId");
  if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  const review = getReviewById(reviewId);
  if (!review) return NextResponse.json({ error: "review not found" }, { status: 404 });
  // If the promo already has real data, prediction isn't needed.
  const hasRealData = review.training?.performanceScore != null && review.training.source === "learned";
  return NextResponse.json({
    predicted: hasRealData ? null : predictPerformanceScore(review),
  });
}
