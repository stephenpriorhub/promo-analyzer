"use client";

import type { FKScore } from "@/lib/fk-score";

interface Props {
  fkScore: FKScore | null;
  effectivenessScore: number | null;
}

function effectivenessStyle(score: number) {
  if (score >= 8) return { background: "#dcfce7", borderColor: "#86efac", color: "#166534" };
  if (score >= 6) return { background: "#fef9c3", borderColor: "#fde047", color: "#854d0e" };
  return { background: "#fee2e2", borderColor: "#fca5a5", color: "#991b1b" };
}

export default function ScoreBadges({ fkScore, effectivenessScore }: Props) {
  if (!fkScore && effectivenessScore === null) return null;

  const navyBadge = { background: "#f0f4fc", borderColor: "#c8d5f0", color: "#012479" };

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      {fkScore && (
        <>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border" style={navyBadge}>
            <span className="text-sm font-medium">FK Reading Ease</span>
            <span className="font-bold text-lg">{fkScore.readingEase}</span>
            {fkScore.label && <span className="text-xs opacity-70">({fkScore.label})</span>}
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border" style={navyBadge}>
            <span className="text-sm font-medium">Grade Level</span>
            <span className="font-bold text-lg">{fkScore.gradeLevel}</span>
          </div>
        </>
      )}
      {effectivenessScore !== null && (
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-lg border font-medium"
          style={effectivenessStyle(effectivenessScore)}
        >
          <span className="text-sm">Effectiveness</span>
          <span className="font-bold text-lg">{effectivenessScore}/10</span>
        </div>
      )}
    </div>
  );
}
