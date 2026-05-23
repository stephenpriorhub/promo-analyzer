"use client";

import type { FKScore } from "@/lib/fk-score";

interface Props {
  fkScore: FKScore | null;
  effectivenessScore: number | null;
}

function scoreColor(score: number): string {
  if (score >= 8) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 6) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-800 border-red-300";
}

export default function ScoreBadges({ fkScore, effectivenessScore }: Props) {
  if (!fkScore && effectivenessScore === null) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      {fkScore && (
        <>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-blue-50 border-blue-200 text-blue-800">
            <span className="text-sm font-medium">FK Reading Ease</span>
            <span className="font-bold text-lg">{fkScore.readingEase}</span>
            <span className="text-xs text-blue-600">({fkScore.label})</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-blue-50 border-blue-200 text-blue-800">
            <span className="text-sm font-medium">Grade Level</span>
            <span className="font-bold text-lg">{fkScore.gradeLevel}</span>
          </div>
        </>
      )}
      {effectivenessScore !== null && (
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium ${scoreColor(effectivenessScore)}`}
        >
          <span className="text-sm">Effectiveness</span>
          <span className="font-bold text-lg">{effectivenessScore}/10</span>
        </div>
      )}
    </div>
  );
}
