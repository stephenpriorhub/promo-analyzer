"use client";

interface CUBSegment {
  text: string;
  type: "clean" | "confusing" | "unbelievable" | "boring";
  reason?: string;
}

interface Props {
  content: string;
}

const TYPE_LABELS: Record<string, string> = {
  confusing: "Confusing",
  unbelievable: "Unbelievable",
  boring: "Boring",
};

const TYPE_BADGE: Record<string, string> = {
  confusing: "bg-yellow-100 text-yellow-900 border-yellow-300",
  unbelievable: "bg-red-100 text-red-900 border-red-300",
  boring: "bg-gray-100 text-gray-700 border-gray-300",
};

const TYPE_ROW_BG: Record<string, string> = {
  confusing: "bg-yellow-50 border-yellow-200",
  unbelievable: "bg-red-50 border-red-200",
  boring: "bg-gray-50 border-gray-200",
};

const TYPE_LABEL_COLOR: Record<string, string> = {
  confusing: "#92400e",
  unbelievable: "#7f1d1d",
  boring: "#374151",
};

const TYPE_SWATCH: Record<string, string> = {
  confusing: "bg-yellow-300",
  unbelievable: "bg-red-400",
  boring: "bg-gray-300",
};

function parseSegments(raw: string): CUBSegment[] | null {
  try {
    const cleaned = raw.replace(/```(?:json)?/g, "").trim();
    const jsonStart = cleaned.indexOf("[");
    const jsonEnd = cleaned.lastIndexOf("]") + 1;
    if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd));
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function CUBViewer({ content }: Props) {
  const segments = parseSegments(content);

  if (!segments) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        <p className="font-medium mb-1">CUB review could not be rendered</p>
        <p className="text-xs text-yellow-700 mb-2">
          The response format was unexpected. Download the Word export to view the raw output.
        </p>
        <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-48 bg-white rounded p-2 border border-yellow-100">
          {content.slice(0, 1000)}{content.length > 1000 ? "…" : ""}
        </pre>
      </div>
    );
  }

  const flagged = segments.filter((s) => s.type !== "clean");
  const counts = {
    confusing: segments.filter((s) => s.type === "confusing").length,
    unbelievable: segments.filter((s) => s.type === "unbelievable").length,
    boring: segments.filter((s) => s.type === "boring").length,
  };
  const total = counts.confusing + counts.unbelievable + counts.boring;

  return (
    <div>
      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-2 mb-5 pb-4 border-b border-gray-200">
        {(["confusing", "unbelievable", "boring"] as const).map((type) => (
          <span
            key={type}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${TYPE_BADGE[type]}`}
          >
            <span className={`w-2.5 h-2.5 rounded-sm ${TYPE_SWATCH[type]}`} />
            {TYPE_LABELS[type]}: {counts[type]}
          </span>
        ))}
        <span className="text-xs text-gray-400 ml-1">{total} flag{total !== 1 ? "s" : ""} total</span>
        <span className="ml-auto text-xs text-gray-400 italic">
          ⬇ Export Word for full annotated copy
        </span>
      </div>

      {/* Flagged items grouped by type */}
      {total === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">
          ✓ No flags — copy looks clean for this audience.
        </p>
      ) : (
        <div className="space-y-6">
          {(["confusing", "unbelievable", "boring"] as const).map((type) => {
            const items = flagged.filter((s) => s.type === type);
            if (items.length === 0) return null;
            return (
              <section key={type}>
                <h3
                  className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2"
                  style={{ color: TYPE_LABEL_COLOR[type] }}
                >
                  <span className={`w-3 h-3 rounded-sm ${TYPE_SWATCH[type]}`} />
                  {TYPE_LABELS[type]} &mdash; {items.length}
                </h3>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-4 py-3 ${TYPE_ROW_BG[type]}`}
                    >
                      <p className="text-sm text-gray-800 leading-relaxed mb-1">
                        &ldquo;{item.text}&rdquo;
                      </p>
                      {item.reason && (
                        <p className="text-xs text-gray-500 italic">{item.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
