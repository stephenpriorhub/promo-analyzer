"use client";

import { useEffect, useRef, useState } from "react";
import type { SavedReview } from "@/lib/reviews-store";

export interface InProgressJob {
  id: string;
  filename: string;
}

interface Props {
  onLoad: (review: SavedReview) => void;
  onSelectJob: (id: string) => void;
  refreshTrigger: number;
  inProgressJobs: InProgressJob[];
  activeJobId?: string;
}

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

function liveScore(review: SavedReview): number | null {
  // Use the persisted, code-derived score — the SAME value the detail view shows
  // (set on analysis, re-analysis, and training re-evaluation). Don't re-parse the
  // effectiveness text: its first "/10" is a dimension score, not the final.
  return review.effectivenessScore;
}

function scoreColor(score: number | null) {
  if (score === null) return "text-gray-400";
  if (score >= 8) return "text-green-600";
  if (score >= 6) return "text-yellow-600";
  return "text-red-600";
}

function displayNameFor(review: SavedReview) {
  return review.displayName ?? review.filename.replace(/\.[^.]+$/, "");
}

export default function PastReviews({
  onLoad,
  onSelectJob,
  refreshTrigger,
  inProgressJobs,
  activeJobId,
}: Props) {
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchReviews() {
    try {
      const res = await fetch("/api/reviews");
      const data = await res.json();
      setReviews(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReviews();
  }, [refreshTrigger]);

  // Re-sync when the tab regains focus, so scores changed out-of-band (e.g. a
  // re-analyze in another view, or a background re-score) don't leave the
  // sidebar showing a stale number that disagrees with the detail panel.
  useEffect(() => {
    const onFocus = () => fetchReviews();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Focus input when edit mode starts
  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/reviews?id=${id}`, { method: "DELETE" });
    setReviews((prev) => prev.filter((r) => r.id !== id));
  }

  function startEdit(review: SavedReview, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(review.id);
    setEditValue(displayNameFor(review));
  }

  async function commitEdit(id: string) {
    const name = editValue.trim();
    setEditingId(null);
    // Optimistic update
    setReviews((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, displayName: name || undefined } : r
      )
    );
    await fetch("/api/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, displayName: name }),
    });
  }

  function handleEditKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(id);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  }

  return (
    <div className="space-y-1">
      {/* In-progress jobs */}
      {inProgressJobs.length > 0 && (
        <div className="px-3 pt-2 pb-1">
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: NAVY }}
          >
            Analyzing
          </p>
          {inProgressJobs.map((job) => {
            const isActive = job.id === activeJobId;
            const name = job.filename.replace(/\.[^.]+$/, "");
            return (
              <div
                key={job.id}
                onClick={() => onSelectJob(job.id)}
                className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors mb-1"
                style={{
                  background: isActive ? NAVY_BG : "transparent",
                  border: isActive ? `1px solid ${NAVY_BORDER}` : "1px solid transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#f9fafb";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 animate-pulse"
                  style={{ background: NAVY }}
                />
                <p className="text-sm font-medium truncate" style={{ color: NAVY }}>
                  {name}
                </p>
              </div>
            );
          })}
          {reviews.length > 0 && (
            <div className="mt-2 mb-1 border-t" style={{ borderColor: NAVY_BORDER }} />
          )}
        </div>
      )}

      {/* Saved reviews */}
      {loading ? (
        <div className="text-xs text-gray-400 p-4">Loading past reviews...</div>
      ) : reviews.length === 0 && inProgressJobs.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-400">
          No saved reviews yet.
          <br />
          Analyze a promo to save it here.
        </div>
      ) : (
        reviews.map((review) => {
          const date = new Date(review.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const name = displayNameFor(review);
          const isEditing = editingId === review.id;

          return (
            <div
              key={review.id}
              className="group flex items-start gap-2 px-3 py-2.5 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              onClick={() => {
                if (!isEditing) onLoad(review);
              }}
            >
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => handleEditKeyDown(e, review.id)}
                    onBlur={() => commitEdit(review.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full text-sm font-medium text-gray-700 border-b border-blue-400 bg-transparent outline-none px-0 py-0"
                  />
                ) : (
                  <p className="text-sm font-medium text-gray-700 truncate">{name}</p>
                )}
                <p className="text-xs text-gray-400">{date}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(() => {
                  const score = liveScore(review);
                  return score !== null ? (
                    <span className={`text-sm font-bold ${scoreColor(score)}`}>
                      {score.toFixed(1)}/10
                    </span>
                  ) : null;
                })()}
                {/* Pencil / rename button */}
                <button
                  onClick={(e) => startEdit(review, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all text-xs px-1"
                  title="Rename"
                >
                  ✏
                </button>
                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(review.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all text-xs px-1"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
