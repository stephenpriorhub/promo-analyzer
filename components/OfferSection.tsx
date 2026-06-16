"use client";

interface Props {
  content: string;
  stockTease: string;
  effectiveness: string;
  calibratedEffectiveness?: string | null;
}

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")  // strip **bold**
    .replace(/\*([^*]+)\*/g, "$1");      // strip *italic*
}

function parseLine(line: string): { label: string; value: string } | null {
  const stripped = renderMarkdown(line.replace(/^[-•]\s*/, ""));
  const colonIdx = stripped.indexOf(":");
  if (colonIdx !== -1 && colonIdx < 40) {
    const value = stripped.slice(colonIdx + 1).trim();
    if (!value) return null; // No value — render as plain text
    const label = stripped.slice(0, colonIdx).trim();
    // Don't treat as key:value if the "label" contains parentheses (e.g. "Free SpaceX IPO play (ticker")
    if (label.includes("(") || label.includes(")")) return null;
    return { label, value };
  }
  return null;
}

// Global pattern to pull dimensions out of a continuous paragraph where the
// model emitted them inline with no line breaks: "1. Hook Strength: 8/10 — ... 2. Believability: 7/10 — ..."
// Lookahead stops each rationale at the next "N. " marker, the final "Score:", or end of string.
const DIMENSION_GLOBAL_RE =
  /(\d+)\.\s+([^:]+?):\s*(\d+(?:\.\d+)?)\s*\/\s*10\s*[—–-]\s*(.+?)(?=\s+\d+\.\s+[^:]+?:\s*\d|\s*[-–—]{1,3}\s*Score:|\s*Score:|$)/gis;

/**
 * Robustly extract the 8 dimensions whether the model emitted them on
 * separate lines or as one running paragraph.
 */
function extractDimensions(text: string): { label: string; score: number; rationale: string }[] {
  const cleaned = renderMarkdown(text);
  const dims: { label: string; score: number; rationale: string }[] = [];
  let m: RegExpExecArray | null;
  DIMENSION_GLOBAL_RE.lastIndex = 0;
  while ((m = DIMENSION_GLOBAL_RE.exec(cleaned)) !== null) {
    dims.push({
      label: m[2].trim(),
      score: parseFloat(m[3]),
      rationale: m[4].trim().replace(/\s+/g, " "),
    });
  }
  return dims;
}

function dimensionColor(score: number): { bar: string; text: string } {
  if (score >= 8) return { bar: "#22c55e", text: "#166534" };
  if (score >= 6) return { bar: "#eab308", text: "#854d0e" };
  return { bar: "#ef4444", text: "#991b1b" };
}

function EffectivenessBlock({
  effectiveness,
  calibratedEffectiveness,
}: {
  effectiveness: string;
  calibratedEffectiveness: string | null;
}) {
  const activeContent = renderMarkdown(calibratedEffectiveness ?? effectiveness);

  // Extract dimensions robustly — handles both line-separated and run-on paragraph formats
  const dimensions = extractDimensions(activeContent);

  // Final score: the "Score: X/10" marker, or the last standalone "X/10" if absent
  const scoreMatch =
    activeContent.match(/Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i) ??
    activeContent.match(/(\d+(?:\.\d+)?)\s*\/\s*10\s*$/);
  const finalScore = scoreMatch ? parseFloat(scoreMatch[1]) : null;

  // Rationale: everything after "Rationale:" if present, else the tail after the dimensions
  let rationale = "";
  const rationaleMatch = activeContent.match(/Rationale:\s*([\s\S]+)$/i);
  if (rationaleMatch) {
    rationale = rationaleMatch[1].trim().replace(/\s+/g, " ");
  } else if (dimensions.length === 0) {
    // No dimensions and no explicit rationale — show the whole thing minus the score line
    rationale = activeContent.replace(/Score:\s*\d+(?:\.\d+)?\s*\/\s*10/i, "").trim();
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">
          Conversion Prediction
        </h3>
        {finalScore !== null && (
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: dimensionColor(finalScore).text }}
          >
            {finalScore}/10
          </span>
        )}
      </div>

      {dimensions.length > 0 && (
        <div className="space-y-2">
          {dimensions.map((d, i) => {
            const { bar, text } = dimensionColor(d.score);
            return (
              <div key={i}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-semibold text-slate-600">{d.label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: text }}>
                    {d.score}/10
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mb-1">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(d.score / 10) * 100}%`, background: bar }}
                  />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{d.rationale}</p>
              </div>
            );
          })}
        </div>
      )}

      {rationale && (
        <p className="text-sm text-slate-700 leading-relaxed border-t border-slate-200 pt-3">
          {rationale}
        </p>
      )}

      {calibratedEffectiveness && (
        <p className="text-xs text-slate-400 border-t border-slate-200 pt-2">
          Score updated with publisher training data
        </p>
      )}
    </div>
  );
}

export default function OfferSection({ content, stockTease, effectiveness, calibratedEffectiveness }: Props) {

  // Split offer content and extract the Big Idea line
  const lines = content.split("\n").filter((l) => l.trim());
  let bigIdea = "";
  const offerLines: string[] = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed && parsed.label.toLowerCase() === "big idea") {
      bigIdea = parsed.value;
    } else {
      offerLines.push(line);
    }
  }

  return (
    <div className="space-y-6">
      {/* Big Idea callout */}
      {bigIdea && (
        <div
          className="rounded-lg px-5 py-4 border"
          style={{ background: NAVY_BG, borderColor: NAVY_BORDER }}
        >
          <p className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: NAVY }}>
            Big Idea
          </p>
          <p className="text-base text-gray-800 leading-relaxed">{bigIdea}</p>
        </div>
      )}


      {/* Offer details */}
      {offerLines.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
            Offer Details
          </h3>
          <div className="space-y-2">
            {offerLines.map((line, i) => {
              const parsed = parseLine(line);
              if (parsed) {
                return (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="font-semibold text-gray-600 w-40 shrink-0">
                      {parsed.label}:
                    </span>
                    <span className="text-gray-800">{parsed.value}</span>
                  </div>
                );
              }
              return (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="w-40 shrink-0" />
                  <span className="text-gray-800">
                    {renderMarkdown(line.replace(/^[-•*]\s*/, ""))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stock Tease */}
      {stockTease && stockTease !== "NONE" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="font-semibold text-amber-800 mb-2 text-sm uppercase tracking-wide">
            Stock Tease Prediction
          </h3>
          <div className="space-y-1">
            {stockTease
              .split("\n")
              .filter((l) => l.trim())
              .map((line, i) => (
                <p key={i} className="text-sm text-amber-900">
                  {renderMarkdown(line.replace(/^[-•]\s*/, ""))}
                </p>
              ))}
          </div>
        </div>
      )}
      {/* Effectiveness — conversion prediction score */}
      {effectiveness && (
        <EffectivenessBlock
          effectiveness={effectiveness}
          calibratedEffectiveness={calibratedEffectiveness ?? null}
        />
      )}
    </div>
  );
}
