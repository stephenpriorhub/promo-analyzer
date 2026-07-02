/**
 * Similar-Promo Outcomes — the data-driven layer that says what happened to
 * promos with a similar copy profile. Deliberately NOT part of the Copy
 * Quality Score (decision of record 2026-06-26: craft scoring stays pure;
 * performance lives in the calibration layer).
 *
 * Framing + gates per Claims Integrity review 2026-07-02:
 *   - mode "off"          — fewer than MIN_COMPARABLES training pairs: show nothing.
 *   - mode "comparables"  — 8..29 pairs: list the most similar promos and their
 *                           real outcomes. Facts only, no predicted tier.
 *   - mode "prediction"   — >= 30 pairs AND leave-one-out band accuracy beats
 *                           the naive base rate: additionally report the
 *                           neighbor-majority band with agreement as a COUNT
 *                           ("4 of 5"), never a fabricated percentage.
 *   - The promo being analyzed is always excluded from its own neighbor set.
 *
 * A training pair = a review with persisted sub-scores AND a real
 * training.performanceScore.
 */

import { getAllReviews, type SavedReview } from "./reviews-store";
import type { SubScore } from "./score";

export const MIN_COMPARABLES = 8;
export const MIN_PREDICTION_PAIRS = 30;
/** Max euclidean distance (8 dims, 1-10 scale, after categorical credit) to count as "similar". */
const SIMILARITY_DIST_MAX = 3.0;

// Substring keys matching the canonical labels in lib/score.ts — "urgency"
// (not "cta") because the stored label is "Call to Action / Urgency".
const DIMENSIONS = [
  "hook", "believ", "specific", "emotion", "momentum", "offer", "urgency", "audience",
];

export type OutcomeBand = "7–10" | "4–6" | "1–3";

function band(score: number): OutcomeBand {
  if (score >= 7) return "7–10";
  if (score >= 4) return "4–6";
  return "1–3";
}

interface TrainingPair {
  reviewId: string;
  name: string;
  guru: string | null;
  publisher: string | null;
  promoType: string | null;
  vector: number[];
  performanceScore: number;
}

export interface Comparable {
  reviewId: string;
  name: string;
  guru: string | null;
  publisher: string | null;
  promoType: string | null;
  distance: number;
  performanceScore: number;
  band: OutcomeBand;
}

export interface OutlookResult {
  mode: "off" | "comparables" | "prediction";
  /** Total training pairs available (excluding the subject review). */
  n: number;
  comparables: Comparable[];
  /** Prediction mode only. */
  predictedBand?: OutcomeBand;
  agreement?: { count: number; k: number };
  looAccuracy?: number; // 0..1
  baseRate?: number;    // 0..1 — modal-band frequency the LOO must beat
  disclaimer: string;
}

const DISCLAIMER =
  "Based on {N} past promos with similar copy profiles. Copy accounts for a minority of real-world performance — list, offer, price, and timing are not modeled. Directional only; not a forecast.";

function toVector(subScores: SubScore[] | undefined): number[] | null {
  if (!subScores || subScores.length === 0) return null;
  const vec: number[] = [];
  for (const dim of DIMENSIONS) {
    const hit = subScores.find((s) => s.dimension.toLowerCase().includes(dim));
    if (!hit) return null; // require the full 8-dim profile — no imputation
    vec.push(hit.score);
  }
  return vec;
}

function toPair(r: SavedReview): TrainingPair | null {
  if (r.training?.performanceScore == null) return null;
  const vector = toVector(r.subScores);
  if (!vector) return null;
  return {
    reviewId: r.id,
    name: r.displayName ?? r.filename.replace(/\.[^.]+$/, ""),
    guru: (r.gurus ?? [])[0] ?? null,
    publisher: r.publisher ?? null,
    promoType: r.training?.promoType ?? null,
    vector,
    performanceScore: r.training.performanceScore,
  };
}

/** Euclidean over sub-scores, minus a small credit per matching categorical. */
function distance(
  a: { vector: number[]; guru: string | null; publisher: string | null; promoType: string | null },
  b: TrainingPair
): number {
  let sq = 0;
  for (let i = 0; i < a.vector.length; i++) {
    const d = a.vector[i] - b.vector[i];
    sq += d * d;
  }
  let dist = Math.sqrt(sq);
  if (a.guru && b.guru && a.guru === b.guru) dist -= 0.5;
  if (a.publisher && b.publisher && a.publisher === b.publisher) dist -= 0.5;
  if (a.promoType && b.promoType && a.promoType === b.promoType) dist -= 0.5;
  return Math.max(0, dist);
}

function kFor(n: number): number {
  return Math.min(5, Math.max(3, Math.floor(Math.sqrt(n))));
}

function neighborsOf(
  subject: { vector: number[]; guru: string | null; publisher: string | null; promoType: string | null },
  pool: TrainingPair[],
  k: number
): Array<TrainingPair & { distance: number }> {
  return pool
    .map((p) => ({ ...p, distance: distance(subject, p) }))
    .sort((x, y) => x.distance - y.distance)
    .slice(0, k);
}

function majorityBand(neighbors: Array<{ performanceScore: number }>): { band: OutcomeBand; count: number } {
  const counts = new Map<OutcomeBand, number>();
  for (const nb of neighbors) {
    const b = band(nb.performanceScore);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let best: OutcomeBand = "4–6";
  let bestCount = -1;
  for (const [b, c] of counts) {
    if (c > bestCount) { best = b; bestCount = c; }
  }
  return { band: best, count: bestCount };
}

/** Leave-one-out band accuracy over the training set, and the naive base rate. */
export function leaveOneOutAccuracy(pairs: TrainingPair[]): { accuracy: number; baseRate: number } {
  const n = pairs.length;
  const bandCounts = new Map<OutcomeBand, number>();
  for (const p of pairs) {
    const b = band(p.performanceScore);
    bandCounts.set(b, (bandCounts.get(b) ?? 0) + 1);
  }
  const baseRate = Math.max(...bandCounts.values()) / n;

  let correct = 0;
  const k = kFor(n - 1);
  for (const p of pairs) {
    const rest = pairs.filter((q) => q.reviewId !== p.reviewId);
    const nbs = neighborsOf(p, rest, k);
    const { band: predicted } = majorityBand(nbs);
    if (predicted === band(p.performanceScore)) correct++;
  }
  return { accuracy: correct / n, baseRate };
}

/**
 * Compute the outlook for a review. Self is always excluded from the pool.
 */
export function computeOutlook(review: SavedReview): OutlookResult {
  const off: OutlookResult = { mode: "off", n: 0, comparables: [], disclaimer: "" };

  const vector = toVector(review.subScores);
  if (!vector) return off;

  const pairs = getAllReviews()
    .filter((r) => r.id !== review.id)
    .map(toPair)
    .filter((p): p is TrainingPair => p !== null);
  const n = pairs.length;
  if (n < MIN_COMPARABLES) return { ...off, n };

  const subject = {
    vector,
    guru: (review.gurus ?? [])[0] ?? null,
    publisher: review.publisher ?? null,
    promoType: review.training?.promoType ?? null,
  };
  const k = kFor(n);
  const nbs = neighborsOf(subject, pairs, k).filter((nb) => nb.distance <= SIMILARITY_DIST_MAX);
  if (nbs.length < 3) return { ...off, n }; // not enough genuinely similar promos

  const comparables: Comparable[] = nbs.map((nb) => ({
    reviewId: nb.reviewId,
    name: nb.name,
    guru: nb.guru,
    publisher: nb.publisher,
    promoType: nb.promoType,
    distance: Math.round(nb.distance * 100) / 100,
    performanceScore: nb.performanceScore,
    band: band(nb.performanceScore),
  }));
  const disclaimer = DISCLAIMER.replace("{N}", String(n));

  if (n >= MIN_PREDICTION_PAIRS) {
    const { accuracy, baseRate } = leaveOneOutAccuracy(pairs);
    if (accuracy > baseRate) {
      const { band: predictedBand, count } = majorityBand(nbs);
      return {
        mode: "prediction",
        n,
        comparables,
        predictedBand,
        agreement: { count, k: nbs.length },
        looAccuracy: Math.round(accuracy * 1000) / 1000,
        baseRate: Math.round(baseRate * 1000) / 1000,
        disclaimer,
      };
    }
  }

  return { mode: "comparables", n, comparables, disclaimer };
}
