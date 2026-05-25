"use client";

import { useState, useCallback } from "react";
import PromoUploader from "@/components/PromoUploader";
import AnalysisResults from "@/components/AnalysisResults";
import PastReviews from "@/components/PastReviews";
import type { AnalysisSections, SavedReview } from "@/lib/reviews-store";
import type { FKScore } from "@/lib/fk-score";

const EMPTY_SECTIONS: AnalysisSections = {
  headline: "",
  outline: "",
  evaldo: "",
  cub: "",
  offer: "",
  stockTease: "",
  effectiveness: "",
};

function parseSections(raw: string): AnalysisSections {
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

function extractFKFromMeta(text: string): FKScore | null {
  const m = text.match(/\[META\]([\s\S]*?)\[\/META\]/);
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    return meta.fkScore ?? null;
  } catch {
    return null;
  }
}

function extractScore(effectiveness: string): number | null {
  const m = effectiveness.match(/(\d+)\s*\/\s*10/);
  return m ? parseInt(m[1], 10) : null;
}

export default function Home() {
  const [filename, setFilename] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sections, setSections] = useState<AnalysisSections>(EMPTY_SECTIONS);
  const [fkScore, setFkScore] = useState<FKScore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshReviews, setRefreshReviews] = useState(0);

  const handleFile = useCallback(async (file: File) => {
    setFilename(file.name);
    setSections(EMPTY_SECTIONS);
    setFkScore(null);
    setError(null);
    setStreaming(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Analysis failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const parsed = parseSections(accumulated);
        setSections(parsed);
      }

      const fk = extractFKFromMeta(accumulated);
      if (fk) setFkScore(fk);
      setRefreshReviews((n) => n + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      setError(message);
    } finally {
      setStreaming(false);
    }
  }, []);

  const handleLoadReview = useCallback((review: SavedReview) => {
    setFilename(review.filename);
    setSections(review.sections);
    setFkScore(
      review.fkReadingEase !== null && review.fkGradeLevel !== null
        ? {
            readingEase: review.fkReadingEase,
            gradeLevel: review.fkGradeLevel,
            label: "",
          }
        : null
    );
    setError(null);
    setStreaming(false);
  }, []);

  const effectivenessScore = sections.effectiveness
    ? extractScore(sections.effectiveness)
    : null;

  const hasResults = filename !== null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f6fb" }}>
      {/* Navy header */}
      <header style={{ background: "#012479" }} className="px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/mta-logo-white.png" alt="MTA" className="h-8 w-auto" />
          <div className="border-l border-white/30 pl-4">
            <h1 className="text-base font-bold text-white leading-tight">SP&apos;s Promo Analyzer</h1>
            <p className="text-xs mt-0.5" style={{ color: "#a8bde8" }}>From MTA&apos;s AI Labs &mdash; Internal Use Only</p>
          </div>
        </div>
        {hasResults && !streaming && (
          <button
            onClick={() => {
              setFilename(null);
              setSections(EMPTY_SECTIONS);
              setFkScore(null);
              setError(null);
            }}
            className="text-sm px-3 py-1.5 rounded border transition-colors font-medium"
            style={{ borderColor: "rgba(255,255,255,0.3)", color: "white" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            Analyze New Promo
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 flex flex-col border-r" style={{ background: "#fff", borderColor: "#dde4f0" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#dde4f0", background: "#f0f4fc" }}>
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#012479" }}>Past Reviews</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <PastReviews onLoad={handleLoadReview} refreshTrigger={refreshReviews} />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {!hasResults && (
            <div className="max-w-2xl mx-auto mt-12">
              <PromoUploader onFile={handleFile} disabled={streaming} />
              <p className="text-center text-xs text-gray-400 mt-4">
                16-Word Sales Letter framework · CUB review · FK score · Offer summary · Stock tease prediction
              </p>
            </div>
          )}

          {streaming && !sections.headline && (
            <div className="max-w-2xl mx-auto mt-12 flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: "#dde4f0", borderTopColor: "#012479" }} />
              <p className="text-sm text-gray-500">Analyzing <span className="font-medium">{filename}</span>…</p>
              <p className="text-xs text-gray-400">This takes 30–60 seconds for a full promo</p>
            </div>
          )}

          {hasResults && (sections.headline || streaming) && (
            <div className="max-w-4xl mx-auto">
              <AnalysisResults
                filename={filename!}
                sections={sections}
                fkScore={fkScore}
                effectivenessScore={effectivenessScore}
                streaming={streaming}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
