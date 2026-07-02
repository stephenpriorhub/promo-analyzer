"use client";

/**
 * Performance tab — real-world promo results by creative code.
 *
 * Import (CSV export or Google Sheet sync) → enrich rows with the Agora
 * publication / guru context → link to analyzed promos → Teach the Brain.
 * Tiers are relative, recomputed on every load, and always shown WITH their
 * comparison cohort (metric + pool) so a tier is a statistic, not a grade.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  pool: { scope: "publication" | "global"; publication: string | null; n: number };
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
  match: { reviewId: string; reviewName: string; hasTraining: boolean } | null;
}

interface ApiData {
  views: View[];
  unmatchedReviews: Array<{ id: string; name: string; promoCode: string | null }>;
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

function cohortLine(d: TierDerivation): string {
  if (d.metric === "manual") return "manual tier set by publisher";
  const rank =
    d.percentile >= 0.5
      ? `top ${Math.max(Math.round((1 - d.percentile) * 100), 1)}%`
      : `bottom ${Math.max(Math.round(d.percentile * 100), 1)}%`;
  const where = d.pool.scope === "publication" ? `${d.pool.publication} promos` : "promos, all pubs";
  return `${rank} by ${d.metric} · n=${d.pool.n} ${where} · ${d.scheme}`;
}

export default function PerformanceTab() {
  const [data, setData] = useState<ApiData | null>(null);
  const [options, setOptions] = useState<{ gurus: string[]; products: string[] }>({ gurus: [], products: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/performance");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
      try {
        const o = await (await fetch("/api/promo-meta-options")).json();
        setOptions({ gurus: o.gurus ?? [], products: o.products ?? [] });
      } catch {
        /* options are a nice-to-have — datalists just stay empty */
      }
    })();
  }, [load]);

  const say = (msg: string) => { setFlash(msg); setError(null); setTimeout(() => setFlash(null), 6000); };
  const fail = (msg: string) => { setError(msg); setFlash(null); };

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

  const patch = useCallback(async (promoCode: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/performance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promoCode, ...body }),
    });
    if (!res.ok) fail((await res.json().catch(() => ({})) as { error?: string }).error ?? "Update failed");
    await load();
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
        (json.skippedNoMatch ? ` · ${json.skippedNoMatch} skipped (no matched review)` : "") +
        (json.skippedNoTier ? ` · ${json.skippedNoTier} skipped (insufficient comparables)` : "") +
        (json.brainLedger?.ok ? " · vault ledger updated" : " · vault ledger NOT updated");
      if (failed.length || !json.brainLedger?.ok) fail(msg); else say(msg);
      await load();
    } finally { setBusy(null); }
  }, [load]);

  if (!data) {
    return <div className="max-w-5xl mx-auto mt-12 text-center text-sm text-gray-400">Loading performance data…</div>;
  }

  const readyCount = data.views.filter((v) => v.match && v.derivation && !v.record.learnedAt).length;
  const matchedCount = data.views.filter((v) => v.match).length;
  const learnedCount = data.views.filter((v) => v.record.learnedAt).length;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Real-World Performance</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {data.views.length} creative codes · {matchedCount} matched to analyzed promos · {learnedCount} taught to the brain
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
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="text-xs px-3 py-1.5 rounded border font-medium disabled:opacity-50"
            style={{ borderColor: NAVY, color: NAVY }}
          >
            {busy === "import" ? "Importing…" : "Import CSV"}
          </button>
          <button
            onClick={() => void syncSheet()}
            disabled={busy !== null || !data.sheetConfigured}
            title={data.sheetConfigured ? "Pull all rows from the configured Google Sheet" : "Set GOOGLE_SERVICE_ACCOUNT_JSON + PERFORMANCE_SHEET_ID to enable"}
            className="text-xs px-3 py-1.5 rounded border font-medium disabled:opacity-50"
            style={{ borderColor: NAVY, color: NAVY }}
          >
            {busy === "sync" ? "Syncing…" : "Sync Google Sheet"}
          </button>
          <button
            onClick={() => void teach()}
            disabled={busy !== null || readyCount === 0}
            className="text-xs px-3 py-1.5 rounded font-semibold text-white disabled:opacity-50"
            style={{ background: NAVY }}
          >
            {busy === "teach-all" ? "Teaching…" : `Teach the Brain (${readyCount} ready)`}
          </button>
        </div>
      </div>

      {flash && <div className="mb-3 text-sm rounded border border-green-200 bg-green-50 text-green-800 px-3 py-2">{flash}</div>}
      {error && <div className="mb-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2">{error}</div>}

      {data.views.length === 0 ? (
        <div className="mt-16 text-center text-sm text-gray-400 max-w-md mx-auto">
          <p className="font-medium text-gray-500 mb-2">No performance data yet.</p>
          <p>Import a CSV export of your promo performance sheet (needs a “Creative Code” or “Promo Code” column), or configure the Google Sheet sync. Then attach the Agora publication to each code and link it to its analyzed promo — every matched pair teaches the brain what actually works.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "#dde4f0" }}>
          <table className="w-full text-sm bg-white">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ background: "#f0f4fc", color: NAVY }}>
                <th className="px-3 py-2 font-semibold">Creative Code</th>
                <th className="px-3 py-2 font-semibold">Publication</th>
                <th className="px-3 py-2 font-semibold">Guru</th>
                <th className="px-3 py-2 font-semibold">Result</th>
                <th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold">Analyzed Promo</th>
                <th className="px-3 py-2 font-semibold">Brain</th>
              </tr>
            </thead>
            <tbody>
              {data.views.map(({ record, derivation, match }) => (
                <tr key={record.promoCode} className="border-t align-top" style={{ borderColor: "#eef1f8" }}>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" title={Object.entries(record.stats).map(([k, v]) => `${k}: ${v}`).join("\n")}>
                    {record.promoCode}
                  </td>
                  <td className="px-3 py-2 min-w-[11rem]">
                    <input
                      list="perf-pub-options"
                      defaultValue={record.publication ?? ""}
                      placeholder="Attach publication…"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (record.publication ?? "")) void patch(record.promoCode, { publication: v || null }); }}
                      className="w-full text-xs rounded border border-gray-200 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[9rem]">
                    <input
                      list="perf-guru-options"
                      defaultValue={record.guru ?? ""}
                      placeholder="Guru…"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (record.guru ?? "")) void patch(record.promoCode, { guru: v || null }); }}
                      className="w-full text-xs rounded border border-gray-200 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {derivation && derivation.metric !== "manual" ? (
                      <span>{derivation.metric}: <b>{record.stats[derivation.metric]}</b></span>
                    ) : (
                      <span className="text-gray-400">{Object.keys(record.stats).length} stat cols</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {derivation ? (
                      <div>
                        <span
                          className="inline-block text-xs font-semibold rounded-full px-2 py-0.5"
                          style={{ background: TIER_STYLE[derivation.tier].bg, color: TIER_STYLE[derivation.tier].fg }}
                        >
                          {TIER_STYLE[derivation.tier].label}
                        </span>
                        <div className="text-[10px] text-gray-400 mt-0.5">{cohortLine(derivation)}</div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-gray-400" title="Needs at least 8 records sharing the same metric (same publication for revenue metrics) before a tier claim is honest.">
                        insufficient comparables
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 min-w-[12rem]">
                    {match ? (
                      <span className="inline-flex items-center gap-1">
                        <a href={`/?review=${match.reviewId}`} className="text-xs underline" style={{ color: NAVY }}>
                          {match.reviewName}
                        </a>
                        <button
                          onClick={() => void patch(record.promoCode, { unlinkReviewId: match.reviewId })}
                          className="text-gray-300 hover:text-red-500 text-xs leading-none"
                          title="Unlink this promo from the creative code"
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) void patch(record.promoCode, { linkReviewId: e.target.value }); }}
                        className="w-full text-xs rounded border border-gray-200 px-1.5 py-1 text-gray-500"
                      >
                        <option value="">Link analyzed promo…</option>
                        {data.unmatchedReviews.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {record.learnedAt ? (
                      <button
                        onClick={() => void teach(record.promoCode)}
                        disabled={busy !== null}
                        className="text-xs text-green-700 underline decoration-dotted disabled:opacity-50"
                        title={`Taught ${record.learnedAt.slice(0, 10)} — click to re-teach with current stats`}
                      >
                        {busy === record.promoCode ? "…" : "✓ taught"}
                      </button>
                    ) : match && derivation ? (
                      <button
                        onClick={() => void teach(record.promoCode)}
                        disabled={busy !== null}
                        className="text-xs px-2 py-1 rounded text-white disabled:opacity-50"
                        style={{ background: NAVY }}
                      >
                        {busy === record.promoCode ? "…" : "Teach"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="perf-pub-options">
        {options.products.map((p) => <option key={p} value={p} />)}
      </datalist>
      <datalist id="perf-guru-options">
        {options.gurus.map((g) => <option key={g} value={g} />)}
      </datalist>

      <p className="text-[11px] text-gray-400 mt-3">
        Tiers are relative and recomputed as data arrives (as of {data.asOf.slice(0, 10)}). Revenue metrics rank only within a publication; rate metrics (conversion, EPC) may rank globally. Teaching the brain merges the real result into the promo&apos;s training data, extracts copy lessons, and appends to the vault&apos;s Performance Ledger.
      </p>
    </div>
  );
}
