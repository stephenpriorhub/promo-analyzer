"use client";

import { useEffect, useState, useCallback } from "react";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface Props {
  reviewId: string | null;
  initialPromoCode?: string | null;
  initialPublisher?: string | null;
  initialGurus?: string[];
  initialProduct?: string | null;
  onUpdated?: () => void;
}

interface Options {
  publishers: string[];
  gurus: string[];
  products: string[];
}

interface PromoStats {
  promoCode: string;
  stats: Record<string, string>;
}

async function patchReview(id: string, body: Record<string, unknown>) {
  await fetch("/api/reviews", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...body }),
  });
}

/** Free-text combobox: native input + datalist (lets the user pick a known value or type a new one). */
function Combo({
  label,
  value,
  placeholder,
  listId,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  listId: string;
  options: string[];
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600">{label}</label>
      <input
        list={listId}
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => local.trim() !== value.trim() && onCommit(local.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full text-sm rounded-md border border-gray-300 px-2.5 py-1.5 focus:outline-none focus:ring-2"
        style={{ ["--tw-ring-color" as string]: NAVY_BORDER }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}

export default function PromoMetadata({
  reviewId,
  initialPromoCode,
  initialPublisher,
  initialGurus,
  initialProduct,
  onUpdated,
}: Props) {
  const [promoCode, setPromoCode] = useState(initialPromoCode ?? "");
  const [publisher, setPublisher] = useState(initialPublisher ?? "");
  const [gurus, setGurus] = useState<string[]>(initialGurus ?? []);
  const [product, setProduct] = useState(initialProduct ?? "");
  const [guruDraft, setGuruDraft] = useState("");
  const [options, setOptions] = useState<Options>({ publishers: [], gurus: [], products: [] });
  const [stats, setStats] = useState<PromoStats | null>(null);
  const [statsConfigured, setStatsConfigured] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Reset when switching reviews
  useEffect(() => {
    setPromoCode(initialPromoCode ?? "");
    setPublisher(initialPublisher ?? "");
    setGurus(initialGurus ?? []);
    setProduct(initialProduct ?? "");
    setGuruDraft("");
  }, [reviewId, initialPromoCode, initialPublisher, initialProduct]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/promo-meta-options")
      .then((r) => r.json())
      .then((o: Options) => setOptions(o))
      .catch(() => {});
  }, []);

  const flash = useCallback(() => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
    onUpdated?.();
  }, [onUpdated]);

  // Fetch real performance stats whenever the promo code resolves
  const loadStats = useCallback((code: string) => {
    if (!code.trim()) {
      setStats(null);
      return;
    }
    fetch(`/api/promo-stats?code=${encodeURIComponent(code.trim())}`)
      .then((r) => r.json())
      .then((d: { configured: boolean; stats: PromoStats | null }) => {
        setStatsConfigured(d.configured);
        setStats(d.stats);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStats(initialPromoCode ?? "");
  }, [reviewId, initialPromoCode, loadStats]);

  if (!reviewId) return null;

  const save = async (body: Record<string, unknown>) => {
    await patchReview(reviewId, body);
    flash();
  };

  const commitCode = (v: string) => {
    setPromoCode(v);
    save({ promoCode: v || null });
    loadStats(v);
  };
  const addGuru = (g: string) => {
    const v = g.trim();
    if (!v || gurus.includes(v)) return;
    const next = [...gurus, v];
    setGurus(next);
    setGuruDraft("");
    save({ gurus: next });
  };
  const removeGuru = (g: string) => {
    const next = gurus.filter((x) => x !== g);
    setGurus(next);
    save({ gurus: next });
  };

  return (
    <div className="rounded-lg border p-4 space-y-4" style={{ background: NAVY_BG, borderColor: NAVY_BORDER }}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>
          Promo Details
        </h3>
        {savedFlash && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Creative / promo code */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Creative Code</label>
          <input
            value={promoCode}
            placeholder="e.g. WAR1024"
            onChange={(e) => setPromoCode(e.target.value)}
            onBlur={() => commitCode(promoCode.trim())}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-full text-sm rounded-md border border-gray-300 px-2.5 py-1.5 focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: NAVY_BORDER }}
          />
        </div>

        {/* Publisher */}
        <Combo
          label="Publisher"
          value={publisher}
          placeholder="Select or type…"
          listId="publisher-options"
          options={options.publishers}
          onCommit={(v) => { setPublisher(v); save({ publisher: v || null }); }}
        />

        {/* Product */}
        <Combo
          label="Product"
          value={product}
          placeholder="Select or type…"
          listId="product-options"
          options={options.products}
          onCommit={(v) => { setProduct(v); save({ product: v || null }); }}
        />

        {/* Guru(s) — multi, chips inline inside the field (matches the other inputs) */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Guru(s)</label>
          <div
            className="w-full text-sm rounded-md border border-gray-300 px-2 py-1 flex flex-wrap items-center gap-1.5 focus-within:ring-2 bg-white"
            style={{ ["--tw-ring-color" as string]: NAVY_BORDER, minHeight: "2.25rem" }}
          >
            {gurus.map((g) => (
              <span key={g} className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border" style={{ background: NAVY_BG, borderColor: NAVY_BORDER, color: NAVY }}>
                {g}
                <button onClick={() => removeGuru(g)} className="text-gray-400 hover:text-red-500 leading-none" aria-label={`Remove ${g}`}>×</button>
              </span>
            ))}
            <input
              list="guru-options"
              value={guruDraft}
              placeholder={gurus.length ? "Add another…" : "Select or type…"}
              onChange={(e) => setGuruDraft(e.target.value)}
              onBlur={() => guruDraft.trim() && addGuru(guruDraft)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGuru(guruDraft); } }}
              className="flex-1 min-w-[8rem] text-sm bg-transparent px-1 py-0.5 focus:outline-none"
            />
          </div>
          <datalist id="guru-options">
            {options.gurus.filter((g) => !gurus.includes(g)).map((g) => <option key={g} value={g} />)}
          </datalist>
        </div>
      </div>

      {/* Actual Performance — from the linked Google Sheet (display only; does NOT affect Copy Quality) */}
      {stats && (
        <div className="rounded-md border bg-white p-3" style={{ borderColor: NAVY_BORDER }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: NAVY }}>
            Actual Performance <span className="font-normal text-gray-400 normal-case">· code {stats.promoCode}</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            {Object.entries(stats.stats).map(([k, v]) => (
              <div key={k} className="text-sm">
                <span className="text-gray-500">{k}: </span>
                <span className="font-semibold text-gray-800">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!stats && statsConfigured && promoCode.trim() && (
        <p className="text-xs text-gray-400">No performance data found for code “{promoCode.trim()}”.</p>
      )}
    </div>
  );
}
