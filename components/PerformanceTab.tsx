"use client";

/**
 * Performance tab — EVERY analyzed promo, with the two scores side by side:
 * Copy Quality (craft) and Predicted (k-NN from comparable promos' real
 * results — a promo's own result never informs its own prediction). Promos
 * with a matched creative code additionally show their real-world results, so
 * predicted-vs-actual is always visible as a running accuracy check on the
 * system. The full industry dataset stays loaded as baseline context and
 * powers tier ranking, but isn't listed row-by-row.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyStatColumn, formatStatValue, normalizedStatNumber, toNumber } from "@/lib/stat-format";
import type { PerformanceTier } from "@/lib/learning-kb";

const NAVY = "#012479";

interface PromoRow {
  reviewId: string;
  name: string;
  promoCode: string | null;
  publisher: string | null;
  product: string | null;
  promoType: string | null;
  promoStatus: string | null;
  copyScore: number | null;
  predicted: { score: number; confidence: string } | null;
  real: {
    tier: PerformanceTier;
    performanceScore: number;
    bucket: "acquisition" | "monetization";
    stats: Record<string, string>;
    learnedAt: string | null;
  } | null;
}

interface Baseline {
  n: number;
  median: number;
  top10: number;
  top1: number;
}

interface ApiData {
  promos: PromoRow[];
  baseline: Baseline | null;
  sheetConfigured: boolean;
  asOf: string;
  views: unknown[];
}

const TIER_STYLE: Record<PerformanceTier, { bg: string; fg: string; label: string }> = {
  gold_standard: { bg: "#fef3c7", fg: "#92400e", label: "Top Performer" },
  strong: { bg: "#dcfce7", fg: "#166534", label: "Strong" },
  average: { bg: "#f1f5f9", fg: "#475569", label: "Average" },
  weak: { bg: "#ffedd5", fg: "#9a3412", label: "Weak" },
  failed: { bg: "#fee2e2", fg: "#991b1b", label: "Failed" },
};
const TIER_RANK: Record<PerformanceTier, number> = { gold_standard: 5, strong: 4, average: 3, weak: 2, failed: 1 };

/** Find a stat column client-side (cost columns excluded). */
function statCol(stats: Record<string, string>, pattern: RegExp): string | null {
  return (
    Object.keys(stats).find(
      (h) => pattern.test(h) && !/cost|refund|cancel|chargeback|unsub|cpa|spend/i.test(h)
    ) ?? null
  );
}
function statOf(row: PromoRow, pattern: RegExp): string | null {
  if (!row.real) return null;
  const col = statCol(row.real.stats, pattern);
  return col ? row.real.stats[col] : null;
}
function statNum(row: PromoRow, pattern: RegExp): number | null {
  const raw = statOf(row, pattern);
  if (raw == null) return null;
  const col = statCol(row.real!.stats, pattern)!;
  return normalizedStatNumber(raw, classifyStatColumn(col)) ?? toNumber(raw);
}

const ORDERS_RE = /gross\s*orders|orders?\b/i;
const REVENUE_RE = /gross\s*revenue|total\s*revenue/i;
const CONV_RE = /^conversion\s*rate$/i;

type SortKey =
  | "promo" | "code" | "publisher" | "type" | "status"
  | "copy" | "predicted" | "realScore" | "tier" | "orders" | "revenue" | "conv";

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
      // Auto-learn: teach the brain from newly-matched promos with results that
      // haven't been taught. Bounded — taught promos are skipped.
      if (synced) {
        try {
          const cur = (await (await fetch("/api/performance")).json()) as ApiData;
          const ready = (cur.promos ?? []).filter((p) => p.real && !p.real.learnedAt).length;
          if (ready > 0) await teach();
        } catch {
          /* auto-learn is best-effort */
        }
      }
    })();
  }, [load, teach]);

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

  if (!data) {
    return <div className="max-w-5xl mx-auto mt-12 text-center text-sm text-gray-400">Loading performance data…</div>;
  }

  const rows = data.promos ?? [];
  const withReal = rows.filter((r) => r.real);
  const readyCount = withReal.filter((r) => !r.real!.learnedAt).length;

  const effectiveSortKey: SortKey = sortKey ?? "conv";

  const sortVal = (r: PromoRow, key: SortKey): number | string | null => {
    switch (key) {
      case "promo": return r.name.toLowerCase();
      case "code": return r.promoCode?.toLowerCase() ?? null;
      case "publisher": return r.publisher?.toLowerCase() ?? null;
      case "type": return r.promoType?.toLowerCase() ?? null;
      case "status": return r.promoStatus?.toLowerCase() ?? null;
      case "copy": return r.copyScore;
      case "predicted": return r.predicted?.score ?? null;
      case "realScore": return r.real?.performanceScore ?? null;
      case "tier": return r.real ? TIER_RANK[r.real.tier] : null;
      case "orders": return statNum(r, ORDERS_RE);
      case "revenue": return statNum(r, REVENUE_RE);
      case "conv": return statNum(r, CONV_RE);
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const va = sortVal(a, effectiveSortKey);
    const vb = sortVal(b, effectiveSortKey);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls last
    if (vb == null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const clickSort = (key: SortKey) => {
    if (effectiveSortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(["promo", "code", "publisher", "type", "status"].includes(key) ? "asc" : "desc");
    }
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
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Promo Performance</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {rows.length} analyzed promos · {withReal.length} with real-world results · predicted vs actual tracks how well the system is learning
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
          <p className="font-medium text-gray-500 mb-2">No analyzed promos yet.</p>
          <p>Analyze a promo and it appears here with its Copy Quality and Predicted scores. Set its Creative Code to connect real-world results.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "#dde4f0" }}>
          <table className="text-sm bg-white whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ background: "#f0f4fc", color: NAVY }}>
                {th("promo", "Promo")}
                {th("code", "Code")}
                {th("publisher", "Publisher")}
                {th("type", "Type")}
                {th("status", "Status")}
                {th("copy", "Copy Quality", "text-right")}
                {th("predicted", "Predicted", "text-right")}
                {th("realScore", "Real Score", "text-right")}
                {th("tier", "Tier")}
                {th("orders", "Orders", "text-right")}
                {th("revenue", "Revenue", "text-right")}
                {th("conv", "Conv. Rate", "text-right")}
                <th className="px-3 py-2 font-semibold">Brain</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const orders = statOf(r, ORDERS_RE);
                const revenue = statOf(r, REVENUE_RE);
                const conv = statOf(r, CONV_RE);
                const dash = <span className="text-gray-300">—</span>;
                return (
                  <tr key={r.reviewId} className="border-t" style={{ borderColor: "#eef1f8" }}>
                    <td className="px-3 py-2 min-w-[11rem] max-w-[16rem]">
                      <a href={`/?review=${r.reviewId}`} className="underline block truncate" style={{ color: NAVY }} title={r.name}>{r.name}</a>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.promoCode ?? dash}</td>
                    <td className="px-3 py-2 text-xs">{r.publisher ?? dash}</td>
                    <td className="px-3 py-2 text-xs">{r.promoType ?? dash}</td>
                    <td className="px-3 py-2 text-xs">{r.promoStatus ?? dash}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.copyScore != null ? r.copyScore.toFixed(1) : dash}</td>
                    <td className="px-3 py-2 text-right" title={r.predicted ? `${r.predicted.confidence} confidence — own results excluded` : "Needs a full sub-score profile + enough comparables"}>
                      {r.predicted ? <span className="font-medium" style={{ color: "#7c5e10" }}>{r.predicted.score.toFixed(1)}</span> : dash}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.real ? <span className="font-semibold" style={{ color: NAVY }}>{r.real.performanceScore.toFixed(1)}</span> : dash}
                    </td>
                    <td className="px-3 py-2">
                      {r.real ? (
                        <span className="inline-block text-xs font-semibold rounded-full px-2 py-0.5"
                          style={{ background: TIER_STYLE[r.real.tier].bg, color: TIER_STYLE[r.real.tier].fg }}>
                          {TIER_STYLE[r.real.tier].label}
                        </span>
                      ) : dash}
                    </td>
                    <td className="px-3 py-2 text-right">{orders ? formatStatValue(orders, "number") : dash}</td>
                    <td className="px-3 py-2 text-right">{revenue ? formatStatValue(revenue, "currency") : dash}</td>
                    <td className="px-3 py-2 text-right">{conv ? formatStatValue(conv, "percent") : dash}</td>
                    <td className="px-3 py-2">
                      {r.real?.learnedAt ? (
                        <button onClick={() => void teach(r.promoCode!)} disabled={busy !== null}
                          className="text-xs text-green-700 underline decoration-dotted disabled:opacity-50"
                          title={`Taught ${r.real.learnedAt.slice(0, 10)} — click to re-teach with current stats`}>
                          {busy === r.promoCode ? "…" : "✓ taught"}
                        </button>
                      ) : r.real ? (
                        <button onClick={() => void teach(r.promoCode!)} disabled={busy !== null}
                          className="text-xs px-2 py-1 rounded text-white disabled:opacity-50" style={{ background: NAVY }}>
                          {busy === r.promoCode ? "…" : "Teach"}
                        </button>
                      ) : <span className="text-[11px] text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Sortable — click any column header (default: conversion rate; promos without results sort last). Copy Quality grades the craft; Predicted estimates real-world performance from comparable promos&apos; actual results — a promo&apos;s own result never feeds its own prediction, so predicted-vs-Real Score is an honest accuracy check. Tiers rank front-ends by order volume and backends/mega-bundles by revenue against the full industry dataset; volume and revenue scale with list size, so read tiers as reach-and-results, not copy merit alone (as of {data.asOf.slice(0, 10)}).
      </p>
    </div>
  );
}
