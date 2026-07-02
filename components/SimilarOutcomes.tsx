"use client";

/**
 * Similar-Promo Outcomes (Experimental) — what actually happened to promos with
 * a similar copy profile. A deliberately SEPARATE panel from the Copy Quality
 * Score: this reports facts about comparable promos' real results (and, once
 * the layer passes its own validation gates, a neighbor-majority outlook). It
 * never feeds or restyles the craft score.
 */

import { useEffect, useState } from "react";

const NAVY = "#012479";

interface Comparable {
  reviewId: string;
  name: string;
  guru: string | null;
  publisher: string | null;
  distance: number;
  performanceScore: number;
  band: "7–10" | "4–6" | "1–3";
}

interface Outlook {
  mode: "off" | "comparables" | "prediction";
  n: number;
  comparables: Comparable[];
  predictedBand?: string;
  agreement?: { count: number; k: number };
  looAccuracy?: number;
  baseRate?: number;
  disclaimer: string;
}

const BAND_STYLE: Record<Comparable["band"], { bg: string; fg: string }> = {
  "7–10": { bg: "#dcfce7", fg: "#166534" },
  "4–6": { bg: "#f1f5f9", fg: "#475569" },
  "1–3": { bg: "#fee2e2", fg: "#991b1b" },
};

export default function SimilarOutcomes({ reviewId }: { reviewId: string }) {
  const [outlook, setOutlook] = useState<Outlook | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/predict?reviewId=${encodeURIComponent(reviewId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (!cancelled && o) setOutlook(o); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [reviewId]);

  if (!outlook || outlook.mode === "off" || outlook.comparables.length === 0) return null;

  const bandCounts = outlook.comparables.reduce<Record<string, number>>((acc, c) => {
    acc[c.band] = (acc[c.band] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(bandCounts)
    .map(([b, n]) => `${n} scored ${b}`)
    .join(", ");

  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: "#e2d9c8", background: "#fdfaf3" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold" style={{ color: "#7c5e10" }}>
          Similar-Promo Outcomes <span className="font-normal text-xs">(Experimental)</span>
        </h3>
        {outlook.mode === "prediction" && outlook.agreement && (
          <span className="text-xs font-medium" style={{ color: "#7c5e10" }}>
            {outlook.agreement.count} of {outlook.agreement.k} comparables scored {outlook.predictedBand}
            {outlook.looAccuracy != null && (
              <span className="text-gray-400 font-normal"> · validated hit rate {Math.round(outlook.looAccuracy * 100)}% vs {Math.round((outlook.baseRate ?? 0) * 100)}% base</span>
            )}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-1">
        The {outlook.comparables.length} most comparable promos with known real results: {summary}.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {outlook.comparables.map((c) => (
          <li key={c.reviewId} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block rounded-full px-1.5 py-0.5 font-semibold shrink-0"
              style={{ background: BAND_STYLE[c.band].bg, color: BAND_STYLE[c.band].fg }}
            >
              {c.performanceScore}/10
            </span>
            <a href={`/?review=${c.reviewId}`} className="underline truncate" style={{ color: NAVY }}>
              {c.name}
            </a>
            <span className="text-gray-400 truncate">
              {[c.guru, c.publisher].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-400 mt-2">{outlook.disclaimer}</p>
    </div>
  );
}
