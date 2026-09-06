/**
 * Copy-knowledge corpus API — the query surface for ALL OxfordHub tools
 * (publisher directive 2026-07-04: this knowledge serves every app, not just
 * the analyzer).
 *
 * GET  ?stats=true                     → corpus counts
 * GET  ?guru=Name                      → { facts, voice: {passages by type}, styleNotes }
 * GET  ?subject=Name                   → facts about any subject (product, ticker, ...)
 * POST { reviewId }                    → extract one promo's knowledge (admin/service)
 * POST { project: true, guru: Name }   → project a guru's knowledge into the vault
 *
 * Auth: behind the site-wide hub sign-in wall; POST additionally admin/service.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  corpusStats,
  factsForSubject,
  passagesForGuru,
  styleNotesForGuru,
} from "@/lib/corpus-db";
import { extractCorpusKnowledge, extractCorpusKnowledgeFromPdf } from "@/lib/corpus-extract";
import { projectGuruKnowledge } from "@/lib/corpus-project";
import { getReviewById } from "@/lib/reviews-store";
import { readStoredSource } from "@/lib/source-file";
import { getHubUser, isHubAdmin, forbidden } from "@/lib/hub-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("stats") === "true") return NextResponse.json(corpusStats());
  const guru = searchParams.get("guru");
  if (guru) {
    return NextResponse.json({
      guru,
      facts: factsForSubject(guru),
      voice: passagesForGuru(guru),
      styleNotes: styleNotesForGuru(guru),
    });
  }
  const subject = searchParams.get("subject");
  if (subject) return NextResponse.json({ subject, facts: factsForSubject(subject) });
  return NextResponse.json({ error: "Provide ?stats=true, ?guru=Name, or ?subject=Name" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!isHubAdmin(await getHubUser(req))) return forbidden("Only OxfordHub Admins can run corpus extraction.");
  const body = (await req.json().catch(() => ({}))) as { reviewId?: string; project?: boolean; guru?: string };

  if (body.project) {
    if (!body.guru?.trim()) return NextResponse.json({ error: "guru required" }, { status: 400 });
    const result = await projectGuruKnowledge(body.guru.trim());
    return NextResponse.json(result);
  }

  if (!body.reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  const review = getReviewById(body.reviewId);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const src = await readStoredSource(review.id);
  if (!src.text && !src.pdf) return NextResponse.json({ ok: false, skipped: true, why: src.why }, { status: 200 });

  const common = {
    reviewId: review.id,
    promoTitle: review.displayName ?? review.filename.replace(/\.[^.]+$/, ""),
    gurus: review.gurus ?? [],
    publisher: review.publisher ?? null,
    product: review.product ?? null,
  };
  const result = src.text
    ? await extractCorpusKnowledge({ ...common, fullText: src.text })
    : await extractCorpusKnowledgeFromPdf({ ...common, pdfBuffer: src.pdf! });
  return NextResponse.json(result);
}
