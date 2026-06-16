import { NextRequest, NextResponse } from "next/server";
import { getAllReviews, deleteReview, renameReview, updateReviewTraining, getReviewById } from "@/lib/reviews-store";
import { detectGuru, detectPublisher } from "@/lib/brain-reader";

export const runtime = "nodejs";

export async function GET() {
  const reviews = getAllReviews();
  return NextResponse.json(reviews);
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
  const { id, displayName, training, effectiveness } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if (displayName !== undefined) {
    const ok = renameReview(id, displayName ?? "");
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (training !== undefined) {
    const ok = updateReviewTraining(id, training);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Fire-and-forget: extract generalizable lessons into the learning KB
    const review = getReviewById(id);
    if (review && (training.performanceScore !== null || training.myScore !== null)) {
      const offerText = review.sections.offer ?? "";
      const guru = detectGuru(offerText) ?? detectGuru(review.sections.effectiveness ?? "");
      const publisher = detectPublisher(offerText);
      const promoName = review.displayName ?? review.filename.replace(/\.[^.]+$/, "");

      const baseUrl =
        process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
        `http://localhost:${process.env.PORT ?? 3002}`;

      fetch(`${baseUrl}/api/learning/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoName,
          publisher,
          guru,
          promoType: training.promoType,
          effectiveness: review.sections.effectiveness,
          performanceScore: training.performanceScore,
          myScore: training.myScore,
          reasoning: training.reasoning,
        }),
      }).catch(() => {}); // non-fatal
    }
  }

  return NextResponse.json({ ok: true });
}
