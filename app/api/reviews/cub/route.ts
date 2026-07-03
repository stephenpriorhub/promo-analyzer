import { NextRequest, NextResponse } from "next/server";
import { updateReviewCUB } from "@/lib/reviews-store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  try {
    const { reviewId, cub } = await req.json();
    if (!reviewId || typeof cub !== "string") {
      return NextResponse.json({ error: "Missing reviewId or cub" }, { status: 400 });
    }
    const ok = updateReviewCUB(reviewId, cub);
    return NextResponse.json({ ok });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
