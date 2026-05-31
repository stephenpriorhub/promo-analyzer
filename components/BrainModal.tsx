"use client";

import { useState, useEffect } from "react";
import type { AnalysisSections } from "@/lib/reviews-store";
import type { FKScore } from "@/lib/fk-score";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface Props {
  defaultTitle: string;
  sections: AnalysisSections;
  fkScore: FKScore | null;
  effectivenessScore: number | null;
  promoType?: string | null;
  calibratedEffectiveness?: string | null;
  onClose: () => void;
}

function extractBigIdea(offer: string): { bigIdea: string; offerWithout: string } {
  const lines = offer.split("\n").filter((l) => l.trim());
  let bigIdea = "";
  const rest: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(/^[-•]\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1");
    const colonIdx = stripped.indexOf(":");
    if (colonIdx !== -1 && colonIdx < 40) {
      const label = stripped.slice(0, colonIdx).trim().toLowerCase();
      if (label === "big idea") {
        bigIdea = stripped.slice(colonIdx + 1).trim();
        continue;
      }
    }
    rest.push(line);
  }
  return { bigIdea, offerWithout: rest.join("\n") };
}

function buildNote(
  title: string,
  tags: string,
  sections: AnalysisSections,
  fkScore: FKScore | null,
  effectivenessScore: number | null,
  calibratedEffectiveness?: string | null
): string {
  const today = new Date().toISOString().slice(0, 10);
  const tagList = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const tagsYaml = `[${tagList.join(", ")}]`;
  const effLine = effectivenessScore !== null ? `${effectivenessScore}/10` : null;

  const frontmatterLines = [
    "---",
    `title: "${title}"`,
    "status: active",
    `tags: ${tagsYaml}`,
    `created: ${today}`,
    `updated: ${today}`,
    effLine ? `effectiveness: ${effLine}` : null,
    fkScore?.readingEase != null ? `fk-reading-ease: ${fkScore.readingEase}` : null,
    fkScore?.gradeLevel != null ? `fk-grade-level: ${fkScore.gradeLevel}` : null,
    "---",
  ].filter((l): l is string => l !== null);

  const { bigIdea, offerWithout } = extractBigIdea(sections.offer);

  const parts: string[] = [frontmatterLines.join("\n"), ""];

  if (bigIdea) {
    parts.push("## Big Idea", bigIdea, "");
  }

  const effectivenessToUse = calibratedEffectiveness || sections.effectiveness;
  if (effectivenessToUse) {
    parts.push("## Effectiveness", effectivenessToUse, "");
  }

  if (sections.headline) {
    parts.push("## Headline Analysis", sections.headline, "");
  }

  if (sections.outline) {
    parts.push("## Promo Outline", sections.outline, "");
  }

  if (sections.evaldo) {
    parts.push("## 16-Word Sales Letter", sections.evaldo, "");
  }

  if (offerWithout.trim()) {
    parts.push("## Offer Summary", offerWithout, "");
  }

  if (sections.stockTease && sections.stockTease !== "NONE") {
    parts.push("## Stock Tease", sections.stockTease, "");
  }

  return parts.join("\n");
}

export default function BrainModal({
  defaultTitle,
  sections,
  fkScore,
  effectivenessScore,
  promoType,
  calibratedEffectiveness,
  onClose,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [tags, setTags] = useState("promo, copywriting, analysis");
  const [tagsLoading, setTagsLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [savedPath, setSavedPath] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch smart tag suggestions on open
  useEffect(() => {
    setTagsLoading(true);
    fetch("/api/brain/suggest-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: defaultTitle,
        promoType: promoType ?? null,
        sections: {
          headline: sections.headline,
          offer: sections.offer,
          effectiveness: sections.effectiveness,
        },
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.tags) && data.tags.length > 0) {
          setTags(data.tags.join(", "));
        }
      })
      .catch(() => {}) // keep default on error
      .finally(() => setTagsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteContent = buildNote(title, tags, sections, fkScore, effectivenessScore, calibratedEffectiveness);

  async function handleAdd() {
    setStatus("loading");
    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: noteContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setSavedPath(json.path);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: NAVY_BORDER }}
        >
          <div>
            <h2 className="text-base font-bold" style={{ color: NAVY }}>
              🧠 Add to Brain
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Saves to Resources / Promo Analysis / Promo Analysis Tool /
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {status === "success" ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-5xl">✅</p>
              <p className="font-semibold text-gray-800 text-base">Note saved to Obsidian!</p>
              <p className="text-xs text-gray-400 font-mono break-all leading-relaxed">
                {savedPath}
              </p>
            </div>
          ) : (
            <>
              {/* Title */}
              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: NAVY }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ borderColor: NAVY_BORDER }}
                  placeholder="Note title…"
                />
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    className="block text-xs font-semibold uppercase tracking-wider"
                    style={{ color: NAVY }}
                  >
                    Tags{" "}
                    <span className="font-normal text-gray-400 normal-case">
                      (comma-separated)
                    </span>
                  </label>
                  {tagsLoading && (
                    <span className="text-xs text-gray-400 animate-pulse">
                      Suggesting tags…
                    </span>
                  )}
                </div>
                <textarea
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono resize-none"
                  style={{ borderColor: NAVY_BORDER }}
                  placeholder="promo, copywriting, analysis"
                  disabled={tagsLoading}
                />
              </div>

              {/* Read-only metadata badges */}
              <div className="flex flex-wrap gap-2">
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ background: NAVY_BG, color: NAVY }}
                >
                  📅 {today}
                </span>
                {effectivenessScore !== null && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                    ⭐ {effectivenessScore}/10
                  </span>
                )}
                {fkScore && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    FK {fkScore.readingEase} · Grade {fkScore.gradeLevel}
                  </span>
                )}
              </div>

              {/* Collapsible preview */}
              <div>
                <button
                  onClick={() => setPreviewOpen((p) => !p)}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <span className="text-xs">{previewOpen ? "▾" : "▸"}</span>
                  Note Preview
                </button>
                {previewOpen && (
                  <pre
                    className="mt-2 text-xs bg-gray-50 border rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed"
                    style={{ borderColor: NAVY_BORDER }}
                  >
                    {noteContent}
                  </pre>
                )}
              </div>

              {/* Error state */}
              {status === "error" && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex gap-3 justify-end shrink-0"
          style={{ borderColor: NAVY_BORDER }}
        >
          {status === "success" ? (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: NAVY }}
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!title.trim() || status === "loading"}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity"
                style={{ background: NAVY }}
              >
                {status === "loading" ? "Saving…" : "Add Note"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
