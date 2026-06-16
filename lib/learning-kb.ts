/**
 * Learning Knowledge Base
 *
 * Stores generalizable lessons extracted from training events.
 * Unlike per-review calibration data, these lessons survive delete/re-upload
 * and accumulate into a growing model of what works and fails for this audience.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const KB_FILE = path.join(DATA_DIR, "learning-kb.json");

export type LessonCategory =
  | "hook"
  | "mechanism"
  | "offer"
  | "audience"
  | "structure"
  | "proof"
  | "credibility"
  | "guru"
  | "scoring_calibration";

export type PerformanceTier = "gold_standard" | "strong" | "average" | "weak" | "failed";

export interface Lesson {
  id: string;
  createdAt: string;
  updatedAt: string;

  // The generalizable insight — written to inform future scoring, not reference a specific promo
  lesson: string;

  // Optional: which guru / publication this applies to (null = universal)
  guru: string | null;
  publication: string | null;
  promoType: string | null;

  category: LessonCategory;

  // Evidence trail — survives even if the source review is deleted
  evidenceCount: number; // how many training events support this lesson
  supportingPromos: string[]; // promo display names (not IDs) — breadcrumb only
  predictedScore: number | null; // tool's original prediction
  actualPerformance: number | null; // real-world result
  performanceTier: PerformanceTier | null;

  // Whether this is a gold-standard anchor (top performer)
  isGoldStandard: boolean;

  // The original reasoning from the publisher
  publisherReasoning: string;
}

export interface LearningKB {
  version: number;
  lastUpdated: string;
  lessons: Lesson[];
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readKB(): LearningKB {
  ensureDataDir();
  if (!fs.existsSync(KB_FILE)) {
    return { version: 1, lastUpdated: new Date().toISOString(), lessons: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(KB_FILE, "utf-8")) as LearningKB;
  } catch {
    return { version: 1, lastUpdated: new Date().toISOString(), lessons: [] };
  }
}

function writeKB(kb: LearningKB) {
  ensureDataDir();
  kb.lastUpdated = new Date().toISOString();
  fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2), "utf-8");
}

export function getAllLessons(): Lesson[] {
  return readKB().lessons;
}

export function addLessons(newLessons: Omit<Lesson, "id" | "createdAt" | "updatedAt">[]): void {
  const kb = readKB();
  for (const l of newLessons) {
    kb.lessons.push({
      ...l,
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  writeKB(kb);
}

/**
 * Build the learning block injected into the system prompt.
 * Groups lessons by category and highlights high-confidence anchors.
 */
export function buildLearningBlock(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";

  const highConfidence = lessons.filter((l) => l.isGoldStandard);
  const standard = lessons.filter((l) => !l.isGoldStandard);

  const lines: string[] = [];

  lines.push("\n\n## Publisher Learning Library");
  lines.push(
    "The following lessons have been extracted from real training events — actual market performance compared against predicted scores. These represent accumulated knowledge about what works and fails for this specific audience and publication. Weight these heavily."
  );

  if (highConfidence.length > 0) {
    lines.push("\n### High-Confidence Lessons");
    lines.push(
      "These lessons come from training events the publisher marked as strong signals (verified top performance). When a promo shares the characteristics described, weight these heavily and anchor your scoring accordingly — do not nitpick the score down for minor copy imperfections."
    );
    for (const l of highConfidence) {
      const ctx = [l.guru, l.publication, l.promoType].filter(Boolean).join(" / ");
      lines.push(`\n- ${l.lesson}${ctx ? ` *(${ctx})*` : ""}`);
      if (l.publisherReasoning) lines.push(`  Publisher context: "${l.publisherReasoning}"`);
    }
  }

  if (standard.length > 0) {
    // Group by category
    const byCategory: Partial<Record<LessonCategory, Lesson[]>> = {};
    for (const l of standard) {
      if (!byCategory[l.category]) byCategory[l.category] = [];
      byCategory[l.category]!.push(l);
    }

    const categoryLabels: Record<LessonCategory, string> = {
      hook: "Hook Patterns",
      mechanism: "Mechanism Patterns",
      offer: "Offer & Structure",
      audience: "Audience Fit",
      structure: "Promo Structure",
      proof: "Proof & Credibility",
      credibility: "Credibility",
      guru: "Guru-Specific Insights",
      scoring_calibration: "Scoring Calibration",
    };

    for (const [cat, catLessons] of Object.entries(byCategory)) {
      lines.push(`\n### ${categoryLabels[cat as LessonCategory] ?? cat}`);
      for (const l of catLessons!) {
        const ctx = [l.guru, l.publication, l.promoType].filter(Boolean).join(" / ");
        const perf =
          l.actualPerformance !== null && l.predictedScore !== null
            ? ` [predicted ${l.predictedScore}/10 → actual ${l.actualPerformance}/10]`
            : "";
        lines.push(`- ${l.lesson}${ctx ? ` *(${ctx})*` : ""}${perf}`);
      }
    }
  }

  return lines.join("\n");
}
