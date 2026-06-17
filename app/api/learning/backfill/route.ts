/**
 * POST /api/learning/backfill
 *
 * One-shot: walk every review that has training data with a score and
 * extract lessons for each into the learning KB. Used to populate the
 * knowledge base from promos that were trained before in-process
 * extraction existed (or whose extraction silently failed).
 *
 * Safe to re-run; it appends lessons. Returns a per-promo summary.
 */

import { NextResponse } from "next/server";
import { getAllReviews } from "@/lib/reviews-store";
import { detectGuru, detectPublisher } from "@/lib/brain-reader";
import { extractAndStoreLessons } from "@/lib/extract-lessons";
import { clearAllLessons } from "@/lib/learning-kb";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  // Idempotent rebuild: wipe the KB, then regenerate from current trained reviews.
  // Safe to re-run — won't accumulate duplicates.
  clearAllLessons();

  const reviews = getAllReviews();
  const results: { promo: string; lessonsAdded: number; skipped?: boolean; error?: string }[] = [];

  for (const r of reviews) {
    const t = r.training;
    if (!t || (t.performanceScore == null && t.myScore == null)) continue;
    if (!r.sections.effectiveness) continue;

    const offerText = r.sections.offer ?? "";
    const guru = detectGuru(offerText) ?? detectGuru(r.sections.effectiveness ?? "");
    const publisher = detectPublisher(offerText);
    const promoName = r.displayName ?? r.filename.replace(/\.[^.]+$/, "");

    const result = await extractAndStoreLessons({
      promoName,
      publisher,
      guru,
      promoType: t.promoType,
      effectiveness: r.sections.effectiveness,
      performanceScore: t.performanceScore,
      myScore: t.myScore,
      reasoning: t.reasoning,
    });

    results.push({ promo: promoName, lessonsAdded: result.lessonsAdded, skipped: result.skipped, error: result.error });
  }

  const totalLessons = results.reduce((s, r) => s + r.lessonsAdded, 0);
  return NextResponse.json({ ok: true, promosProcessed: results.length, totalLessons, results });
}
