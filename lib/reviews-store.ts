import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// DATA_DIR can be overridden via env var — set to a Railway volume path in production
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");
export const FILES_DIR = path.join(DATA_DIR, "files");

export interface SupplementalFile {
  id: string;
  filename: string;
  category: string;
  size: number;
  uploadedAt: string;
}

import type { PromoType } from "./promo-types";
export { PROMO_TYPES, type PromoType } from "./promo-types";
import type { SubScore } from "./score";
import { deriveScore } from "./score";

export type InputType = "visual-pdf" | "docx" | "text";

export interface TrainingData {
  promoType: PromoType | null;
  performanceScore: number | null; // actual real-world performance (high weight)
  myScore: number | null;          // analyst's personal assessment (lower weight)
  reasoning: string;
  lastUpdated: string;
  calibratedEffectiveness?: string; // re-evaluated effectiveness after training feedback
  isBestPerformer?: boolean;        // manually flagged as all-time / gold standard
  /**
   * Where performanceScore came from. "learned" = auto-derived from the
   * performance sheet pipeline. Decision of record 2026-06-26: real-outcome
   * data stays out of the craft-scoring prompt — learned entries are excluded
   * from getTrainingExamples() (they still feed calibration stats and the
   * Similar-Promo Outcomes layer, which is where prediction belongs).
   */
  source?: "publisher" | "learned";
}

export interface SavedReview {
  id: string;
  filename: string;
  displayName?: string;
  date: string;
  promoRunStartDate?: string | null; // approx date the promo started running (captured at upload)
  promoCode?: string | null; // join key to the external performance sheet (optional; only some promos have one)
  publisher?: string | null; // editable; auto-seeded from detection, user-correctable
  gurus?: string[];          // editable; editors/strategists only (hosts excluded)
  product?: string | null;   // editable; the promoted product/publication
  effectivenessScore: number | null;
  predictedScore?: number | null; // original copy-derived prediction (calibration baseline; NOT overwritten by training re-evaluation)
  subScores?: SubScore[];
  inputType?: InputType;
  fkReadingEase: number | null;
  fkGradeLevel: number | null;
  sections: AnalysisSections;
  training?: TrainingData;
  sourceFile?: { filename: string; size: number };
  supplementalFiles?: SupplementalFile[];
}

export interface AnalysisSections {
  headline: string;
  outline: string;
  evaldo: string;
  cub: string;
  offer: string;
  stockTease: string;
  effectiveness: string;
  promoIntel?: string; // raw JSON intel extracted for the brain vault
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readReviews(): SavedReview[] {
  ensureDataDir();
  if (!fs.existsSync(REVIEWS_FILE)) return [];
  try {
    const raw = fs.readFileSync(REVIEWS_FILE, "utf-8");
    return JSON.parse(raw) as SavedReview[];
  } catch {
    return [];
  }
}

function writeReviews(reviews: SavedReview[]) {
  ensureDataDir();
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2), "utf-8");
}

export function getAllReviews(): SavedReview[] {
  return readReviews().sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Returns all reviews that have publisher training feedback attached.
 * Used to build calibration examples for new analyses.
 */
export function getTrainingExamples(): Array<{
  name: string;
  promoType: PromoType | null;
  guru: string | null;
  predictedScore: number | null;
  performanceScore: number | null;
  myScore: number | null;
  reasoning: string;
  bigIdea: string;
  isBestPerformer: boolean;
}> {
  // Learned (sheet-derived) entries are excluded — only publisher-entered
  // training feedback may calibrate the craft-scoring prompt.
  const reviews = readReviews().filter(
    (r) => r.training != null && r.training.source !== "learned"
  );
  return reviews.map((r) => {
    const name = r.displayName ?? r.filename.replace(/\.[^.]+$/, "");
    let bigIdea = "";
    for (const line of (r.sections.offer ?? "").split("\n")) {
      const stripped = line.replace(/^[-•]\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1");
      const colonIdx = stripped.indexOf(":");
      if (colonIdx !== -1 && colonIdx < 40) {
        if (stripped.slice(0, colonIdx).trim().toLowerCase() === "big idea") {
          bigIdea = stripped.slice(colonIdx + 1).trim();
          break;
        }
      }
    }
    const isBestPerformer =
      r.training!.isBestPerformer === true ||
      (r.training!.performanceScore !== null && r.training!.performanceScore >= 9);
    return {
      name,
      promoType: r.training!.promoType ?? null,
      guru: detectGuruFromReview(r),
      predictedScore: r.effectivenessScore,
      performanceScore: r.training!.performanceScore,
      myScore: r.training!.myScore,
      reasoning: r.training!.reasoning,
      bigIdea,
      isBestPerformer,
    };
  });
}

// ---- Calibration statistics -------------------------------------------------

export interface CalibrationBucket {
  band: string;       // e.g. "7–10", "4–6", "1–3"
  n: number;
  avgPredicted: number | null;
  avgActual: number | null;
}

export interface SliceBias {
  key: string;        // promoType or guru value
  n: number;
  signedBias: number; // mean(predicted − actual); + = over-rating
}

export interface CalibrationStats {
  n: number;
  correlation: number | null; // Pearson r (predicted vs actual)
  mae: number | null;         // mean absolute error
  bandAccuracy: number | null; // % predicted landing in the correct tier band (headline)
  buckets: CalibrationBucket[];
  byPromoType: SliceBias[];
  byGuru: SliceBias[];
  largestBias: { dimension: "promoType" | "guru"; slice: SliceBias } | null;
}

function tierBand(score: number): string {
  if (score >= 7) return "7–10";
  if (score >= 4) return "4–6";
  return "1–3";
}

/**
 * Calibration over reviews that have both a predicted effectivenessScore and a
 * training.performanceScore. Band accuracy (predicted tier == actual tier) is
 * the headline metric.
 */
export function getCalibrationStats(): CalibrationStats {
  const rows = readReviews()
    .filter(
      (r) =>
        (r.predictedScore ?? r.effectivenessScore) != null &&
        r.training?.performanceScore != null
    )
    .map((r) => ({
      // Use the original copy-based prediction as the calibration baseline so a
      // hindsight re-evaluation can't make predicted≈actual and inflate accuracy.
      predicted: (r.predictedScore ?? r.effectivenessScore) as number,
      actual: r.training!.performanceScore as number,
      promoType: r.training!.promoType ?? "Unspecified",
      guru:
        detectGuruFromReview(r) ?? "Unknown",
    }));

  const n = rows.length;
  if (n === 0) {
    return {
      n: 0,
      correlation: null,
      mae: null,
      bandAccuracy: null,
      buckets: [],
      byPromoType: [],
      byGuru: [],
      largestBias: null,
    };
  }

  // Pearson correlation
  const mp = rows.reduce((a, r) => a + r.predicted, 0) / n;
  const ma = rows.reduce((a, r) => a + r.actual, 0) / n;
  let cov = 0, vp = 0, va = 0;
  for (const r of rows) {
    const dp = r.predicted - mp;
    const da = r.actual - ma;
    cov += dp * da;
    vp += dp * dp;
    va += da * da;
  }
  const correlation = vp > 0 && va > 0 ? cov / Math.sqrt(vp * va) : null;

  // MAE
  const mae = rows.reduce((a, r) => a + Math.abs(r.predicted - r.actual), 0) / n;

  // Band accuracy
  const correct = rows.filter((r) => tierBand(r.predicted) === tierBand(r.actual)).length;
  const bandAccuracy = (correct / n) * 100;

  // Calibration buckets (by ACTUAL tier band)
  const bandOrder = ["7–10", "4–6", "1–3"];
  const buckets: CalibrationBucket[] = bandOrder.map((band) => {
    const inBand = rows.filter((r) => tierBand(r.actual) === band);
    return {
      band,
      n: inBand.length,
      avgPredicted: inBand.length
        ? inBand.reduce((a, r) => a + r.predicted, 0) / inBand.length
        : null,
      avgActual: inBand.length
        ? inBand.reduce((a, r) => a + r.actual, 0) / inBand.length
        : null,
    };
  });

  // Per-slice signed bias
  function sliceBias(key: "promoType" | "guru"): SliceBias[] {
    const groups = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const g = groups.get(r[key]) ?? { sum: 0, n: 0 };
      g.sum += r.predicted - r.actual;
      g.n += 1;
      groups.set(r[key], g);
    }
    return [...groups.entries()]
      .map(([k, v]) => ({ key: k, n: v.n, signedBias: v.sum / v.n }))
      .sort((a, b) => Math.abs(b.signedBias) - Math.abs(a.signedBias));
  }

  const byPromoType = sliceBias("promoType");
  const byGuru = sliceBias("guru");

  // Largest systematic bias across both slice dimensions (require n >= 2)
  let largestBias: CalibrationStats["largestBias"] = null;
  const candidates: { dimension: "promoType" | "guru"; slice: SliceBias }[] = [
    ...byPromoType.filter((s) => s.n >= 2).map((slice) => ({ dimension: "promoType" as const, slice })),
    ...byGuru.filter((s) => s.n >= 2).map((slice) => ({ dimension: "guru" as const, slice })),
  ];
  for (const c of candidates) {
    if (!largestBias || Math.abs(c.slice.signedBias) > Math.abs(largestBias.slice.signedBias)) {
      largestBias = c;
    }
  }

  return { n, correlation, mae, bandAccuracy, buckets, byPromoType, byGuru, largestBias };
}

/** Best-effort guru detection for a saved review (offer text, then effectiveness). */
function detectGuruFromReview(r: SavedReview): string | null {
  // Lazy import avoids a hard dependency cycle at module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { detectGuru } = require("./brain-reader") as { detectGuru: (t: string) => string | null };
  return detectGuru(r.sections.offer ?? "") ?? detectGuru(r.sections.effectiveness ?? "");
}

// Hosts/analysts are NOT gurus for this field (they front shows but don't own products).
const NON_GURU_HOSTS = new Set(["Chris Johnson"]);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CANON_SNAPSHOT = require("./canonical-entities.json") as { gurus: string[]; publishers: string[]; products: string[] };

/** Canonical gurus whose name appears in the text (snapshot-based, synchronous). */
function snapshotGurusInText(text: string): string[] {
  const hay = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (CANON_SNAPSHOT.gurus ?? []).filter((g) => {
    const n = g.toLowerCase().replace(/\s+/g, " ").trim();
    return n.length >= 5 && hay.includes(n) && !NON_GURU_HOSTS.has(g);
  });
}

/** Pull the product/publication name from the parsed offer copy, if present. */
export function parseProductFromOffer(offerText: string): string | null {
  for (const line of (offerText ?? "").split("\n")) {
    const stripped = line.replace(/^[-•*]\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1");
    const colonIdx = stripped.indexOf(":");
    if (colonIdx === -1 || colonIdx > 40) continue;
    const label = stripped.slice(0, colonIdx).trim().toLowerCase();
    if (label === "product name" || label === "product") {
      const val = stripped.slice(colonIdx + 1).trim().replace(/^\*+|\*+$/g, "").trim();
      if (val && val !== "—") return val;
    }
  }
  return null;
}

/** Auto-seed publisher / gurus / product for a review from detection + offer parse. */
function seedMetadata(r: SavedReview): { publisher: string | null; gurus: string[]; product: string | null } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { detectPublisher } = require("./brain-reader") as { detectPublisher: (t: string) => string | null };
  const text = `${r.sections.offer ?? ""}\n${r.sections.effectiveness ?? ""}`;
  const publisher = detectPublisher(text) ?? null;
  const detectedGuru = detectGuruFromReview(r);
  // Union the small built-in detection with the full canonical snapshot match.
  const gurus = Array.from(
    new Set([
      ...(detectedGuru && !NON_GURU_HOSTS.has(detectedGuru) ? [detectedGuru] : []),
      ...snapshotGurusInText(text),
    ])
  );
  const product = parseProductFromOffer(r.sections.offer ?? "");
  return { publisher, gurus, product };
}

/** Distinct non-empty values already used across reviews, for dropdown options. */
export function getDistinctMetaValues(): { publishers: string[]; gurus: string[]; products: string[] } {
  const reviews = readReviews();
  const publishers = new Set<string>();
  const gurus = new Set<string>();
  const products = new Set<string>();
  for (const r of reviews) {
    if (r.publisher) publishers.add(r.publisher);
    for (const g of r.gurus ?? []) if (g) gurus.add(g);
    if (r.product) products.add(r.product);
    // also harvest products parsed from offer copy even if not yet stored
    const p = parseProductFromOffer(r.sections.offer ?? "");
    if (p) products.add(p);
  }
  const srt = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { publishers: srt(publishers), gurus: srt(gurus), products: srt(products) };
}

/**
 * One-time backfill: derive + persist the 8 sub-scores for reviews that predate
 * the trust upgrade (or were never re-analyzed). Without a full sub-score
 * profile a review can't participate in Similar-Promo Outcomes. Never touches
 * effectivenessScore/predictedScore — only fills the missing subScores field.
 */
export function backfillSubScores(): { updated: number; total: number } {
  const reviews = readReviews();
  let updated = 0;
  for (const r of reviews) {
    if (r.subScores && r.subScores.length > 0) continue;
    const { subScores } = deriveScore(r.sections.effectiveness ?? "");
    if (subScores.length > 0) {
      r.subScores = subScores;
      updated++;
    }
  }
  if (updated) writeReviews(reviews);
  return { updated, total: reviews.length };
}

/** One-time backfill: fill missing publisher/gurus/product on existing reviews. Returns count updated. */
export function backfillMetadata(): { updated: number; total: number } {
  const reviews = readReviews();
  let updated = 0;
  for (const r of reviews) {
    const seed = seedMetadata(r);
    let changed = false;
    if ((r.publisher == null || r.publisher === "") && seed.publisher) { r.publisher = seed.publisher; changed = true; }
    if ((!r.gurus || r.gurus.length === 0) && seed.gurus.length) { r.gurus = seed.gurus; changed = true; }
    if ((r.product == null || r.product === "") && seed.product) { r.product = seed.product; changed = true; }
    if (changed) updated++;
  }
  if (updated) writeReviews(reviews);
  return { updated, total: reviews.length };
}

/**
 * Canonical backfill: match each review's copy against the brain's Financial
 * Publishing Directory and set publisher/gurus/product to the CANONICAL names
 * (so everything links uniformly in the brain). Overwrites a value only when a
 * confident directory match exists; otherwise keeps the existing value and, if
 * blank, falls back to detection/offer-parse. Never clears a value to empty.
 */
export async function backfillMetadataCanonical(): Promise<{ updated: number; total: number; matched: number }> {
  // Lazy import to avoid load-time cycles.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const br = require("./brain-reader") as {
    findCanonicalGurusInText: (text: string) => Promise<string[]>;
  };

  const reviews = readReviews();
  let updated = 0;
  let matched = 0;
  for (const r of reviews) {
    const text = `${r.sections.offer ?? ""}\n${r.sections.effectiveness ?? ""}`;
    let changed = false;

    // Match canonical gurus by name in the copy (uses live ∪ snapshot list).
    const gurus = (await br.findCanonicalGurusInText(text)).filter((g) => !NON_GURU_HOSTS.has(g));
    if (gurus.length) {
      matched++;
      if (JSON.stringify(gurus) !== JSON.stringify(r.gurus ?? [])) { r.gurus = gurus; changed = true; }
    }

    // Normalize the old verbose MTA label to the canonical directory name
    if (r.publisher === "Monument Traders Alliance (MTA / Oxford Group / Agora)") {
      r.publisher = "Monument Traders Alliance";
      changed = true;
    }

    // Fill any remaining blanks from detection / offer parse
    const seed = seedMetadata(r);
    if ((r.publisher == null || r.publisher === "") && seed.publisher) { r.publisher = seed.publisher; changed = true; }
    if ((!r.gurus || r.gurus.length === 0) && seed.gurus.length) { r.gurus = seed.gurus; changed = true; }
    if ((r.product == null || r.product === "") && seed.product) { r.product = seed.product; changed = true; }

    if (changed) updated++;
  }
  if (updated) writeReviews(reviews);
  return { updated, total: reviews.length, matched };
}

export function saveReview(
  filename: string,
  sections: AnalysisSections,
  fkReadingEase: number | null,
  fkGradeLevel: number | null,
  promoRunStartDate?: string | null,
  inputType?: InputType,
  promoCode?: string | null
): SavedReview {
  const reviews = readReviews();

  // Final score is DERIVED in code from the 8 sub-scores (conversion-weighted
  // blend + bounded model adjustment), not the model's holistic number.
  const { subScores, finalScore } = deriveScore(sections.effectiveness);

  const review: SavedReview = {
    id: uuidv4(),
    filename,
    date: new Date().toISOString(),
    promoRunStartDate: promoRunStartDate ?? null,
    promoCode: promoCode?.trim() || null,
    effectivenessScore: finalScore,
    predictedScore: finalScore, // calibration baseline — the model's copy-based prediction
    subScores: subScores.length > 0 ? subScores : undefined,
    inputType,
    fkReadingEase,
    fkGradeLevel,
    sections,
  };

  // Auto-seed editable metadata (publisher/gurus/product) from detection so the
  // Offer Details fields are pre-filled; the user can correct any of them.
  const seed = seedMetadata(review);
  review.publisher = seed.publisher;
  review.gurus = seed.gurus;
  review.product = seed.product;

  reviews.push(review);
  writeReviews(reviews);
  return review;
}

export function updateReviewCUB(id: string, cub: string): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].sections.cub = cub;
  writeReviews(reviews);
  return true;
}

export function updateSourceFileMeta(
  reviewId: string,
  filename: string,
  size: number
): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === reviewId);
  if (idx === -1) return false;
  reviews[idx].sourceFile = { filename, size };
  writeReviews(reviews);
  return true;
}

export function addSupplementalFile(
  reviewId: string,
  file: SupplementalFile
): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === reviewId);
  if (idx === -1) return false;
  reviews[idx].supplementalFiles = [...(reviews[idx].supplementalFiles ?? []), file];
  writeReviews(reviews);
  return true;
}

export function removeSupplementalFile(
  reviewId: string,
  fileId: string
): SupplementalFile | null {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === reviewId);
  if (idx === -1) return null;
  const file = reviews[idx].supplementalFiles?.find((f) => f.id === fileId) ?? null;
  if (!file) return null;
  reviews[idx].supplementalFiles = (reviews[idx].supplementalFiles ?? []).filter(
    (f) => f.id !== fileId
  );
  writeReviews(reviews);
  return file;
}

export function getReviewById(id: string): SavedReview | null {
  return readReviews().find((r) => r.id === id) ?? null;
}

export function updateReviewTraining(
  id: string,
  training: TrainingData
): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].training = training;
  // When a re-evaluation is applied, it now regenerates the full 8-dimension
  // breakdown. Derive the displayed sub-scores + final from it so the breakdown
  // and the headline stay coherent. Do NOT touch predictedScore — that's the
  // copy-based calibration baseline.
  if (training.calibratedEffectiveness) {
    const { subScores, finalScore } = deriveScore(training.calibratedEffectiveness);
    if (subScores.length > 0) reviews[idx].subScores = subScores;
    if (finalScore != null) {
      reviews[idx].effectivenessScore = finalScore;
    } else {
      // Legacy calibrated text with only a "Score: X/10" line — fall back to it.
      const m = training.calibratedEffectiveness.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
      if (m) reviews[idx].effectivenessScore = parseFloat(m[1]);
    }
  }
  writeReviews(reviews);
  return true;
}

export function updateReviewRunDate(id: string, promoRunStartDate: string | null): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].promoRunStartDate = promoRunStartDate;
  writeReviews(reviews);
  return true;
}

export function updateReviewPromoCode(id: string, promoCode: string | null): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].promoCode = promoCode?.trim() || null;
  writeReviews(reviews);
  return true;
}

export function updateReviewPublisher(id: string, publisher: string | null): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].publisher = publisher?.trim() || null;
  writeReviews(reviews);
  return true;
}

export function updateReviewGurus(id: string, gurus: string[]): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].gurus = Array.from(new Set((gurus ?? []).map((g) => g.trim()).filter(Boolean)));
  writeReviews(reviews);
  return true;
}

export function updateReviewProduct(id: string, product: string | null): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].product = product?.trim() || null;
  writeReviews(reviews);
  return true;
}

export function renameReview(id: string, displayName: string): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const trimmed = displayName.trim();
  if (trimmed) {
    reviews[idx].displayName = trimmed;
  } else {
    delete reviews[idx].displayName;
  }
  writeReviews(reviews);
  return true;
}

export function updateReviewSections(
  id: string,
  sections: AnalysisSections,
  fkReadingEase: number | null,
  fkGradeLevel: number | null
): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].sections = sections;
  reviews[idx].fkReadingEase = fkReadingEase;
  reviews[idx].fkGradeLevel = fkGradeLevel;
  const { subScores, finalScore } = deriveScore(sections.effectiveness);
  reviews[idx].effectivenessScore = finalScore;
  reviews[idx].predictedScore = finalScore; // re-analysis is a fresh copy-based prediction → refresh the calibration baseline
  reviews[idx].subScores = subScores.length > 0 ? subScores : undefined;
  // Clear any previously calibrated effectiveness — it was based on the old scoring
  if (reviews[idx].training?.calibratedEffectiveness) {
    reviews[idx].training!.calibratedEffectiveness = undefined;
  }
  writeReviews(reviews);
  return true;
}

export function updateReviewInputType(id: string, inputType: InputType): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].inputType = inputType;
  writeReviews(reviews);
  return true;
}

export function deleteReview(id: string): boolean {
  const reviews = readReviews();
  const filtered = reviews.filter((r) => r.id !== id);
  if (filtered.length === reviews.length) return false;
  writeReviews(filtered);
  return true;
}
