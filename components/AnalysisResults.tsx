"use client";

import { useState, useEffect } from "react";
import type { AnalysisSections, TrainingData, InputType } from "@/lib/reviews-store";
import type { PromoType } from "@/lib/promo-types";
import type { SubScore } from "@/lib/score";
import type { FKScore } from "@/lib/fk-score";
import ScoreBadges from "./ScoreBadges";
import HeadlineSection from "./HeadlineSection";
import OutlineSection from "./OutlineSection";
import EvaldoSection from "./EvaldoSection";
import CUBViewer from "./CUBViewer";
import OfferSection from "./OfferSection";
import PromoMetadata from "./PromoMetadata";
import BrainModal from "./BrainModal";
import TrainingTab from "./TrainingTab";
import DocumentsTab from "./DocumentsTab";
import RealResults from "./RealResults";

const NAVY = "#012479";
const NAVY_LIGHT = "#0a3a9e";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface Props {
  filename: string;
  sections: AnalysisSections;
  fkScore: FKScore | null;
  effectivenessScore: number | null;
  subScores?: SubScore[] | null;
  inputType?: InputType | null;
  streaming?: boolean;
  reviewId?: string | null;
  displayName?: string | null;
  calibratedEffectiveness?: string | null;
  initialTraining?: TrainingData;
  initialRunDate?: string | null;
  initialPromoCode?: string | null;
  initialPublisher?: string | null;
  initialGurus?: string[];
  initialProduct?: string | null;
  initialPromoType?: PromoType | null;
  initialPricePoint?: number | null;
  onScoreApplied?: () => void;
  onRename?: (newName: string) => void;
  onReanalyzed?: (sections: AnalysisSections, fkScore: FKScore | null) => void;
}

const TABS = [
  { key: "offer", label: "Summary" },
  { key: "headline", label: "Headline" },
  { key: "outline", label: "Outline" },
  { key: "evaldo", label: "16-Word Sales Letter" },
  { key: "cub", label: "CUB Review" },
  { key: "training", label: "Training" },
  { key: "documents", label: "Documents" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const STEPS: { key: keyof AnalysisSections; label: string }[] = [
  { key: "headline", label: "Headline Analysis" },
  { key: "outline", label: "Promo Outline" },
  { key: "evaldo", label: "16-Word Sales Letter" },
  { key: "cub", label: "CUB Review" },
  { key: "offer", label: "Offer Summary" },
  { key: "stockTease", label: "Stock Tease" },
  { key: "effectiveness", label: "Copy Quality Score" },
];

function ProgressBar({ sections, streaming, pct }: { sections: AnalysisSections; streaming?: boolean; pct: number }) {
  if (!streaming) return null;

  const activeStep = STEPS.find((s) => sections[s.key] === "");

  return (
    <div className="mb-4 p-3 rounded-lg" style={{ background: NAVY_BG, border: `1px solid ${NAVY_BORDER}` }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium" style={{ color: NAVY }}>
          {activeStep ? `Generating ${activeStep.label}…` : "Wrapping up…"}
        </span>
        <span className="text-xs font-bold" style={{ color: NAVY }}>{pct}%</span>
      </div>

      <div className="h-2 rounded-full overflow-hidden" style={{ background: NAVY_BORDER }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: NAVY }}
        />
      </div>

      <div className="flex justify-between mt-2">
        {STEPS.map((step) => {
          const done = sections[step.key] !== "";
          const active = activeStep?.key === step.key;
          return (
            <div key={step.key} className="flex flex-col items-center">
              <div
                className="w-2 h-2 rounded-full transition-all duration-300"
                style={{
                  background: done ? NAVY : active ? NAVY_LIGHT : NAVY_BORDER,
                  opacity: active ? undefined : done ? 1 : 0.5,
                  animation: active ? "pulse 1.5s infinite" : undefined,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const INPUT_TYPE_LABELS: Record<string, string> = {
  "visual-pdf": "Visual PDF",
  docx: "Word (text)",
  text: "Text",
};

export default function AnalysisResults({
  filename,
  sections,
  fkScore,
  effectivenessScore,
  subScores,
  inputType,
  streaming,
  reviewId,
  displayName,
  calibratedEffectiveness,
  initialTraining,
  initialRunDate,
  initialPromoCode,
  initialPublisher,
  initialGurus,
  initialProduct,
  initialPromoType,
  initialPricePoint,
  onScoreApplied,
  onRename,
  onReanalyzed,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("offer");
  const [exporting, setExporting] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(displayName ?? null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  // Match the sidebar label format: displayName if set, else filename without extension
  const shownTitle = localDisplayName ?? filename.replace(/\.[^.]+$/, "");
  const [effectivenessOverride, setEffectivenessOverride] = useState<string | null>(null);
  // Tracked here (not just in PromoMetadata) so the Real-World Results panel
  // appears the moment a creative code is set, without a reload.
  const [livePromoCode, setLivePromoCode] = useState<string | null>(initialPromoCode ?? null);

  // Reset local state whenever the underlying review changes
  useEffect(() => {
    setEffectivenessOverride(calibratedEffectiveness ?? null);
    setLocalDisplayName(displayName ?? null);
    setEditingTitle(false);
    setLivePromoCode(initialPromoCode ?? null);
  }, [reviewId, filename, displayName, calibratedEffectiveness, initialPromoCode]);

  const effectivenessContent = effectivenessOverride ?? sections.effectiveness;
  // Final score is the code-derived value passed in (effectivenessScore). When a
  // calibrated override is shown, fall back to parsing its score marker.
  const derivedEffectivenessScore = (() => {
    if (effectivenessOverride) {
      const m = effectivenessOverride.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
      if (m) return parseFloat(m[1]);
    }
    return effectivenessScore;
  })();

  const completed = STEPS.filter((s) => sections[s.key] !== "").length;
  const pct = Math.round((completed / STEPS.length) * 100);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, sections: { ...sections, effectiveness: effectivenessContent }, fkScore }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\.[^.]+$/, "") + "_analysis.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Export failed. Check the console for details.");
    } finally {
      setExporting(false);
    }
  }

  async function commitTitleRename() {
    const name = titleValue.trim();
    setEditingTitle(false);
    if (!name || !reviewId) return;
    setLocalDisplayName(name);
    await fetch("/api/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reviewId, displayName: name }),
    });
    onRename?.(name);
  }

  async function handleReanalyze() {
    if (!reviewId) return;
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const res = await fetch("/api/reanalyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Re-analysis failed" }));
        throw new Error(err.error || "Re-analysis failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      function parseSectionsLocal(raw: string) {
        function extract(tag: string) {
          const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
          const m = raw.match(re);
          return m ? m[1].trim() : "";
        }
        return {
          headline: extract("HEADLINE"),
          outline: extract("OUTLINE"),
          evaldo: extract("EVALDO"),
          cub: extract("CUB"),
          offer: extract("OFFER"),
          stockTease: extract("STOCK_TEASE"),
          effectiveness: extract("EFFECTIVENESS"),
        };
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const parsed = parseSectionsLocal(accumulated);
        // Notify parent with streaming sections so UI updates in real time
        if (parsed.headline || parsed.offer) {
          onReanalyzed?.(parsed, null);
        }
      }

      // Extract meta for fkScore
      const metaMatch = accumulated.match(/\[META\]([\s\S]*?)\[\/META\]/);
      let fk = null;
      if (metaMatch) {
        try { fk = JSON.parse(metaMatch[1]).fkScore ?? null; } catch { /* ignore */ }
      }
      const finalSections = parseSectionsLocal(accumulated);
      onReanalyzed?.(finalSections, fk);
    } catch (err) {
      setReanalyzeError(err instanceof Error ? err.message : "Re-analysis failed");
    } finally {
      setReanalyzing(false);
    }
  }

  const defaultBrainTitle = (localDisplayName ?? filename).replace(/\.[^.]+$/, "");

  return (
    <div className="flex flex-col gap-4">
      {brainOpen && (
        <BrainModal
          defaultTitle={defaultBrainTitle}
          sections={sections}
          fkScore={fkScore}
          effectivenessScore={derivedEffectivenessScore}
          promoType={initialTraining?.promoType ?? null}
          calibratedEffectiveness={effectivenessOverride}
          onClose={() => setBrainOpen(false)}
        />
      )}
      {reanalyzeError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          Re-analyze failed: {reanalyzeError}
        </div>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={commitTitleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitleRename();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="text-lg font-bold text-gray-900 bg-transparent border-b-2 outline-none w-full max-w-md"
              style={{ borderColor: NAVY }}
            />
          ) : (
            <div className="flex items-center gap-2 group">
              <h2 className="text-lg font-bold text-gray-900 truncate">{shownTitle}</h2>
              {reviewId && !streaming && (
                <button
                  onClick={() => { setTitleValue(localDisplayName ?? filename.replace(/\.[^.]+$/, "")); setEditingTitle(true); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all text-sm"
                  title="Rename"
                >
                  ✏
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <ScoreBadges fkScore={fkScore} effectivenessScore={derivedEffectivenessScore} />
            {inputType && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: NAVY_BG, color: NAVY, border: `1px solid ${NAVY_BORDER}` }}
                title="Input modality this promo was analyzed from"
              >
                {INPUT_TYPE_LABELS[inputType] ?? inputType}
              </span>
            )}
          </div>
        </div>
        {!streaming && (
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            {reviewId && (
              <button
                onClick={handleReanalyze}
                disabled={reanalyzing}
                className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium border transition-colors disabled:opacity-50"
                style={{ borderColor: NAVY_BORDER, color: NAVY, background: NAVY_BG }}
                onMouseEnter={e => !reanalyzing && (e.currentTarget.style.background = "#dce8f8")}
                onMouseLeave={e => (e.currentTarget.style.background = NAVY_BG)}
                title="Re-run full analysis with the current scoring system"
              >
                {reanalyzing ? "Re-analyzing…" : "↺ Re-analyze"}
              </button>
            )}
            <button
              onClick={() => setBrainOpen(true)}
              className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium border transition-colors"
              style={{ borderColor: NAVY_BORDER, color: NAVY, background: NAVY_BG }}
              onMouseEnter={e => (e.currentTarget.style.background = "#dce8f8")}
              onMouseLeave={e => (e.currentTarget.style.background = NAVY_BG)}
            >
              🧠 Add to Brain
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-white text-xs sm:text-sm font-medium disabled:opacity-50 transition-colors"
              style={{ background: NAVY }}
              onMouseEnter={e => (e.currentTarget.style.background = NAVY_LIGHT)}
              onMouseLeave={e => (e.currentTarget.style.background = NAVY)}
            >
              {exporting ? "Exporting…" : "⬇ Export Word"}
            </button>
          </div>
        )}
      </div>

      <ProgressBar sections={sections} streaming={streaming} pct={pct} />

      {/* Real-world results when a creative code has data; predicted score otherwise */}
      {reviewId && !streaming && <RealResults promoCode={livePromoCode} reviewId={reviewId} />}

      {/* Tabs */}
      <div className="border-b" style={{ borderColor: NAVY_BORDER }}>
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const isSection = tab.key !== "training" && tab.key !== "documents";
            const isDone = streaming && isSection && sections[tab.key as keyof AnalysisSections] !== "";
            const isPending = streaming && isSection && sections[tab.key as keyof AnalysisSections] === "";
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
                style={{
                  borderBottomColor: isActive ? NAVY : "transparent",
                  color: isActive ? NAVY : "#6b7280",
                }}
              >
                {tab.label}
                {isPending && (
                  <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />
                )}
                {isDone && (
                  <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="min-h-64">
        {activeTab === "headline" && <HeadlineSection content={sections.headline} />}
        {activeTab === "outline" && <OutlineSection content={sections.outline} />}
        {activeTab === "evaldo" && <EvaldoSection content={sections.evaldo} />}
        {activeTab === "cub" && (
          sections.cub ? (
            <CUBViewer content={sections.cub} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              {streaming && (
                <p className="text-5xl font-bold tabular-nums" style={{ color: NAVY }}>{pct}%</p>
              )}
              <p className="text-sm">Reviewing full promo copy — this is the longest step…</p>
            </div>
          )
        )}
        {activeTab === "offer" && (
          <div className="space-y-6">
            {reviewId && (
              <PromoMetadata
                reviewId={reviewId}
                initialPromoCode={initialPromoCode}
                initialPublisher={initialPublisher}
                initialGurus={initialGurus}
                initialProduct={initialProduct}
                initialPromoType={initialPromoType}
                initialPricePoint={initialPricePoint}
                onUpdated={onScoreApplied}
                onPromoCodeChange={setLivePromoCode}
              />
            )}
            <OfferSection
              content={sections.offer}
              stockTease={sections.stockTease}
              effectiveness={sections.effectiveness}
              calibratedEffectiveness={effectivenessOverride !== null ? effectivenessOverride : null}
              subScores={subScores ?? null}
              finalScore={effectivenessOverride ? null : effectivenessScore}
            />
          </div>
        )}
        {activeTab === "documents" && (
          <DocumentsTab reviewId={reviewId ?? null} filename={filename} />
        )}
        {activeTab === "training" && (
          <TrainingTab
            key={reviewId ?? filename}
            reviewId={reviewId ?? null}
            effectivenessContent={effectivenessContent}
            initialTraining={initialTraining}
            initialRunDate={initialRunDate ?? null}
            onEffectivenessUpdate={setEffectivenessOverride}
            onApplied={onScoreApplied}
          />
        )}
      </div>
    </div>
  );
}
