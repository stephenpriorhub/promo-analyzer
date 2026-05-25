"use client";

import { useState } from "react";
import type { AnalysisSections } from "@/lib/reviews-store";
import type { FKScore } from "@/lib/fk-score";
import ScoreBadges from "./ScoreBadges";
import HeadlineSection from "./HeadlineSection";
import OutlineSection from "./OutlineSection";
import EvaldoSection from "./EvaldoSection";
import CUBViewer from "./CUBViewer";
import OfferSection from "./OfferSection";

const NAVY = "#012479";
const NAVY_LIGHT = "#0a3a9e";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface Props {
  filename: string;
  sections: AnalysisSections;
  fkScore: FKScore | null;
  effectivenessScore: number | null;
  streaming?: boolean;
}

const TABS = [
  { key: "headline", label: "Headline" },
  { key: "outline", label: "Outline" },
  { key: "evaldo", label: "16-Word Sales Letter" },
  { key: "cub", label: "CUB Review" },
  { key: "offer", label: "Offer & Summary" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const STEPS: { key: keyof AnalysisSections; label: string }[] = [
  { key: "headline", label: "Headline Analysis" },
  { key: "outline", label: "Promo Outline" },
  { key: "evaldo", label: "16-Word Framework" },
  { key: "cub", label: "CUB Review" },
  { key: "offer", label: "Offer Summary" },
  { key: "stockTease", label: "Stock Tease" },
  { key: "effectiveness", label: "Effectiveness Score" },
];

function ProgressBar({ sections, streaming }: { sections: AnalysisSections; streaming?: boolean }) {
  if (!streaming) return null;

  const completed = STEPS.filter((s) => sections[s.key] !== "").length;
  const total = STEPS.length;
  const pct = Math.round((completed / total) * 100);
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

export default function AnalysisResults({
  filename,
  sections,
  fkScore,
  effectivenessScore,
  streaming,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("headline");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, sections, fkScore }),
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900 truncate">{filename}</h2>
          <ScoreBadges fkScore={fkScore} effectivenessScore={effectivenessScore} />
        </div>
        {!streaming && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition-colors"
            style={{ background: NAVY }}
            onMouseEnter={e => (e.currentTarget.style.background = NAVY_LIGHT)}
            onMouseLeave={e => (e.currentTarget.style.background = NAVY)}
          >
            {exporting ? "Exporting…" : "⬇ Export Word"}
          </button>
        )}
      </div>

      <ProgressBar sections={sections} streaming={streaming} />

      {/* Tabs */}
      <div className="border-b" style={{ borderColor: NAVY_BORDER }}>
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const isDone = streaming && sections[tab.key] !== "";
            const isPending = streaming && sections[tab.key] === "";
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
              <div
                className="w-8 h-8 rounded-full animate-spin"
                style={{ border: `3px solid ${NAVY_BORDER}`, borderTopColor: NAVY }}
              />
              <p className="text-sm">Reviewing full promo copy — this is the longest step…</p>
            </div>
          )
        )}
        {activeTab === "offer" && (
          <OfferSection
            content={sections.offer}
            stockTease={sections.stockTease}
            effectiveness={sections.effectiveness}
          />
        )}
      </div>
    </div>
  );
}
