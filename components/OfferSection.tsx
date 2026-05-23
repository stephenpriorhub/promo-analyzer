"use client";

interface Props {
  content: string;
  stockTease: string;
  effectiveness: string;
}

function renderMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export default function OfferSection({ content, stockTease, effectiveness }: Props) {
  return (
    <div className="space-y-6">
      {content && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Offer Details</h3>
          <div className="space-y-2">
            {content.split("\n").filter((l) => l.trim()).map((line, i) => {
              const stripped = renderMarkdown(line.replace(/^[-•]\s*/, ""));
              const colonIdx = stripped.indexOf(":");
              if (colonIdx !== -1 && colonIdx < 40) {
                const label = stripped.slice(0, colonIdx).trim();
                const value = stripped.slice(colonIdx + 1).trim();
                return (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="font-semibold text-gray-600 w-40 shrink-0">{label}:</span>
                    <span className="text-gray-800">{value}</span>
                  </div>
                );
              }
              return (
                <p key={i} className="text-sm text-gray-700">{stripped}</p>
              );
            })}
          </div>
        </div>
      )}

      {stockTease && stockTease !== "NONE" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="font-semibold text-amber-800 mb-2 text-sm uppercase tracking-wide">Stock Tease Prediction</h3>
          <div className="space-y-1">
            {stockTease.split("\n").filter((l) => l.trim()).map((line, i) => (
              <p key={i} className="text-sm text-amber-900">
                {renderMarkdown(line.replace(/^[-•]\s*/, ""))}
              </p>
            ))}
          </div>
        </div>
      )}

      {effectiveness && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold text-slate-700 mb-2 text-sm uppercase tracking-wide">Effectiveness Rationale</h3>
          <div className="space-y-1">
            {effectiveness.split("\n").filter((l) => l.trim()).map((line, i) => (
              <p key={i} className="text-sm text-slate-700 leading-relaxed">
                {renderMarkdown(line)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
