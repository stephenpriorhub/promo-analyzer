/**
 * Promo Pattern Ledger — field mapping (App-to-Brain Learning Loop, §2).
 *
 * Turns a completed analysis (the SavedReview + FK score + parsed PROMO_INTEL +
 * the raw analysis sections) into the single-row shape the shared Brain API
 * appends to `Resources/Promo Analysis/Promo Pattern Ledger.md`.
 *
 * Pure & side-effect-free (no fs, no network) so the mapping is unit-testable in
 * isolation. The Brain API (brain-map) is the ONLY writer of the ledger file —
 * this module only shapes the row; lib/brain-api.ts POSTs it.
 *
 * The `row` shape MUST match the Brain API's PromoLedgerRow contract
 * (brain-map/lib/ingest.ts) field-for-field:
 *   { date, promo, product, guru, effectiveness, hook, believability,
 *     offerClarity, leadType, mechanism, guarantee, urgencyType,
 *     fkEase, fkGrade, predictedTickers: string[] }
 */

import type { SubScore } from "./score";
import type { PromoIntel } from "./promo-intel";

/** Mirrors the Brain API PromoLedgerRow contract (brain-map/lib/ingest.ts). */
export interface PromoLedgerRow {
  date: string;
  promo: string;
  product: string;
  guru: string;
  effectiveness: string | number;
  hook: string | number;
  believability: string | number;
  offerClarity: string | number;
  leadType: string;
  mechanism: string;
  guarantee: string;
  urgencyType: string;
  fkEase: string | number;
  fkGrade: string | number;
  predictedTickers: string[];
}

/** The subset of a SavedReview this mapping needs (kept narrow for testability). */
export interface LedgerReviewInput {
  date: string;
  displayName?: string;
  filename: string;
  product?: string | null;
  gurus?: string[];
  effectivenessScore: number | null;
  subScores?: SubScore[];
  fkReadingEase: number | null;
  fkGradeLevel: number | null;
  sections: {
    offer?: string;
    stockTease?: string;
  };
}

/** Find a sub-score by a fuzzy dimension key (matches score.ts weightFor tolerance). */
function subScore(subScores: SubScore[] | undefined, key: string): number | "" {
  if (!subScores) return "";
  const k = key.toLowerCase();
  const hit = subScores.find((s) => s.dimension.toLowerCase().includes(k));
  return hit ? hit.score : "";
}

/** The display title used everywhere else for this promo (displayName ?? filename sans ext). */
function promoTitle(r: LedgerReviewInput): string {
  return r.displayName ?? r.filename.replace(/\.[^.]+$/, "");
}

/**
 * Pull the value that follows a "- **Label**:" bullet in the [OFFER] section.
 * The offer section is a bullet list (see build-prompt.ts SYSTEM_PROMPT).
 * Returns "" when the label is absent or its value is a placeholder / empty.
 */
export function parseOfferField(offerText: string | undefined, label: string): string {
  if (!offerText) return "";
  const wanted = label.toLowerCase();
  for (const raw of offerText.split("\n")) {
    // Strip leading bullet + bold markup: "- **Guarantee**: 60-day..." → "Guarantee: 60-day..."
    const line = raw.replace(/^\s*[-•*]\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1");
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key !== wanted) continue;
    const val = line.slice(colon + 1).trim().replace(/^\*+|\*+$/g, "").trim();
    if (!val || val === "—" || /^(none|n\/?a|unknown)$/i.test(val)) return "";
    return val;
  }
  return "";
}

/**
 * Extract candidate tickers from the [STOCK_TEASE] section. The model is asked to
 * give "best prediction(s) for the ticker". We harvest 1–5 uppercase symbols
 * (2–5 chars) that appear in the tease, de-duped, preserving order. Returns []
 * when the section is "NONE" or has no symbols.
 */
export function parsePredictedTickers(stockTease: string | undefined): string[] {
  if (!stockTease) return [];
  if (/^\s*none\s*$/i.test(stockTease)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // $TSLA, (TSLA), "ticker: TSLA", or bare TSLA — capture 2–5 uppercase letters.
  const re = /\b([A-Z]{2,5})\b/g;
  // Words that are uppercase but never tickers in this context.
  const STOP = new Set([
    "NONE", "HIGH", "LOW", "NYSE", "IPO", "CEO", "CalledFTC", "FTC", "SEC", "AI",
    "US", "USA", "ETF", "ETFS", "CUB", "FK", "TICKER", "TICKERS", "TKTK", "TK",
    "THE", "AND", "FOR", "WITH", "MEDIUM", "CONFIDENCE",
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(stockTease)) !== null && out.length < 5) {
    const sym = m[1];
    if (STOP.has(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

/**
 * Derive a compact "lead type" for the ledger. The upload-time PROMO_TYPES
 * (Front-end / Backend VSL / …) are not captured on the review at analyze time,
 * so we approximate the lead angle from the harvested intel: the product type
 * (newsletter / trading service / software) is the most stable machine-comparable
 * signal, falling back to the first strategy pushed.
 */
export function deriveLeadType(intel: PromoIntel | null): string {
  const t = intel?.product?.type?.trim();
  if (t) return t;
  const strat = intel?.strategies?.find((s) => s && s.trim());
  return strat?.trim() ?? "";
}

/** Derive the mechanism string from the harvested intel (plain-English system). */
export function deriveMechanism(intel: PromoIntel | null): string {
  return intel?.product?.mechanism?.trim() ?? "";
}

/**
 * Build the Brain API ledger `row` from a completed analysis. Pure — no I/O.
 *
 * @param review  the SavedReview (narrowed) produced by the analysis
 * @param intel   the parsed [PROMO_INTEL] JSON (may be null if extraction failed)
 */
export function buildLedgerRowFromReview(
  review: LedgerReviewInput,
  intel: PromoIntel | null
): PromoLedgerRow {
  const offer = review.sections.offer;
  return {
    date: (review.date ?? "").slice(0, 10), // YYYY-MM-DD
    promo: promoTitle(review),
    product: (review.product ?? intel?.product?.name ?? "").toString().trim(),
    guru: (review.gurus ?? []).filter(Boolean).join(", "),
    effectiveness: review.effectivenessScore ?? "",
    hook: subScore(review.subScores, "hook"),
    believability: subScore(review.subScores, "believ"),
    offerClarity: subScore(review.subScores, "offer"),
    leadType: deriveLeadType(intel),
    mechanism: deriveMechanism(intel),
    guarantee: parseOfferField(offer, "Guarantee"),
    urgencyType:
      parseOfferField(offer, "Any urgency/scarcity elements") ||
      parseOfferField(offer, "Urgency/scarcity elements") ||
      parseOfferField(offer, "Urgency"),
    fkEase: review.fkReadingEase ?? "",
    fkGrade: review.fkGradeLevel ?? "",
    predictedTickers: parsePredictedTickers(review.sections.stockTease),
  };
}
