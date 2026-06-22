"use client";

import { useEffect, useState } from "react";
import type { Lesson, LessonCategory } from "@/lib/learning-kb";
import type { CalibrationStats } from "@/lib/reviews-store";

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

function fmt(n: number | null, digits = 2): string {
  return n === null ? "—" : n.toFixed(digits);
}

function biasLabel(signedBias: number): string {
  if (signedBias > 0.05) return "over-rating";
  if (signedBias < -0.05) return "under-rating";
  return "well-calibrated";
}

function CalibrationPanel({ stats }: { stats: CalibrationStats }) {
  if (stats.n === 0) {
    return (
      <div
        className="rounded-xl p-4 border bg-white"
        style={{ borderColor: NAVY_BORDER }}
      >
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: NAVY }}>
          Calibration
        </h4>
        <p className="text-sm text-gray-400">
          No labeled reviews yet. Add real-world performance scores in the Training tab to
          measure how well predicted scores track actual results.
        </p>
      </div>
    );
  }

  const systematicBiases = [...stats.byPromoType.map((s) => ({ dim: "Promo type", ...s })),
    ...stats.byGuru.map((s) => ({ dim: "Guru", ...s }))]
    .filter((s) => s.n >= 2 && Math.abs(s.signedBias) >= 0.5)
    .sort((a, b) => Math.abs(b.signedBias) - Math.abs(a.signedBias))
    .slice(0, 6);

  return (
    <div className="rounded-xl p-5 border bg-white space-y-5" style={{ borderColor: NAVY_BORDER }}>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: NAVY }}>
          Calibration ({stats.n} labeled review{stats.n === 1 ? "" : "s"})
        </h4>
        <p className="text-[11px] text-amber-600 mt-0.5">
          Directional until ~30–50 labeled reviews.
        </p>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Band accuracy", value: stats.bandAccuracy === null ? "—" : `${stats.bandAccuracy.toFixed(0)}%`, hint: "predicted tier == actual tier" },
          { label: "Correlation (r)", value: fmt(stats.correlation), hint: "predicted vs actual" },
          { label: "MAE", value: fmt(stats.mae, 1), hint: "mean abs error" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg px-3 py-2" style={{ background: NAVY_BG }}>
            <p className="text-lg font-bold tabular-nums" style={{ color: NAVY }}>{m.value}</p>
            <p className="text-[11px] font-semibold text-gray-600">{m.label}</p>
            <p className="text-[10px] text-gray-400">{m.hint}</p>
          </div>
        ))}
      </div>

      {/* Bucket table */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
          By actual tier
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-400">
              <th className="text-left font-semibold py-1">Band</th>
              <th className="text-right font-semibold py-1">n</th>
              <th className="text-right font-semibold py-1">Avg predicted</th>
              <th className="text-right font-semibold py-1">Avg actual</th>
            </tr>
          </thead>
          <tbody>
            {stats.buckets.map((b) => (
              <tr key={b.band} className="border-t border-gray-100">
                <td className="py-1 text-gray-700">{b.band}</td>
                <td className="py-1 text-right tabular-nums text-gray-700">{b.n}</td>
                <td className="py-1 text-right tabular-nums text-gray-700">{fmt(b.avgPredicted, 1)}</td>
                <td className="py-1 text-right tabular-nums text-gray-700">{fmt(b.avgActual, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Systematic biases */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
          Systematic biases
        </p>
        {systematicBiases.length === 0 ? (
          <p className="text-sm text-gray-400">No material systematic bias detected (need ≥2 per slice).</p>
        ) : (
          <ul className="space-y-1">
            {systematicBiases.map((s, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                <span>
                  <span className="text-gray-400">{s.dim}:</span> {s.key}{" "}
                  <span className="text-gray-400">(n={s.n})</span>
                </span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: s.signedBias > 0 ? "#991b1b" : "#166534" }}
                >
                  {s.signedBias > 0 ? "+" : ""}{s.signedBias.toFixed(1)} {biasLabel(s.signedBias)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function LessonsTab() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [stats, setStats] = useState<CalibrationStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [lessonsRes, statsRes] = await Promise.all([
          fetch("/api/learning"),
          fetch("/api/reviews?stats=true"),
        ]);
        if (!lessonsRes.ok) throw new Error("Failed to load lessons");
        const data: Lesson[] = await lessonsRes.json();
        if (active) setLessons(Array.isArray(data) ? data : []);
        if (statsRes.ok) {
          const s: CalibrationStats = await statsRes.json();
          if (active) setStats(s);
        }
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

  // Group lessons by category
  const byCategory: Partial<Record<LessonCategory, Lesson[]>> = {};
  for (const l of lessons) {
    (byCategory[l.category] ??= []).push(l);
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {stats && <CalibrationPanel stats={stats} />}

      {lessons.length === 0 && (
        <p className="text-sm text-gray-400">
          No lessons yet. Train promos in the Training tab to build the knowledge base.
        </p>
      )}

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
