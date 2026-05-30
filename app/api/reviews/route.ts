import { NextRequest, NextResponse } from "next/server";
import { getAllReviews, deleteReview, renameReview, updateReviewTraining } from "@/lib/reviews-store";

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
    const ok = updateReviewTraining(id, training, effectiveness);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
