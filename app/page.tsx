"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import PromoUploader from "@/components/PromoUploader";
import AnalysisResults from "@/components/AnalysisResults";
import PastReviews from "@/components/PastReviews";
import LessonsTab from "@/components/LessonsTab";
import PerformanceTab from "@/components/PerformanceTab";
import EntitiesTab from "@/components/EntitiesTab";
import type { AnalysisSections, SavedReview, TrainingData } from "@/lib/reviews-store";
import type { FKScore } from "@/lib/fk-score";
import { readingEaseLabel } from "@/lib/fk-score";
import { deriveScore, type SubScore } from "@/lib/score";

const NAVY = "#012479";

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

function extractMetaFromStream(text: string): { fkScore: FKScore | null; reviewId: string | null } {
  const m = text.match(/\[META\]([\s\S]*?)\[\/META\]/);
  if (!m) return { fkScore: null, reviewId: null };
  try {
    const meta = JSON.parse(m[1]);
    return { fkScore: meta.fkScore ?? null, reviewId: meta.reviewId ?? null };
  } catch {
    return { fkScore: null, reviewId: null };
  }
}


interface Job {
  id: string;
  filename: string;
  reviewId: string | null;
  sections: AnalysisSections;
  fkScore: FKScore | null;
  streaming: boolean;
  error: string | null;
}

type ViewState =
  | { type: "upload" }
  | { type: "job"; id: string }
  | { type: "review"; data: SavedReview }
  | { type: "lessons" }
  | { type: "performance" }
  | { type: "entities" };

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [view, setView] = useState<ViewState>({ type: "upload" });
  const [refreshReviews, setRefreshReviews] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const reviewId = new URLSearchParams(window.location.search).get("review");
    if (!reviewId) return;
    void fetch("/api/reviews")
      .then((r) => r.json())
      .then((reviews: SavedReview[]) => {
        const found = reviews.find((r) => r.id === reviewId);
        if (found) {
          setView({ type: "review", data: found });
          window.history.replaceState({}, "", "/");
        }
      });
  }, []);

  const handleFile = useCallback((file: File, promoRunStartDate: string | null = null) => {
    const id = crypto.randomUUID();
    const job: Job = {
      id,
      filename: file.name,
      reviewId: null,
      sections: EMPTY_SECTIONS,
      fkScore: null,
      streaming: true,
      error: null,
    };

    setJobs((prev) => [...prev, job]);
    // Only switch to this job if we're on the upload screen — otherwise run in background
    setView((prev) => (prev.type === "upload" ? { type: "job", id } : prev));

    void (async () => {
      let error: string | null = null;

      try {
        const formData = new FormData();
        formData.append("file", file);
        if (promoRunStartDate) formData.append("promoRunStartDate", promoRunStartDate);
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
          setJobs((prev) =>
            prev.map((j) => (j.id === id ? { ...j, sections: parsed } : j))
          );
        }

        const { fkScore: fk, reviewId: rid } = extractMetaFromStream(accumulated);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id ? { ...j, fkScore: fk, reviewId: rid } : j
          )
        );
      } catch (err) {
        error = err instanceof Error ? err.message : "Analysis failed";
      }

      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, streaming: false, error } : j))
      );
      setRefreshReviews((n) => n + 1);
    })();
  }, []);

  const handleLoadReview = useCallback((review: SavedReview) => {
    setView({ type: "review", data: review });
  }, []);

  const handleReanalyzed = useCallback((newSections: AnalysisSections, newFkScore: FKScore | null) => {
    setView((prev) => {
      if (prev.type === "review") {
        return {
          ...prev,
          data: {
            ...prev.data,
            sections: newSections,
            fkReadingEase: newFkScore?.readingEase ?? prev.data.fkReadingEase,
            fkGradeLevel: newFkScore?.gradeLevel ?? prev.data.fkGradeLevel,
            // Clear calibrated effectiveness — old training data was for old scoring
            training: prev.data.training
              ? { ...prev.data.training, calibratedEffectiveness: undefined }
              : undefined,
          },
        };
      }
      return prev;
    });
    // For job views, update the job's sections directly
    setJobs((prev) =>
      prev.map((j) => {
        if (view.type === "job" && j.id === view.id) {
          return {
            ...j,
            sections: newSections,
            fkScore: newFkScore ?? j.fkScore,
          };
        }
        return j;
      })
    );
    setRefreshReviews((n) => n + 1);
  }, [view]);

  const handleSelectJob = useCallback((id: string) => {
    setView({ type: "job", id });
  }, []);

  // Derive display data from current view
  const activeJob = view.type === "job" ? jobs.find((j) => j.id === view.id) ?? null : null;
  const activeReview = view.type === "review" ? view.data : null;

  const displayFilename = activeJob?.filename ?? activeReview?.filename ?? null;

  const displaySections: AnalysisSections | null = activeJob?.sections ?? (activeReview
    ? {
        headline: activeReview.sections?.headline ?? "",
        outline: activeReview.sections?.outline ?? "",
        evaldo: activeReview.sections?.evaldo ?? "",
        cub: activeReview.sections?.cub ?? "",
        offer: activeReview.sections?.offer ?? "",
        stockTease: activeReview.sections?.stockTease ?? "",
        effectiveness: activeReview.sections?.effectiveness ?? "",
      }
    : null);

  const displayFkScore: FKScore | null = activeJob?.fkScore ??
    (activeReview?.fkReadingEase != null && activeReview?.fkGradeLevel != null
      ? {
          readingEase: activeReview.fkReadingEase,
          gradeLevel: activeReview.fkGradeLevel,
          label: readingEaseLabel(activeReview.fkReadingEase),
        }
      : null);

  const displayStreaming = activeJob?.streaming ?? false;
  const displayError = activeJob?.error ?? null;

  // Derive final score + sub-scores in code from the effectiveness text. For a
  // saved review we prefer the persisted values; for a live job we compute them.
  const derived = displaySections?.effectiveness
    ? deriveScore(displaySections.effectiveness)
    : { subScores: [] as SubScore[], finalScore: null };
  const effectivenessScore = activeReview?.effectivenessScore ?? derived.finalScore;
  const subScores: SubScore[] | null =
    activeReview?.subScores ?? (derived.subScores.length > 0 ? derived.subScores : null);
  const inputType = activeReview?.inputType ?? null;

  const displayReviewId: string | null = activeJob?.reviewId ?? activeReview?.id ?? null;
  const displayInitialTraining: TrainingData | undefined = activeReview?.training ?? undefined;
  const displayNameProp: string | null = activeReview?.displayName ?? null;
  const displayRunDate: string | null = activeReview?.promoRunStartDate ?? null;
  const displayPromoCode: string | null = activeReview?.promoCode ?? null;
  const displayPublisher: string | null = activeReview?.publisher ?? null;
  const displayGurus: string[] = activeReview?.gurus ?? [];
  const displayProduct: string | null = activeReview?.product ?? null;
  const displayPromoType = activeReview?.promoType ?? null;
  const displayPricePoint: number | null = activeReview?.pricePoint ?? null;
  const displayPromoStatus = activeReview?.promoStatus ?? null;
  const displayCalibratedEffectiveness: string | null =
    activeReview?.training?.calibratedEffectiveness ?? null;

  const hasResults = view.type !== "upload";
  const inProgressJobs = jobs.filter((j) => j.streaming);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f6fb" }}>
      {/* Navy header */}
      <header
        style={{ background: NAVY }}
        className="px-4 sm:px-6 py-3 flex items-center justify-between gap-2 shadow-md"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setMobileSidebarOpen((o) => !o)}
            className="md:hidden shrink-0 text-white p-1.5 -ml-1 rounded hover:bg-white/10"
            aria-label="Toggle past reviews"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/mta-logo-white.png" alt="MTA" className="hidden sm:block h-8 w-auto shrink-0" />
          <div className="sm:border-l sm:border-white/30 sm:pl-3 min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-white leading-tight truncate">SP&apos;s Promo Analyzer</h1>
            <p className="text-xs mt-0.5 hidden sm:block" style={{ color: "#a8bde8" }}>
              From MTA&apos;s AI Labs &mdash; Internal Use Only
            </p>
          </div>
        </div>

        {/* Hidden file input for background uploads */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() =>
              setView((prev) => (prev.type === "lessons" ? { type: "upload" } : { type: "lessons" }))
            }
            className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded border transition-colors font-medium whitespace-nowrap"
            style={{
              borderColor: "rgba(255,255,255,0.3)",
              color: "white",
              background: view.type === "lessons" ? "rgba(255,255,255,0.18)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background =
                view.type === "lessons" ? "rgba(255,255,255,0.18)" : "transparent")
            }
          >
            <span className="sm:hidden">Lessons</span>
            <span className="hidden sm:inline">Lessons Learned</span>
          </button>
          <button
            onClick={() =>
              setView((prev) => (prev.type === "performance" ? { type: "upload" } : { type: "performance" }))
            }
            className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded border transition-colors font-medium whitespace-nowrap"
            style={{
              borderColor: "rgba(255,255,255,0.3)",
              color: "white",
              background: view.type === "performance" ? "rgba(255,255,255,0.18)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background =
                view.type === "performance" ? "rgba(255,255,255,0.18)" : "transparent")
            }
          >
            Performance
          </button>
          <button
            onClick={() =>
              setView((prev) => (prev.type === "entities" ? { type: "upload" } : { type: "entities" }))
            }
            className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded border transition-colors font-medium whitespace-nowrap"
            style={{
              borderColor: "rgba(255,255,255,0.3)",
              color: "white",
              background: view.type === "entities" ? "rgba(255,255,255,0.18)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background =
                view.type === "entities" ? "rgba(255,255,255,0.18)" : "transparent")
            }
          >
            Directory
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded border transition-colors font-medium whitespace-nowrap"
            style={{ borderColor: "rgba(255,255,255,0.3)", color: "white", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span className="sm:hidden">+ New</span>
            <span className="hidden sm:inline">+ New Promo</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop when sidebar drawer is open */}
        {mobileSidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-20 bg-black/30"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        {/* Sidebar — static column on desktop, slide-in drawer on mobile */}
        <aside
          className={`${
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:translate-x-0 fixed md:static z-30 top-0 bottom-0 left-0 w-64 shrink-0 flex flex-col border-r transition-transform duration-200`}
          style={{ background: "#fff", borderColor: "#dde4f0" }}
        >
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "#dde4f0", background: "#f0f4fc" }}
          >
            <h2
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: NAVY }}
            >
              Past Reviews
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <PastReviews
              onLoad={(r) => { handleLoadReview(r); setMobileSidebarOpen(false); }}
              onSelectJob={(j) => { handleSelectJob(j); setMobileSidebarOpen(false); }}
              refreshTrigger={refreshReviews}
              inProgressJobs={inProgressJobs}
              activeJobId={view.type === "job" ? view.id : undefined}
            />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {displayError && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {displayError}
            </div>
          )}

          {/* Lessons Learned — global knowledge base */}
          {view.type === "lessons" && <LessonsTab />}

          {/* Real-world performance data + brain teaching */}
          {view.type === "performance" && <PerformanceTab />}

          {/* Entity directory — publishers, gurus, products */}
          {view.type === "entities" && <EntitiesTab />}

          {/* Upload screen */}
          {view.type === "upload" && (
            <div className="max-w-2xl mx-auto mt-12">
              <PromoUploader onFile={handleFile} disabled={false} />
              <p className="text-center text-xs text-gray-400 mt-4">
                16-Word Sales Letter framework · CUB review · FK score · Offer summary · Stock tease prediction
              </p>
            </div>
          )}

          {/* Initial loading spinner (job started but no headline yet) */}
          {view.type === "job" && displayStreaming && !displaySections?.headline && (
            <div className="max-w-2xl mx-auto mt-12 flex flex-col items-center gap-4">
              <div
                className="w-10 h-10 border-4 rounded-full animate-spin"
                style={{ borderColor: "#dde4f0", borderTopColor: NAVY }}
              />
              <p className="text-sm text-gray-500">
                Analyzing <span className="font-medium">{displayFilename}</span>…
              </p>
              <p className="text-xs text-gray-400">This takes 30–60 seconds for a full promo</p>
            </div>
          )}

          {/* Results */}
          {hasResults && displayFilename && displaySections && (displaySections.headline || displayStreaming) && (
            <div className="max-w-4xl mx-auto">
              <AnalysisResults
                filename={displayFilename}
                sections={displaySections}
                fkScore={displayFkScore}
                effectivenessScore={effectivenessScore}
                subScores={subScores}
                inputType={inputType}
                streaming={displayStreaming}
                reviewId={displayReviewId}
                displayName={displayNameProp}
                calibratedEffectiveness={displayCalibratedEffectiveness}
                initialTraining={displayInitialTraining}
                initialRunDate={displayRunDate}
                initialPromoCode={displayPromoCode}
                initialPublisher={displayPublisher}
                initialGurus={displayGurus}
                initialProduct={displayProduct}
                initialPromoType={displayPromoType}
                initialPricePoint={displayPricePoint}
                initialPromoStatus={displayPromoStatus}
                onScoreApplied={() => setRefreshReviews((n) => n + 1)}
                onReanalyzed={handleReanalyzed}
                onRename={(newName) => {
                  // Immediately update the active review's displayName in local state
                  setView((prev) =>
                    prev.type === "review"
                      ? { ...prev, data: { ...prev.data, displayName: newName } }
                      : prev
                  );
                  // Also refresh the sidebar list
                  setRefreshReviews((n) => n + 1);
                }}
              />
            </div>
          )}

          {/* Saved review with no sections (edge case) */}
          {view.type === "review" && displayFilename && !displaySections?.headline && !displayStreaming && (
            <div className="max-w-2xl mx-auto mt-12 text-center text-gray-400 text-sm">
              No analysis content found for this review.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
