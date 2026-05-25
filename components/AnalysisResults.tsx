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
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? "Exporting…" : "⬇ Export Word"}
          </button>
        )}
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
              {streaming && sections[tab.key] === "" && (
                <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />
              )}
              {streaming && sections[tab.key] !== "" && (
                <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-64">
        {activeTab === "headline" && (
          <HeadlineSection content={sections.headline} />
        )}
        {activeTab === "outline" && (
          <OutlineSection content={sections.outline} />
        )}
        {activeTab === "evaldo" && (
          <EvaldoSection content={sections.evaldo} />
        )}
        {activeTab === "cub" && (
          sections.cub
            ? <CUBViewer content={sections.cub} />
            : <p className="text-sm text-gray-400 italic">CUB review generating…</p>
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
