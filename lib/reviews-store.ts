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

export interface TrainingData {
  promoType: PromoType | null;
  performanceScore: number | null; // actual real-world performance (high weight)
  myScore: number | null;          // analyst's personal assessment (lower weight)
  reasoning: string;
  lastUpdated: string;
}

export interface SavedReview {
  id: string;
  filename: string;
  displayName?: string;
  date: string;
  effectivenessScore: number | null;
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
  predictedScore: number | null;
  performanceScore: number | null;
  myScore: number | null;
  reasoning: string;
  bigIdea: string;
}> {
  const reviews = readReviews().filter((r) => r.training != null);
  return reviews.map((r) => {
    const name = r.displayName ?? r.filename.replace(/\.[^.]+$/, "");
    // Extract Big Idea from offer section
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
    return {
      name,
      promoType: r.training!.promoType ?? null,
      predictedScore: r.effectivenessScore,
      performanceScore: r.training!.performanceScore,
      myScore: r.training!.myScore,
      reasoning: r.training!.reasoning,
      bigIdea,
    };
  });
}

export function saveReview(
  filename: string,
  sections: AnalysisSections,
  fkReadingEase: number | null,
  fkGradeLevel: number | null
): SavedReview {
  const reviews = readReviews();

  const effectivenessMatch = sections.effectiveness.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  const effectivenessScore = effectivenessMatch
    ? parseFloat(effectivenessMatch[1])
    : null;

  const review: SavedReview = {
    id: uuidv4(),
    filename,
    date: new Date().toISOString(),
    effectivenessScore,
    fkReadingEase,
    fkGradeLevel,
    sections,
  };

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
  training: TrainingData,
  newEffectiveness?: string
): boolean {
  const reviews = readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reviews[idx].training = training;
  if (newEffectiveness !== undefined) {
    reviews[idx].sections.effectiveness = newEffectiveness;
    const m = newEffectiveness.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    if (m) reviews[idx].effectivenessScore = parseFloat(m[1]);
  }
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

export function deleteReview(id: string): boolean {
  const reviews = readReviews();
  const filtered = reviews.filter((r) => r.id !== id);
  if (filtered.length === reviews.length) return false;
  writeReviews(filtered);
  return true;
}
