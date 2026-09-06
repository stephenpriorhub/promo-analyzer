/**
 * Source Copy API — writes a promo's FULL copy into the brain vault as a
 * markdown note linked to its analysis (publisher directive 2026-09-06).
 *
 * GET  ?reviewId=... → which path the promo takes, plus any job state
 * POST { reviewId }  → (re)write `Promo Copy - <promo>` into the vault
 *
 * The text path returns the finished result inline — it is fast and free. The
 * vision path (scanned PDFs, minutes per promo) returns 202 and runs in the
 * background: nothing streams while a transcription runs, so holding the
 * request open dies at Railway's edge with a 502. Poll GET for the outcome.
 *
 * The analyze route already does all this automatically for new promos; this
 * route exists for the backfill of promos analyzed before the directive and
 * for re-writing one that failed.
 *
 * Auth: behind the site-wide hub sign-in wall; POST additionally admin/service.
 */

import { NextRequest, NextResponse } from "next/server";
import { getReviewById } from "@/lib/reviews-store";
import { readStoredSource } from "@/lib/source-file";
import { writeSourceCopyNote, sourceNoteTitle } from "@/lib/promo-source";
import { getJob, startJob, finishJob } from "@/lib/source-copy-jobs";
import { getHubUser, isHubAdmin, forbidden } from "@/lib/hub-auth";

export const runtime = "nodejs";
export const maxDuration = 800;

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
    job: getJob(reviewId),
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

  const params = {
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
  };

  // Text path: fast enough to answer inline.
  if (src.text) return NextResponse.json(await writeSourceCopyNote(params));

  // Vision path: hand back a job. A transcription already in flight is not
  // restarted — that would double-spend the vision call.
  const existing = getJob(review.id);
  if (existing?.status === "running")
    return NextResponse.json({ ok: true, queued: true, job: existing }, { status: 202 });

  const job = startJob(review.id);
  void writeSourceCopyNote(params)
    .then((result) => {
      finishJob(review.id, result);
      console.log(
        "[source-copy]",
        review.id,
        result.ok
          ? `${result.mode} ${result.words} words → ${result.title}${result.usage ? ` [${result.usage.turns} turn(s), $${result.usage.costUsd.toFixed(3)}]` : ""}`
          : result.error
      );
    })
    .catch((err) =>
      finishJob(review.id, { ok: false, mode: "vision", error: err instanceof Error ? err.message : "failed" })
    );

  return NextResponse.json({ ok: true, queued: true, job }, { status: 202 });
}
