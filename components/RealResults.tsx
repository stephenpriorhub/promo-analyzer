"use client";

/**
 * Real-World Results — the actual numbers for this promo, shown on the
 * analysis view whenever a creative code is set and a matching row exists in
 * the performance sheet (live, 5-min cache) or the imported dataset. No code
 * or no match → renders nothing. Display-only: real outcomes never feed the
 * Copy Quality Score.
 */

import { useEffect, useState } from "react";
import { classifyStatColumn, formatStatValue } from "@/lib/stat-format";

const NAVY = "#012479";

interface StatsResponse {
  configured: boolean;
  stats: { promoCode: string; stats: Record<string, string> } | null;
  tier: { tier: string; line: string } | null;
}

const TIER_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  gold_standard: { bg: "#fef3c7", fg: "#92400e", label: "Top Performer" },
  strong: { bg: "#dcfce7", fg: "#166534", label: "Strong" },
  average: { bg: "#f1f5f9", fg: "#475569", label: "Average" },
  weak: { bg: "#ffedd5", fg: "#9a3412", label: "Weak" },
  failed: { bg: "#fee2e2", fg: "#991b1b", label: "Failed" },
};

interface Predicted {
  score: number;
  n: number;
  neighbors: number;
  confidence: "low" | "medium" | "high";
}

export default function RealResults({ promoCode, reviewId }: { promoCode: string | null; reviewId?: string | null }) {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [predicted, setPredicted] = useState<Predicted | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!promoCode?.trim()) {
        if (!cancelled) setData(null);
        return;
      }
      try {
        const res = await fetch(`/api/promo-stats?code=${encodeURIComponent(promoCode)}`);
        if (!cancelled && res.ok) setData(await res.json());
      } catch {
        /* soft — panel just stays hidden */
      }
    })();
    return () => { cancelled = true; };
  }, [promoCode]);

  // When there's no real data, fetch a predicted performance score for context.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!reviewId || data?.stats) { if (!cancelled) setPredicted(null); return; }
      try {
        const res = await fetch(`/api/predict?reviewId=${encodeURIComponent(reviewId)}`);
        if (!cancelled && res.ok) setPredicted((await res.json()).predicted ?? null);
      } catch {
        /* soft */
      }
    })();
    return () => { cancelled = true; };
  }, [reviewId, data?.stats]);

  // No real data → show the predicted score panel if we have one.
  if (!promoCode?.trim() || !data?.stats) {
    if (!predicted) return null;
    return (
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: "#e2d9c8", background: "#fdfaf3" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold" style={{ color: "#7c5e10" }}>Predicted Performance</h3>
          <span className="text-lg font-bold" style={{ color: NAVY }}>{predicted.score}/10</span>
          <span className="text-xs text-gray-400">({predicted.confidence} confidence)</span>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Estimated from the real results of the {predicted.neighbors} most copy-similar promos (of {predicted.n} with known outcomes). No real data for this promo yet — set its creative code once it runs to replace this with actuals. Directional only; copy is a minority of what drives performance.
        </p>
      </div>
    );
  }

  const entries = Object.entries(data.stats.stats).filter(([, v]) => v.trim());
  if (entries.length === 0) return null;
  const tierStyle = data.tier ? TIER_STYLE[data.tier.tier] : null;

  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: "#c8e0cd", background: "#f4faf5" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold" style={{ color: "#14532d" }}>
          Real-World Results
        </h3>
        <span className="text-xs font-mono text-gray-400">{data.stats.promoCode}</span>
        {tierStyle && data.tier && (
          <span
            className="text-xs font-semibold rounded-full px-2 py-0.5"
            style={{ background: tierStyle.bg, color: tierStyle.fg }}
            title={data.tier.line}
          >
            {tierStyle.label}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="text-xs">
            <span className="text-gray-400">{k}: </span>
            <span className="font-semibold" style={{ color: NAVY }}>{formatStatValue(v, classifyStatColumn(k))}</span>
          </div>
        ))}
      </div>
      {data.tier && <p className="text-[11px] text-gray-400 mt-1.5">{data.tier.line}</p>}
    </div>
  );
}
