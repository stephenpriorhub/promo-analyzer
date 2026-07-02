/**
 * Teach the brain from real performance results.
 *
 * POST { promoCode?: string, force?: boolean }
 *   - with promoCode: learn from that one matched record
 *   - without: learn from every matched record not yet learned (force re-learns all)
 *
 * For each performance record whose creative code matches an analyzed review
 * and that has a defensible tier derivation:
 *   1. Merge real performance into the review's training data (performanceScore
 *      from the percentile-derived 1-10 score; Stephen's myScore/reasoning kept).
 *   2. Run lesson extraction with the REAL outcome so the learning KB accumulates
 *      copy-principle lessons grounded in actual results.
 *   3. Append a row to the brain vault's Performance Ledger and mark the record
 *      learned.
 *
 * Brain writes are graceful — a vault failure never blocks the learning KB.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAllPerformanceRecords,
  markPerformanceLearned,
  type PerformanceRecord,
} from "@/lib/performance-db";
import { deriveTiers, describeDerivation, type TierDerivation } from "@/lib/performance-tier";
import { normalizeCode } from "@/lib/promo-stats";
import { getAllReviews, updateReviewTraining, type SavedReview, type PromoType, PROMO_TYPES } from "@/lib/reviews-store";
import { extractAndStoreLessons } from "@/lib/extract-lessons";
import { appendPerformanceLedgerRows } from "@/lib/brain-writer";

export const runtime = "nodejs";
export const maxDuration = 300;

interface LearnOutcome {
  promoCode: string;
  reviewName: string;
  tier: string;
  performanceScore: number;
  lessonsAdded: number;
  error?: string;
}

function statsSummary(rec: PerformanceRecord): string {
  return Object.entries(rec.stats)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function asPromoType(v: string | null | undefined): PromoType | null {
  return v && (PROMO_TYPES as readonly string[]).includes(v) ? (v as PromoType) : null;
}

function ledgerRow(rec: PerformanceRecord, review: SavedReview, d: TierDerivation): string {
  const name = review.displayName ?? review.filename.replace(/\.[^.]+$/, "");
  const cells = [
    rec.promoCode,
    `[[${name}]]`,
    rec.publication ?? review.publisher ?? "",
    rec.guru ?? (review.gurus ?? []).join(", "),
    d.metric,
    Number.isNaN(d.value) ? "" : String(d.value),
    `${d.tier} (${d.tierSource}, ${d.bucket}, n=${d.pool.n})`,
    new Date().toISOString().slice(0, 10),
    rec.notes.replace(/\|/g, "/"),
  ];
  return `| ${cells.join(" | ")} |`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { promoCode?: string; force?: boolean };

  const records = getAllPerformanceRecords();
  const reviews = getAllReviews();
  const reviewByCode = new Map(
    reviews.filter((r) => r.promoCode).map((r) => [normalizeCode(r.promoCode!), r])
  );
  const promoTypeByCode = new Map(
    reviews.filter((r) => r.promoCode && r.promoType).map((r) => [normalizeCode(r.promoCode!), r.promoType!])
  );
  const derivations = deriveTiers(records, promoTypeByCode);

  const targets = records.filter((rec) => {
    if (body.promoCode) return normalizeCode(rec.promoCode) === normalizeCode(body.promoCode);
    return body.force ? true : rec.learnedAt == null;
  });

  const outcomes: LearnOutcome[] = [];
  const ledgerRows: string[] = [];
  const learnedCodes: string[] = [];
  let skippedNoMatch = 0;
  let skippedNoTier = 0;

  for (const rec of targets) {
    const review = reviewByCode.get(normalizeCode(rec.promoCode));
    if (!review) { skippedNoMatch++; continue; }
    const d = derivations.get(rec.promoCode);
    if (!d) { skippedNoTier++; continue; }

    const reviewName = review.displayName ?? review.filename.replace(/\.[^.]+$/, "");
    const autoReason = `Real result (${rec.promoCode}): ${describeDerivation(d)} → tier ${d.tier}. Raw stats — ${statsSummary(rec)}.${rec.notes ? ` Publisher notes: ${rec.notes}` : ""}`;

    // Publisher rule: real data always drives the performance score. Because
    // this promo HAS data (it matched + tiered), the data-derived score wins —
    // a hand-entered score only stands in when there's no data at all (those
    // promos never reach this pipeline). The publisher's written notes and
    // myScore are preserved; re-teaching replaces this code's own
    // "Real result (...)" line instead of appending a duplicate.
    const existing = review.training;
    const priorReasoning = (existing?.reasoning ?? "")
      .split("\n")
      .filter((line) => !line.startsWith(`Real result (${rec.promoCode})`))
      .join("\n")
      .trim();
    updateReviewTraining(review.id, {
      promoType: review.promoType ?? existing?.promoType ?? asPromoType(rec.promoType),
      performanceScore: d.performanceScore, // data wins
      myScore: existing?.myScore ?? null,
      reasoning: priorReasoning ? `${priorReasoning}\n\n${autoReason}` : autoReason,
      lastUpdated: new Date().toISOString(),
      calibratedEffectiveness: existing?.calibratedEffectiveness,
      // Gold-standard is a publisher judgment — never auto-set from a derived tier.
      isBestPerformer: existing?.isBestPerformer ?? false,
      source: "learned",
    });

    const extract = await extractAndStoreLessons({
      promoName: reviewName,
      publisher: rec.publication ?? review.publisher,
      guru: rec.guru ?? (review.gurus ?? [])[0] ?? null,
      promoType: rec.promoType ?? existing?.promoType ?? null,
      effectiveness: review.sections.effectiveness,
      performanceScore: d.performanceScore,
      myScore: existing?.myScore ?? null,
      reasoning: autoReason,
    });

    ledgerRows.push(ledgerRow(rec, review, d));
    // Only mark learned when lesson extraction succeeded — failed extractions
    // stay eligible for the next "teach all" run.
    if (extract.ok) learnedCodes.push(rec.promoCode);
    outcomes.push({
      promoCode: rec.promoCode,
      reviewName,
      tier: d.tier,
      performanceScore: d.performanceScore,
      lessonsAdded: extract.lessonsAdded,
      error: extract.error,
    });
  }

  if (learnedCodes.length > 0) markPerformanceLearned(learnedCodes);
  const brain = await appendPerformanceLedgerRows(ledgerRows);

  return NextResponse.json({
    ok: true,
    learned: outcomes,
    skippedNoMatch,
    skippedNoTier,
    brainLedger: brain,
  });
}
