"use client";

import { useState } from "react";

interface CUBSegment {
  text: string;
  type: "clean" | "confusing" | "unbelievable" | "boring";
  reason?: string;
}

interface Props {
  content: string;
}

const TYPE_STYLES: Record<string, string> = {
  clean: "",
  confusing: "bg-yellow-200 cursor-help",
  unbelievable: "bg-red-200 cursor-help",
  boring: "bg-gray-200 cursor-help",
};

const TYPE_LABELS: Record<string, string> = {
  confusing: "Confusing",
  unbelievable: "Unbelievable",
  boring: "Boring",
};

const TYPE_BADGE: Record<string, string> = {
  confusing: "bg-yellow-100 text-yellow-800 border-yellow-300",
  unbelievable: "bg-red-100 text-red-800 border-red-300",
  boring: "bg-gray-100 text-gray-700 border-gray-300",
};

function parseSegments(raw: string): CUBSegment[] | null {
  try {
    const jsonStart = raw.indexOf("[");
    const jsonEnd = raw.lastIndexOf("]") + 1;
    if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
    return JSON.parse(raw.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
}

export default function CUBViewer({ content }: Props) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const segments = parseSegments(content);

  if (!segments) {
    return <pre className="text-sm text-gray-700 whitespace-pre-wrap">{content}</pre>;
  }

  const counts = {
    confusing: segments.filter((s) => s.type === "confusing").length,
    unbelievable: segments.filter((s) => s.type === "unbelievable").length,
    boring: segments.filter((s) => s.type === "boring").length,
  };

  const filtered =
    activeFilter
      ? segments.map((s) => ({
          ...s,
          type: s.type === activeFilter ? s.type : ("clean" as const),
        }))
      : segments;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-gray-200">
        {(["confusing", "unbelievable", "boring"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setActiveFilter(activeFilter === type ? null : type)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
              activeFilter === type ? TYPE_BADGE[type] + " ring-2 ring-offset-1 ring-current" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            <span
              className={`w-3 h-3 rounded-sm inline-block ${
                type === "confusing" ? "bg-yellow-300" : type === "unbelievable" ? "bg-red-300" : "bg-gray-300"
              }`}
            />
            {TYPE_LABELS[type]}
            <span className="font-bold">{counts[type]}</span>
          </button>
        ))}
        {activeFilter && (
          <button
            onClick={() => setActiveFilter(null)}
            className="px-3 py-1.5 rounded-full border border-gray-300 text-sm text-gray-500 hover:border-gray-400"
          >
            Show all
          </button>
        )}
      </div>

      <div className="text-sm text-gray-800 leading-relaxed relative">
        {filtered.map((seg, i) => {
          const style = TYPE_STYLES[seg.type];
          if (!style) return <span key={i}>{seg.text} </span>;

          return (
            <span
              key={i}
              className={`${style} px-0.5 rounded relative`}
              onMouseEnter={(e) => {
                if (seg.reason) {
                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                  setTooltip({ text: `[${TYPE_LABELS[seg.type]}] ${seg.reason}`, x: rect.left, y: rect.bottom + 4 });
                }
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              {seg.text}{" "}
            </span>
          );
        })}

        {tooltip && (
          <div
            className="fixed z-50 max-w-xs bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  );
}
