"use client";

import { useEffect, useState } from "react";
import type { SavedReview } from "@/lib/reviews-store";

interface Props {
  onLoad: (review: SavedReview) => void;
  refreshTrigger: number;
}

function scoreColor(score: number | null) {
  if (score === null) return "text-gray-400";
  if (score >= 8) return "text-green-600";
  if (score >= 6) return "text-yellow-600";
  return "text-red-600";
}

export default function PastReviews({ onLoad, refreshTrigger }: Props) {
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/reviews?id=${id}`, { method: "DELETE" });
    setReviews((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) {
    return <div className="text-xs text-gray-400 p-4">Loading past reviews...</div>;
  }

  if (reviews.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        No saved reviews yet.
        <br />
        Analyze a promo to save it here.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {reviews.map((review) => {
        const date = new Date(review.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const name = review.filename.replace(/\.[^.]+$/, "");

        return (
          <div
            key={review.id}
            className="group flex items-start gap-2 px-3 py-2.5 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
            onClick={() => onLoad(review)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700 truncate">{name}</p>
              <p className="text-xs text-gray-400">{date}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {review.effectivenessScore !== null && (
                <span className={`text-sm font-bold ${scoreColor(review.effectivenessScore)}`}>
                  {review.effectivenessScore}/10
                </span>
              )}
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
      })}
    </div>
  );
}
