import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const DATA_DIR = path.join(process.cwd(), "data");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");

export interface SavedReview {
  id: string;
  filename: string;
  date: string;
  effectivenessScore: number | null;
  fkReadingEase: number | null;
  fkGradeLevel: number | null;
  sections: AnalysisSections;
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

export function saveReview(
  filename: string,
  sections: AnalysisSections,
  fkReadingEase: number | null,
  fkGradeLevel: number | null
): SavedReview {
  const reviews = readReviews();

  const effectivenessMatch = sections.effectiveness.match(/(\d+)\s*\/\s*10/);
  const effectivenessScore = effectivenessMatch
    ? parseInt(effectivenessMatch[1], 10)
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

export function deleteReview(id: string): boolean {
  const reviews = readReviews();
  const filtered = reviews.filter((r) => r.id !== id);
  if (filtered.length === reviews.length) return false;
  writeReviews(filtered);
  return true;
}
