"use client";

import { useEffect, useState } from "react";
import type { Lesson, LessonCategory } from "@/lib/learning-kb";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

const CATEGORY_LABELS: Record<LessonCategory, string> = {
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

// Stable display order for the category sections
const CATEGORY_ORDER: LessonCategory[] = [
  "hook",
  "mechanism",
  "offer",
  "audience",
  "structure",
  "proof",
  "credibility",
  "guru",
  "scoring_calibration",
];

function LessonCard({ lesson }: { lesson: Lesson }) {
  const meta = [lesson.guru, lesson.publication, lesson.promoType]
    .filter(Boolean)
    .join(" / ");
  const hasScores =
    lesson.predictedScore !== null && lesson.actualPerformance !== null;

  return (
    <div
      className="rounded-xl p-4 border bg-white"
      style={{ borderColor: NAVY_BORDER }}
    >
      <div className="flex items-start gap-2">
        {lesson.isGoldStandard && (
          <span
            className="mt-1.5 w-2 h-2 rounded-full shrink-0"
            style={{ background: NAVY }}
            title="High-confidence lesson"
          />
        )}
        <p className="text-sm text-gray-800 leading-relaxed flex-1">
          {lesson.lesson}
        </p>
      </div>

      {(meta || hasScores || lesson.isGoldStandard) && (
        <div className="flex items-center gap-3 flex-wrap mt-2.5 pl-0">
          {lesson.isGoldStandard && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: NAVY_BG, color: NAVY }}
            >
              High-confidence
            </span>
          )}
          {meta && (
            <span className="text-xs text-gray-400 font-medium">{meta}</span>
          )}
          {hasScores && (
            <span className="text-xs font-semibold tabular-nums" style={{ color: NAVY }}>
              predicted {lesson.predictedScore} &rarr; actual {lesson.actualPerformance}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function LessonsTab() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/learning");
        if (!res.ok) throw new Error("Failed to load lessons");
        const data: Lesson[] = await res.json();
        if (active) setLessons(Array.isArray(data) ? data : []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load lessons");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-2xl">
        {error}
      </p>
    );
  }

  if (lessons === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <div
          className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: NAVY_BORDER, borderTopColor: NAVY }}
        />
        <p className="text-sm">Loading knowledge base…</p>
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <p className="text-sm text-gray-400 max-w-2xl">
        No lessons yet. Train promos in the Training tab to build the knowledge base.
      </p>
    );
  }

  // Group lessons by category
  const byCategory: Partial<Record<LessonCategory, Lesson[]>> = {};
  for (const l of lessons) {
    (byCategory[l.category] ??= []).push(l);
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h3 className="text-base font-bold" style={{ color: NAVY }}>
          Lessons Learned
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Generalizable insights extracted from training events — accumulated knowledge
          about what works and fails for this audience.
        </p>
      </div>

      {CATEGORY_ORDER.filter((cat) => byCategory[cat]?.length).map((cat) => (
        <div key={cat}>
          <h4
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: NAVY }}
          >
            {CATEGORY_LABELS[cat]}
          </h4>
          <div className="space-y-3">
            {byCategory[cat]!.map((l) => (
              <LessonCard key={l.id} lesson={l} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
