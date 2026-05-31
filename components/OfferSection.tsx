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
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

function parseLine(line: string): { label: string; value: string } | null {
  const stripped = renderMarkdown(line.replace(/^[-•]\s*/, ""));
  const colonIdx = stripped.indexOf(":");
  if (colonIdx !== -1 && colonIdx < 40) {
    return { label: stripped.slice(0, colonIdx).trim(), value: stripped.slice(colonIdx + 1).trim() };
  }
  return null;
}

export default function OfferSection({ content, stockTease, effectiveness, calibratedEffectiveness }: Props) {
  // The active effectiveness is calibrated if applied, otherwise original
  const activeEffectiveness = calibratedEffectiveness || effectiveness;

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

      {/* Effectiveness — shown right after Big Idea */}
      {activeEffectiveness && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold text-slate-700 mb-2 text-sm uppercase tracking-wide">
            Effectiveness Rationale
          </h3>
          <div className="space-y-1">
            {activeEffectiveness
              .split("\n")
              .filter((l) => l.trim())
              .map((line, i) => (
                <p key={i} className="text-sm text-slate-700 leading-relaxed">
                  {renderMarkdown(line)}
                </p>
              ))}
          </div>
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
                <p key={i} className="text-sm text-gray-700">
                  {renderMarkdown(line.replace(/^[-•]\s*/, ""))}
                </p>
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
    </div>
  );
}
