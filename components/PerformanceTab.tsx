"use client";

/**
 * Performance tab — analyzed promos that have real-world results.
 *
 * The main table lists ONLY promos you've analyzed whose creative code matches
 * a row in the performance data, with their complete stats, sortable, default
 * sorted by conversion rate. The full industry dataset stays loaded as baseline
 * context (what conversion rates are achievable) and powers tier ranking, but
 * isn't listed row-by-row — it's context, not the subject.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyStatColumn, formatStatValue, normalizedStatNumber, toNumber } from "@/lib/stat-format";
import type { PerformanceTier } from "@/lib/learning-kb";

const NAVY = "#012479";

interface TierDerivation {
  metric: string;
  metricKind: "rate" | "absolute";
  value: number;
  percentile: number;
  performanceScore: number;
  tier: PerformanceTier;
  tierSource: "derived" | "manual";
  scheme: "5-tier" | "3-tier";
  bucket: "acquisition" | "monetization";
  pool: { bucket: "acquisition" | "monetization"; n: number };
}

interface PerfRecord {
  promoCode: string;
  stats: Record<string, string>;
  publication: string | null;
  guru: string | null;
  promoType: string | null;
  notes: string;
  tierOverride: PerformanceTier | null;
  learnedAt: string | null;
  source: "csv" | "sheet";
}

interface View {
  record: PerfRecord;
  derivation: TierDerivation | null;
  match: { reviewId: string; reviewName: string; hasTraining: boolean; copyScore: number | null; promoType: string | null } | null;
}

interface Baseline {
  n: number;
  median: number;
  top10: number;
  top1: number;
}

interface ApiData {
  views: View[];
  unmatchedReviews: Array<{ id: string; name: string; promoCode: string | null }>;
  baseline: Baseline | null;
  sheetConfigured: boolean;
  asOf: string;
}

const TIER_STYLE: Record<PerformanceTier, { bg: string; fg: string; label: string }> = {
  gold_standard: { bg: "#fef3c7", fg: "#92400e", label: "Top Performer" },
  strong: { bg: "#dcfce7", fg: "#166534", label: "Strong" },
  average: { bg: "#f1f5f9", fg: "#475569", label: "Average" },
  weak: { bg: "#ffedd5", fg: "#9a3412", label: "Weak" },
  failed: { bg: "#fee2e2", fg: "#991b1b", label: "Failed" },
};
const TIER_RANK: Record<PerformanceTier, number> = { gold_standard: 5, strong: 4, average: 3, weak: 2, failed: 1 };

// Fixed leading columns, then dynamic stat columns discovered from the data.
type SortKey = string; // "promo" | "code" | "publication" | "guru" | "copy" | "tier" | `stat:${string}`

export default function PerformanceTab() {
  const [data, setData] = useState<ApiData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/performance");
    if (res.ok) setData(await res.json());
  }, []);

  const say = (msg: string) => { setFlash(msg); setError(null); setTimeout(() => setFlash(null), 6000); };
  const fail = (msg: string) => { setError(msg); setFlash(null); };

  useEffect(() => {
    void (async () => {
      await load();
      let synced = false;
      try {
        const first = await (await fetch("/api/performance")).json();
        if (first?.sheetConfigured) {
          const res = await fetch("/api/performance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sync: true }),
          });
          if (res.ok) {
            const j = await res.json();
            say(`Auto-synced ${j.imported} rows from the Google Sheet (${j.added} new, ${j.updated} refreshed)`);
            await load();
            synced = true;
          }
        }
      } catch {
        /* auto-sync is best-effort — the manual button remains */
      }
      // Auto-learn: teach the brain from newly-matched promos that have real
      // results and haven't been taught. Bounded — taught promos are skipped,
      // so this is a no-op once everything is learned.
      if (synced) {
        try {
          const cur = await (await fetch("/api/performance")).json();
          const ready = (cur.views ?? []).filter(
            (v: View) => v.match && v.derivation && !v.record.learnedAt
          ).length;
          if (ready > 0) await teach();
        } catch {
          /* auto-learn is best-effort — the manual button remains */
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const importCsv = useCallback(async (file: File) => {
    setBusy("import");
    try {
      const csv = await file.text();
      const res = await fetch("/api/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const json = await res.json();
      if (!res.ok) fail(json.error ?? "Import failed");
      else { say(`Imported ${json.imported} rows (${json.added} new, ${json.updated} refreshed)`); await load(); }
    } finally { setBusy(null); }
  }, [load]);

  const syncSheet = useCallback(async () => {
    setBusy("sync");
    try {
      const res = await fetch("/api/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync: true }),
      });
      const json = await res.json();
      if (!res.ok) fail(json.error ?? "Sync failed");
      else { say(`Synced ${json.imported} rows from the sheet (${json.added} new, ${json.updated} refreshed)`); await load(); }
    } finally { setBusy(null); }
  }, [load]);

  const teach = useCallback(async (promoCode?: string) => {
    setBusy(promoCode ?? "teach-all");
    try {
      const res = await fetch("/api/performance/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promoCode ? { promoCode } : {}),
      });
      const json = await res.json();
      if (!res.ok) { fail(json.error ?? "Learning failed"); return; }
      const learned = json.learned as Array<{ promoCode: string; lessonsAdded: number; error?: string }>;
      const succeeded = learned.filter((l) => !l.error);
      const failed = learned.filter((l) => l.error);
      const lessons = succeeded.reduce((a, l) => a + l.lessonsAdded, 0);
      const msg =
        `Brain taught: ${succeeded.length} promo(s), ${lessons} lesson(s) extracted` +
        (failed.length ? ` · ${failed.length} FAILED (still marked ready): ${failed.map((f) => f.promoCode).join(", ")}` : "") +
        (json.brainLedger?.ok ? " · vault ledger updated" : " · vault ledger NOT updated");
      if (failed.length || !json.brainLedger?.ok) fail(msg); else say(msg);
      await load();
    } finally { setBusy(null); }
  }, [load]);

  if (!data) {
    return <div className="max-w-5xl mx-auto mt-12 text-center text-sm text-gray-400">Loading performance data…</div>;
  }

  // Only analyzed promos that have real-world results
  const rows = data.views.filter((v) => v.match && Object.keys(v.record.stats).length > 0);
  const readyCount = rows.filter((v) => v.derivation && !v.record.learnedAt).length;
  const learnedCount = rows.filter((v) => v.record.learnedAt).length;

  // Discover the stat columns present across matched rows, in first-seen order
  const statCols: string[] = [];
  for (const v of rows) for (const k of Object.keys(v.record.stats)) if (!statCols.includes(k)) statCols.push(k);
  const conversionCol =
    statCols.find((c) => c.toLowerCase() === "conversion rate") ??
    statCols.find((c) => classifyStatColumn(c) === "percent" && c.toLowerCase().includes("conversion")) ??
    statCols.find((c) => classifyStatColumn(c) === "percent") ??
    null;

  const effectiveSortKey: SortKey | null = sortKey ?? (conversionCol ? `stat:${conversionCol}` : "copy");

  // Sortable value for a row under the active key
  const sortVal = (v: View, key: SortKey): number | string | null => {
    if (key === "promo") return v.match!.reviewName.toLowerCase();
    if (key === "code") return v.record.promoCode.toLowerCase();
    if (key === "publication") return (v.record.publication ?? "").toLowerCase();
    if (key === "guru") return (v.record.guru ?? "").toLowerCase();
    if (key === "type") return (v.match!.promoType ?? "").toLowerCase();
    if (key === "copy") return v.match!.copyScore;
    if (key === "tier") return v.derivation ? TIER_RANK[v.derivation.tier] : null;
    if (key.startsWith("stat:")) {
      const col = key.slice(5);
      const raw = v.record.stats[col];
      if (raw == null) return null;
      const t = classifyStatColumn(col);
      return t === "text" ? raw.toLowerCase() : normalizedStatNumber(raw, t) ?? toNumber(raw);
    }
    return null;
  };

  const sorted = [...rows].sort((a, b) => {
    const va = sortVal(a, effectiveSortKey);
    const vb = sortVal(b, effectiveSortKey);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;      // nulls always last
    if (vb == null) return -1;
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const clickSort = (key: SortKey) => {
    if (effectiveSortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "promo" || key === "code" || key === "publication" || key === "guru" ? "asc" : "desc"); }
  };
  const arrow = (key: SortKey) => (effectiveSortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const th = (key: SortKey, label: string, extra = "") => (
    <th
      className={`px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:underline ${extra}`}
      onClick={() => clickSort(key)}
      title="Click to sort"
    >
      {label}{arrow(key)}
    </th>
  );

  return (
    <div className="max-w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Analyzed Promos — Real-World Results</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {rows.length} analyzed promo{rows.length === 1 ? "" : "s"} with results · {learnedCount} taught to the brain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={busy !== null}
            className="text-xs px-3 py-1.5 rounded border font-medium disabled:opacity-50" style={{ borderColor: NAVY, color: NAVY }}>
            {busy === "import" ? "Importing…" : "Import CSV"}
          </button>
          <button onClick={() => void syncSheet()} disabled={busy !== null || !data.sheetConfigured}
            title={data.sheetConfigured ? "Pull all rows from the configured Google Sheet" : "Set GOOGLE_SERVICE_ACCOUNT_JSON + PERFORMANCE_SHEET_ID to enable"}
            className="text-xs px-3 py-1.5 rounded border font-medium disabled:opacity-50" style={{ borderColor: NAVY, color: NAVY }}>
            {busy === "sync" ? "Syncing…" : "Sync Google Sheet"}
          </button>
          <button onClick={() => void teach()} disabled={busy !== null || readyCount === 0}
            className="text-xs px-3 py-1.5 rounded font-semibold text-white disabled:opacity-50" style={{ background: NAVY }}>
            {busy === "teach-all" ? "Teaching…" : `Teach the Brain (${readyCount} ready)`}
          </button>
        </div>
      </div>

      {/* Industry baseline context */}
      {data.baseline && (
        <div className="mb-3 text-xs rounded-lg border px-3 py-2 flex flex-wrap gap-x-6 gap-y-1" style={{ borderColor: "#dde4f0", background: "#f8fafc" }}>
          <span className="font-semibold" style={{ color: NAVY }}>Industry baseline (conversion rate)</span>
          <span className="text-gray-600">median <b>{data.baseline.median}%</b></span>
          <span className="text-gray-600">top 10% <b>≥ {data.baseline.top10}%</b></span>
          <span className="text-gray-600">top 1% <b>≥ {data.baseline.top1}%</b></span>
          <span className="text-gray-400">across {data.baseline.n.toLocaleString()} industry promos (context only)</span>
        </div>
      )}

      {flash && <div className="mb-3 text-sm rounded border border-green-200 bg-green-50 text-green-800 px-3 py-2">{flash}</div>}
      {error && <div className="mb-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2">{error}</div>}

      {rows.length === 0 ? (
        <div className="mt-12 text-center text-sm text-gray-400 max-w-lg mx-auto">
          <p className="font-medium text-gray-500 mb-2">No analyzed promos have real-world results yet.</p>
          <p>Open any analyzed promo, set its <b>Creative Code</b> in Promo Details to match a code in your performance sheet, and it appears here with its full stats. The {data.baseline?.n.toLocaleString() ?? "industry"} sheet rows are loaded as baseline context.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "#dde4f0" }}>
          <table className="text-sm bg-white whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ background: "#f0f4fc", color: NAVY }}>
                {th("promo", "Promo")}
                {th("code", "Creative Code")}
                {th("publication", "Publication")}
                {th("guru", "Guru")}
                {th("type", "Type")}
                {th("copy", "Copy Score")}
                {th("tier", "Tier")}
                {statCols.map((c) => th(`stat:${c}`, c, "text-right"))}
                <th className="px-3 py-2 font-semibold">Brain</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ record, derivation, match }) => (
                <tr key={record.promoCode} className="border-t" style={{ borderColor: "#eef1f8" }}>
                  <td className="px-3 py-2 min-w-[12rem]">
                    <a href={`/?review=${match!.reviewId}`} className="underline" style={{ color: NAVY }}>{match!.reviewName}</a>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{record.promoCode}</td>
                  <td className="px-3 py-2">{record.publication ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">{record.guru ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-xs">{match!.promoType ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-right">{match!.copyScore != null ? match!.copyScore.toFixed(1) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">
                    {derivation ? (
                      <span className="inline-block text-xs font-semibold rounded-full px-2 py-0.5"
                        style={{ background: TIER_STYLE[derivation.tier].bg, color: TIER_STYLE[derivation.tier].fg }}
                        title={cohortLine(derivation)}>
                        {TIER_STYLE[derivation.tier].label}
                      </span>
                    ) : <span className="text-[11px] text-gray-400" title="Needs ≥8 same-metric peers before a tier claim is honest.">—</span>}
                  </td>
                  {statCols.map((c) => {
                    const raw = record.stats[c];
                    const isConv = c === conversionCol;
                    return (
                      <td key={c} className={`px-3 py-2 text-right ${isConv ? "font-semibold" : ""}`} style={isConv ? { color: NAVY } : undefined}>
                        {raw != null ? formatStatValue(raw, classifyStatColumn(c)) : <span className="text-gray-300">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    {record.learnedAt ? (
                      <button onClick={() => void teach(record.promoCode)} disabled={busy !== null}
                        className="text-xs text-green-700 underline decoration-dotted disabled:opacity-50"
                        title={`Taught ${record.learnedAt.slice(0, 10)} — click to re-teach with current stats`}>
                        {busy === record.promoCode ? "…" : "✓ taught"}
                      </button>
                    ) : derivation ? (
                      <button onClick={() => void teach(record.promoCode)} disabled={busy !== null}
                        className="text-xs px-2 py-1 rounded text-white disabled:opacity-50" style={{ background: NAVY }}>
                        {busy === record.promoCode ? "…" : "Teach"}
                      </button>
                    ) : <span className="text-[11px] text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Sortable — click any column header (default: conversion rate, high to low). Tiers rank front-ends by total order volume and backends/mega-bundles by total revenue, each against its own kind across the full dataset (recomputed as data arrives, as of {data.asOf.slice(0, 10)}). Volume and revenue scale with list size, so larger lists rank higher regardless of copy — read tiers as reach-and-results, not copy merit alone. Teaching the brain merges the real result into the promo&apos;s training data, extracts copy lessons, and appends to the vault&apos;s Performance Ledger.
      </p>
    </div>
  );
}

function cohortLine(d: TierDerivation): string {
  if (d.metric === "manual") return "manual tier set by publisher";
  const rank = d.percentile >= 0.5
    ? `top ${Math.max(Math.round((1 - d.percentile) * 100), 1)}%`
    : `bottom ${Math.max(Math.round(d.percentile * 100), 1)}%`;
  const kind = d.bucket === "acquisition" ? "order volume" : "revenue";
  const cohort = d.bucket === "acquisition" ? "front-end promos" : "backend/mega promos";
  return `${rank} by ${kind} · n=${d.pool.n} ${cohort} · ${d.scheme}`;
}
