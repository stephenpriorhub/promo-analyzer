"use client";

interface Props {
  content: string;
}

const U_LABELS = ["Urgent", "Unique", "Ultra-specific", "Useful"] as const;

function getUStatus(line: string): "present" | "weak" | "absent" | null {
  const lower = line.toLowerCase();
  if (lower.includes("present")) return "present";
  if (lower.includes("weak")) return "weak";
  if (lower.includes("absent")) return "absent";
  return null;
}

function uBadge(status: "present" | "weak" | "absent") {
  const styles = {
    present: "bg-green-100 text-green-700 border-green-300",
    weak: "bg-yellow-100 text-yellow-700 border-yellow-300",
    absent: "bg-gray-100 text-gray-500 border-gray-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-semibold uppercase tracking-wide ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function HeadlineSection({ content }: Props) {
  if (!content) return null;

  const lines = content.split("\n").filter((l) => l.trim());

  return (
    <div className="space-y-4">
      {lines.map((line, i) => {
        const stripped = line.replace(/^\*\*/, "").replace(/\*\*/, "");
        const isU = U_LABELS.some((u) => stripped.startsWith(u));

        if (isU) {
          const status = getUStatus(stripped);
          const colonIdx = stripped.indexOf(":");
          const label = stripped.slice(0, colonIdx).trim();
          const explanation = colonIdx !== -1 ? stripped.slice(colonIdx + 1).trim() : "";

          return (
            <div key={i} className="flex items-start gap-3">
              <div className="w-32 shrink-0">
                <span className="font-semibold text-gray-700">{label}</span>
              </div>
              {status && uBadge(status)}
              {explanation && (
                <p className="text-sm text-gray-600 flex-1">{explanation.replace(/^\[.*?\]\s*—?\s*/, "")}</p>
              )}
            </div>
          );
        }

        if (stripped.startsWith("**Eyebrow") || stripped.startsWith("**Main Headline") || stripped.startsWith("**Subheadline")) {
          const colonIdx = stripped.indexOf("**:", 2);
          const label = stripped.slice(2, colonIdx !== -1 ? colonIdx : undefined).trim();
          const value = colonIdx !== -1 ? stripped.slice(colonIdx + 3).trim() : "";
          return (
            <div key={i} className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
              {value && <p className="mt-1 text-gray-800 font-medium">{value}</p>}
            </div>
          );
        }

        return (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">
            {stripped.replace(/\*\*/g, "")}
          </p>
        );
      })}
    </div>
  );
}
