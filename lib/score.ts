/**
 * Shared scoring logic for the analysis pipeline.
 *
 * The model scores 8 conversion dimensions. We STOP trusting the model's
 * independent holistic /10 and instead compute the final score in code as a
 * conversion-weighted blend of the 8 sub-scores, then allow a small bounded
 * (±1) adjustment if the model proposes one with a justification. The final
 * score is reported to one decimal (e.g. 8.1).
 */

export interface SubScore {
  dimension: string;
  score: number;
  rationale: string;
}

// Canonical dimension order + conversion weights. Hook, believability, and
// emotional pull are the heaviest because they drive whether a skeptical
// reader keeps reading and acts; audience fit is also weighted up because a
// great promo aimed at the wrong avatar does not convert. Momentum / offer
// clarity / CTA matter but are secondary; specificity is a credibility proxy
// already partly captured by believability so it is weighted lightest.
export const DIMENSION_WEIGHTS: Record<string, number> = {
  "Hook Strength": 1.6,
  Believability: 1.5,
  Specificity: 0.8,
  "Emotional Pull": 1.4,
  Momentum: 0.9,
  "Offer Clarity": 1.0,
  "Call to Action / Urgency": 0.9,
  "Audience Fit": 1.3,
};

const TOTAL_WEIGHT = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);

/** Normalize a dimension label to a canonical weight key (tolerant of minor wording). */
function weightFor(dimension: string): number {
  const d = dimension.toLowerCase();
  if (d.includes("hook")) return DIMENSION_WEIGHTS["Hook Strength"];
  if (d.includes("believ")) return DIMENSION_WEIGHTS["Believability"];
  if (d.includes("specific")) return DIMENSION_WEIGHTS["Specificity"];
  if (d.includes("emotion")) return DIMENSION_WEIGHTS["Emotional Pull"];
  if (d.includes("momentum")) return DIMENSION_WEIGHTS["Momentum"];
  if (d.includes("offer")) return DIMENSION_WEIGHTS["Offer Clarity"];
  if (d.includes("call to action") || d.includes("urgency") || d.includes("cta"))
    return DIMENSION_WEIGHTS["Call to Action / Urgency"];
  if (d.includes("audience")) return DIMENSION_WEIGHTS["Audience Fit"];
  return 1.0; // unknown dimension — neutral weight
}

// Same dimension pattern used in OfferSection.tsx (DIMENSION_GLOBAL_RE), kept
// in sync here so server-side parsing matches client-side rendering.
const DIMENSION_GLOBAL_RE =
  /(\d+)\.\s+([^:]+?):\s*(\d+(?:\.\d+)?)\s*\/\s*10\s*[—–-]\s*(.+?)(?=\s+\d+\.\s+[^:]+?:\s*\d|\s*[-–—]{1,3}\s*Score:|\s*Score:|$)/gis;

function stripMd(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

/** Extract the 8 dimension sub-scores from the [EFFECTIVENESS] text. */
export function extractSubScores(effectivenessText: string): SubScore[] {
  const cleaned = stripMd(effectivenessText);
  const out: SubScore[] = [];
  let m: RegExpExecArray | null;
  DIMENSION_GLOBAL_RE.lastIndex = 0;
  while ((m = DIMENSION_GLOBAL_RE.exec(cleaned)) !== null) {
    out.push({
      dimension: m[2].trim(),
      score: parseFloat(m[3]),
      rationale: m[4].trim().replace(/\s+/g, " "),
    });
  }
  return out;
}

/** The model may propose a bounded adjustment: "Adjustment: +0.5 — reason". */
export function extractModelAdjustment(effectivenessText: string): number {
  const m = stripMd(effectivenessText).match(/Adjustment:\s*([+-]?\d+(?:\.\d+)?)/i);
  if (!m) return 0;
  const adj = parseFloat(m[1]);
  if (Number.isNaN(adj)) return 0;
  return Math.max(-1, Math.min(1, adj)); // bound to ±1
}

/**
 * Compute the final conversion score from the sub-scores as a weighted blend,
 * apply a bounded model adjustment, clamp to 1–10, round to one decimal.
 * Returns null if there are no sub-scores to blend.
 */
export function computeFinalScore(
  subScores: SubScore[],
  modelAdjustment = 0
): number | null {
  if (subScores.length === 0) return null;
  let weighted = 0;
  let usedWeight = 0;
  for (const s of subScores) {
    const w = weightFor(s.dimension);
    weighted += s.score * w;
    usedWeight += w;
  }
  // Use the total canonical weight when all 8 are present; otherwise the
  // weight actually observed (so partial extractions still average sanely).
  const denom = subScores.length >= 8 ? TOTAL_WEIGHT : usedWeight;
  const blended = weighted / denom + modelAdjustment;
  const clamped = Math.max(1, Math.min(10, blended));
  return Math.round(clamped * 10) / 10;
}

/**
 * Given the raw [EFFECTIVENESS] text, derive { subScores, finalScore }.
 * finalScore is computed (not the model's holistic number).
 */
export function deriveScore(effectivenessText: string): {
  subScores: SubScore[];
  finalScore: number | null;
} {
  const subScores = extractSubScores(effectivenessText);
  const adjustment = extractModelAdjustment(effectivenessText);
  const finalScore = computeFinalScore(subScores, adjustment);
  return { subScores, finalScore };
}
