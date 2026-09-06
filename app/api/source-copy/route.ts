/**
 * Source Copy API — writes a promo's FULL copy into the brain vault as a
 * markdown note linked to its analysis (publisher directive 2026-09-06).
 *
 * GET  ?reviewId=... → whether a source file exists and which path it takes
 * POST { reviewId }  → (re)write `Promo Copy - <promo>` into the vault
 *
 * The analyze route already does this automatically for every new promo; this
 * route exists for the backfill of promos analyzed before the directive and
 * for re-writing one that failed.
 *
 * Auth: behind the site-wide hub sign-in wall; POST additionally admin/service.
 */

import { NextRequest, NextResponse } from "next/server";
import { getReviewById } from "@/lib/reviews-store";
import { readStoredSource } from "@/lib/source-file";
import { writeSourceCopyNote, sourceNoteTitle } from "@/lib/promo-source";
import { getHubUser, isHubAdmin, forbidden } from "@/lib/hub-auth";

export const runtime = "nodejs";
export const maxDuration = 800; // a long scanned promo needs several vision turns

export async function GET(req: NextRequest) {
  const reviewId = new URL(req.url).searchParams.get("reviewId");
  if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  const review = getReviewById(reviewId);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  const src = await readStoredSource(reviewId);
  return NextResponse.json({
    reviewId,
    noteTitle: sourceNoteTitle(review.displayName ?? review.filename.replace(/\.[^.]+$/, "")),
    mode: src.text ? "text" : src.pdf ? "vision" : "none",
    chars: src.text?.length ?? 0,
    why: src.why,
  });
}

export async function POST(req: NextRequest) {
  if (!isHubAdmin(await getHubUser(req)))
    return forbidden("Only OxfordHub Admins can write source copy to the vault.");

  const body = (await req.json().catch(() => ({}))) as { reviewId?: string };
  if (!body.reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });

  const review = getReviewById(body.reviewId);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const src = await readStoredSource(review.id);
  if (!src.text && !src.pdf)
    return NextResponse.json({ ok: false, skipped: true, why: src.why ?? "no source" }, { status: 200 });

  const result = await writeSourceCopyNote({
    reviewId: review.id,
    promoTitle: review.displayName ?? review.filename.replace(/\.[^.]+$/, ""),
    filename: review.filename,
    date: review.date,
    publisher: review.publisher,
    gurus: review.gurus,
    product: review.product,
    promoCode: review.promoCode,
    effectivenessScore: review.effectivenessScore,
    text: src.text,
    pdfBuffer: src.pdf,
    pageNote: src.pageNote,
  });
  return NextResponse.json(result);
}
