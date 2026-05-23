"use client";

interface Props {
  content: string;
}

export default function OutlineSection({ content }: Props) {
  if (!content) return null;

  const lines = content.split("\n").filter((l) => l.trim());
  let sectionIndex = 0;

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const stripped = line.replace(/^\*\*/, "").replace(/\*\*:?\s*/, ": ").replace(/^[-•]\s*/, "").replace(/\*\*/g, "");
        const isSection = /^[0-9]+[\.\)]\s/.test(line) || line.match(/^##?\s/) || (line.startsWith("**") && !line.startsWith("**-"));

        if (isSection) {
          sectionIndex++;
          const colonIdx = stripped.indexOf(":");
          const title = colonIdx !== -1 ? stripped.slice(0, colonIdx).trim() : stripped;
          const desc = colonIdx !== -1 ? stripped.slice(colonIdx + 1).trim() : "";
          return (
            <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
                {sectionIndex}
              </span>
              <div>
                <p className="font-semibold text-gray-800 text-sm">{title.replace(/^\d+[\.\)]\s*/, "")}</p>
                {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
              </div>
            </div>
          );
        }

        return (
          <p key={i} className="text-sm text-gray-600 pl-10">
            {stripped}
          </p>
        );
      })}
    </div>
  );
}
