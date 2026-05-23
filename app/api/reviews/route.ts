import { NextRequest, NextResponse } from "next/server";
import { getAllReviews, deleteReview } from "@/lib/reviews-store";

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
