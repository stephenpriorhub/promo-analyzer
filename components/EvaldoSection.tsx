"use client";

interface Props {
  content: string;
}

function strengthBadge(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("strong")) return { label: "Strong", cls: "bg-green-100 text-green-700 border-green-300" };
  if (lower.includes("missing")) return { label: "Missing", cls: "bg-red-100 text-red-700 border-red-300" };
  if (lower.includes("weak")) return { label: "Weak", cls: "bg-yellow-100 text-yellow-700 border-yellow-300" };
  if (lower.includes("present")) return { label: "Present", cls: "bg-blue-100 text-blue-700 border-blue-300" };
  return null;
}

function renderMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export default function EvaldoSection({ content }: Props) {
  if (!content) return null;

  const lines = content.split("\n").filter((l) => l.trim());

  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const stripped = renderMarkdown(line.replace(/^[-•]\s*/, ""));
        const badge = strengthBadge(stripped);

        if (badge && (stripped.startsWith("Q") || stripped.match(/^[0-9]+\./) || stripped.match(/^(Question|Close|How|What|Who|Why|Trust|Reveal|Introduce|Testimonial|False|Bonus|Value|Guarantee|Price)/i))) {
          return (
            <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-white border border-gray-200 shadow-sm">
              <span className={`shrink-0 px-2 py-0.5 rounded border text-xs font-semibold ${badge.cls}`}>
                {badge.label}
              </span>
              <p className="text-sm text-gray-700 leading-relaxed">{stripped.replace(/\*\*Strong\*\*|\*\*Missing\*\*|\*\*Weak\*\*|\*\*Present\*\*/gi, "").replace(/^—\s*/, "")}</p>
            </div>
          );
        }

        if (line.startsWith("##") || line.startsWith("**Q")) {
          return (
            <h3 key={i} className="font-semibold text-gray-800 mt-4 mb-1 text-sm uppercase tracking-wide text-blue-700">
              {stripped}
            </h3>
          );
        }

        return (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">
            {stripped}
          </p>
        );
      })}
    </div>
  );
}
