"use client";

import { useState } from "react";
import type { TrainingData } from "@/lib/reviews-store";
import { PROMO_TYPES, type PromoType } from "@/lib/promo-types";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface Props {
  reviewId: string | null;
  effectivenessContent: string;
  initialTraining?: TrainingData;
  onEffectivenessUpdate: (newText: string) => void;
  onApplied?: () => void;
}

function scoreColor(n: number): string {
  if (n <= 2) return "#dc2626";
  if (n <= 4) return "#ea580c";
  if (n <= 6) return "#ca8a04";
  if (n <= 8) return "#16a34a";
  return "#0369a1";
}

const SCORE_LABELS: Record<number, string> = {
  1: "Failed / Pulled",
  2: "Very Poor",
  3: "Below Average",
  4: "Weak",
  5: "Average",
  6: "Above Average",
  7: "Strong",
  8: "Very Strong",
  9: "Top Performer",
  10: "All-Time Best / Control",
};

function ScoreSelector({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex gap-1 flex-wrap">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const selected = value === n;
          const color = scoreColor(n);
          return (
            <button
              key={n}
              onClick={() => !disabled && onChange(n)}
              disabled={disabled}
              className="w-9 h-9 rounded-lg text-sm font-bold transition-all disabled:cursor-not-allowed"
              style={{
                background: selected ? color : "transparent",
                color: selected ? "white" : color,
                border: `2px solid ${color}`,
                opacity: disabled ? 0.5 : !selected && value !== null ? 0.45 : 1,
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      {value !== null && (
        <p className="text-xs mt-1.5 font-semibold" style={{ color: scoreColor(value) }}>
          {SCORE_LABELS[value]}
        </p>
      )}
    </div>
  );
}

export default function TrainingTab({
  reviewId,
  effectivenessContent,
  initialTraining,
  onEffectivenessUpdate,
  onApplied,
}: Props) {
  const [promoType, setPromoType] = useState<PromoType | null>(
    initialTraining?.promoType ?? null
  );
  const [performanceScore, setPerformanceScore] = useState<number | null>(
    initialTraining?.performanceScore ?? null
  );
  const [myScore, setMyScore] = useState<number | null>(
    initialTraining?.myScore ?? null
  );
  const [reasoning, setReasoning] = useState(initialTraining?.reasoning ?? "");
  const [lastSaved, setLastSaved] = useState(initialTraining?.lastUpdated ?? null);

  const [isBestPerformer, setIsBestPerformer] = useState(
    initialTraining?.isBestPerformer ?? false
  );
  const [saving, setSaving] = useState(false);
  const [reevaluating, setReevaluating] = useState(false);
  const [reevalResult, setReevalResult] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const hasScore = performanceScore !== null || myScore !== null;
  const hasSomething = hasScore || promoType !== null || reasoning.trim().length > 0;
  const canSave = !!reviewId && hasSomething;

  async function handleSave(calibrated?: string) {
    // Always allow save when applying a calibration; otherwise require canSave
    if (!reviewId || (!canSave && !calibrated)) return;
    setSaving(true);
    const training: TrainingData = {
      promoType,
      performanceScore,
      myScore,
      reasoning: reasoning.trim(),
      lastUpdated: new Date().toISOString(),
      calibratedEffectiveness: calibrated ?? initialTraining?.calibratedEffectiveness,
      isBestPerformer,
    };
    await fetch("/api/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reviewId, training }),
    });
    setLastSaved(training.lastUpdated);
    setSaving(false);
  }

  async function handleReevaluate() {
    if (!hasScore) return;
    setReevaluating(true);
    setReevalResult(null);
    setApplied(false);
    try {
      const res = await fetch("/api/reevaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveness: effectivenessContent,
          promoType,
          performanceScore,
          myScore,
          reasoning: reasoning.trim(),
          isBestPerformer,
        }),
      });
      const json = await res.json();
      if (res.ok && json.effectiveness) {
        setReevalResult(json.effectiveness);
      }
    } finally {
      setReevaluating(false);
    }
  }

  async function handleApply() {
    if (!reevalResult) return;
    onEffectivenessUpdate(reevalResult);
    setApplied(true);
    await handleSave(reevalResult);
    onApplied?.();
  }

  const extractScore = (text: string) => {
    const m = text.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    return m ? parseFloat(m[1]) : null;
  };

  const reevalScore = reevalResult ? extractScore(reevalResult) : null;

  return (
    <div className="space-y-7 max-w-2xl">
      {/* Header */}
      <div>
        <h3 className="text-base font-bold" style={{ color: NAVY }}>
          Training Data
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Score this promo based on actual results to calibrate future analyses.
          Performance score is weighted ~70%, your assessment ~30%.
        </p>
      </div>

      {/* Promo Type */}
      <div>
        <label
          className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
          style={{ color: NAVY }}
        >
          Promo Type
        </label>
        <div className="flex flex-wrap gap-2">
          {PROMO_TYPES.map((t) => {
            const selected = promoType === t;
            return (
              <button
                key={t}
                onClick={() => setPromoType(selected ? null : t)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                style={{
                  background: selected ? NAVY : "white",
                  color: selected ? "white" : NAVY,
                  borderColor: NAVY_BORDER,
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Performance Score */}
      <div
        className="rounded-xl p-5 border space-y-3"
        style={{ background: NAVY_BG, borderColor: NAVY_BORDER }}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: NAVY }}>
            Actual Performance Score
          </p>
          <p className="text-xs text-gray-500">
            Based on real conversion data, revenue, and market results.
            <span className="ml-1 font-semibold" style={{ color: NAVY }}>
              High weight.
            </span>
          </p>
        </div>
        <ScoreSelector value={performanceScore} onChange={setPerformanceScore} />
      </div>

      {/* My Score */}
      <div className="rounded-xl p-5 border border-slate-200 bg-slate-50 space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-0.5 text-slate-700">
            Your Assessment
          </p>
          <p className="text-xs text-gray-500">
            Your gut-feel score on copy quality and concept strength.
            <span className="ml-1 font-medium text-slate-600">Lower weight.</span>
          </p>
        </div>
        <ScoreSelector value={myScore} onChange={setMyScore} />
      </div>

      {/* Strong-signal flag — weight this context heavily in re-analysis */}
      <div
        className="rounded-xl p-4 border flex items-start gap-3 cursor-pointer select-none"
        style={{
          background: isBestPerformer ? NAVY_BG : "white",
          borderColor: isBestPerformer ? NAVY : NAVY_BORDER,
        }}
        onClick={() => setIsBestPerformer((v) => !v)}
      >
        <div
          className="mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 text-sm border-2 transition-all"
          style={{
            background: isBestPerformer ? NAVY : "white",
            borderColor: isBestPerformer ? NAVY : "#cbd5e1",
          }}
        >
          {isBestPerformer && <span className="text-white font-bold text-xs">✓</span>}
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: NAVY }}>
            Weight this context heavily
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Check when your feedback is a strong signal you want the re-analysis to take seriously. It will lean into your context and stop docking the score for minor copy nitpicks. Used internally to calibrate scoring — never shown in the analysis output.
          </p>
        </div>
      </div>

      {/* Reasoning */}
      <div>
        <label
          className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
          style={{ color: NAVY }}
        >
          Notes / Reasoning
        </label>
        <textarea
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          rows={3}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          style={{ borderColor: NAVY_BORDER }}
          placeholder="What made this promo succeed or fail? Big idea mismatch, wrong audience, weak lead…"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleReevaluate}
          disabled={!hasScore || reevaluating}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40 transition-opacity"
          style={{ background: NAVY }}
        >
          {reevaluating ? "Recalibrating…" : "⟳ Re-evaluate Score"}
        </button>
        <button
          onClick={() => handleSave()}
          disabled={!canSave || saving}
          className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40"
          style={{ borderColor: NAVY_BORDER, color: NAVY, background: "white" }}
          title="Save feedback without changing the displayed score"
        >
          {saving ? "Saving…" : "Learn Only"}
        </button>
        {lastSaved && !saving && (
          <span className="text-xs text-gray-400">
            Saved {new Date(lastSaved).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            })}
          </span>
        )}
      </div>

      {/* Re-evaluate result preview */}
      {reevalResult && (
        <div className="rounded-xl border-2 p-5 space-y-3" style={{ borderColor: NAVY }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>
              Calibrated Score Preview
            </p>
            {reevalScore !== null && (
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: scoreColor(reevalScore) }}
              >
                {reevalScore}/10
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {reevalResult.replace(/^Score:\s*[\d.]+\s*\/\s*10\s*/i, "").replace(/^Rationale:\s*/i, "")}
          </p>
          {applied ? (
            <p className="text-sm font-medium text-green-600">✓ Applied & feedback saved</p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleApply}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: NAVY }}
              >
                Apply to Analysis
              </button>
              <button
                onClick={() => setReevalResult(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* No reviewId warning */}
      {!reviewId && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Analysis must complete before training data can be saved.
        </p>
      )}
    </div>
  );
}
