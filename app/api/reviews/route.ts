import { NextRequest, NextResponse } from "next/server";
import { getAllReviews, deleteReview, renameReview, updateReviewTraining, updateReviewRunDate, updateReviewPromoCode, updateReviewPublisher, updateReviewGurus, updateReviewProduct, updateReviewPromoType, updateReviewPromoStatus, getReviewById, getCalibrationStats, PROMO_TYPES, PROMO_STATUSES, type PromoType, type PromoStatus } from "@/lib/reviews-store";
import { detectGuru, detectPublisher } from "@/lib/brain-reader";
import { extractAndStoreLessons } from "@/lib/extract-lessons";
import { getAllPerformanceRecords } from "@/lib/performance-db";
import { normalizeCode } from "@/lib/promo-stats";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("stats") === "true") {
    return NextResponse.json(getCalibrationStats());
  }
  const reviews = getAllReviews();
  // Flag reviews whose creative code matches a performance record (has data).
  const dataCodes = new Set(getAllPerformanceRecords().map((r) => normalizeCode(r.promoCode)));
  const withFlags = reviews.map((r) => ({
    ...r,
    hasPerformanceData: !!r.promoCode && dataCodes.has(normalizeCode(r.promoCode)),
  }));
  return NextResponse.json(withFlags);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const deleted = deleteReview(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, displayName, training, effectiveness, promoRunStartDate, promoCode, publisher, gurus, product, promoType, promoStatus } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if (displayName !== undefined) {
    const ok = renameReview(id, displayName ?? "");
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (promoRunStartDate !== undefined) {
    const ok = updateReviewRunDate(id, promoRunStartDate || null);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (promoCode !== undefined) {
    const ok = updateReviewPromoCode(id, promoCode || null);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (publisher !== undefined) {
    const ok = updateReviewPublisher(id, publisher || null);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (gurus !== undefined) {
    const ok = updateReviewGurus(id, Array.isArray(gurus) ? gurus : []);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (product !== undefined) {
    const ok = updateReviewProduct(id, product || null);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (promoType !== undefined) {
    if (promoType !== null && !(PROMO_TYPES as readonly string[]).includes(promoType)) {
      return NextResponse.json({ error: "Invalid promoType" }, { status: 400 });
    }
    const ok = updateReviewPromoType(id, (promoType || null) as PromoType | null);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (promoStatus !== undefined) {
    if (promoStatus !== null && !(PROMO_STATUSES as readonly string[]).includes(promoStatus)) {
      return NextResponse.json({ error: "Invalid promoStatus" }, { status: 400 });
    }
    const ok = updateReviewPromoStatus(id, (promoStatus || null) as PromoStatus | null);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let lessonsAdded = 0;
  if (training !== undefined) {
    const ok = updateReviewTraining(id, training);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Extract generalizable lessons in-process (no fragile self-HTTP-fetch).
    // Awaited so the response confirms the lesson actually landed.
    const review = getReviewById(id);
    if (review && (training.performanceScore != null || training.myScore != null)) {
      const offerText = review.sections.offer ?? "";
      const guru = detectGuru(offerText) ?? detectGuru(review.sections.effectiveness ?? "");
      const publisher = detectPublisher(offerText);
      const promoName = review.displayName ?? review.filename.replace(/\.[^.]+$/, "");

      const result = await extractAndStoreLessons({
        promoName,
        publisher,
        guru,
        promoType: training.promoType,
        effectiveness: review.sections.effectiveness,
        performanceScore: training.performanceScore,
        myScore: training.myScore,
        reasoning: training.reasoning,
      });
      lessonsAdded = result.lessonsAdded;
    }
  }

  return NextResponse.json({ ok: true, lessonsAdded });
}
