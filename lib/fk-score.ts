import { syllable } from "syllable";

export interface FKScore {
  readingEase: number;
  gradeLevel: number;
  label: string;
}

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

function countSyllables(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.reduce((sum, word) => sum + syllable(word), 0);
}

export function readingEaseLabel(score: number): string {
  if (score >= 90) return "Very Easy";
  if (score >= 80) return "Easy";
  if (score >= 70) return "Fairly Easy";
  if (score >= 60) return "Standard";
  if (score >= 50) return "Fairly Difficult";
  if (score >= 30) return "Difficult";
  return "Very Difficult";
}

export function calculateFKScore(text: string): FKScore {
  const words = countWords(text);
  const sentences = countSentences(text);
  const syllables = countSyllables(text);

  if (words === 0 || sentences === 0) {
    return { readingEase: 0, gradeLevel: 0, label: "N/A" };
  }

  const asl = words / sentences;
  const asw = syllables / words;

  const readingEase = Math.round(206.835 - 1.015 * asl - 84.6 * asw);
  const gradeLevel = Math.round((0.39 * asl + 11.8 * asw - 15.59) * 10) / 10;

  return {
    readingEase: Math.max(0, Math.min(100, readingEase)),
    gradeLevel: Math.max(0, gradeLevel),
    label: readingEaseLabel(readingEase),
  };
}
