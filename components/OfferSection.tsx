"use client";

import type { SubScore } from "@/lib/score";
import { deriveScore } from "@/lib/score";

interface Props {
  content: string;
  stockTease: string;
  effectiveness: string;
  calibratedEffectiveness?: string | null;
  subScores?: SubScore[] | null;
  finalScore?: number | null;
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
  subScores,
  finalScore: finalScoreProp,
}: {
  effectiveness: string;
  calibratedEffectiveness: string | null;
  subScores?: SubScore[] | null;
  finalScore?: number | null;
}) {
  const isCalibrated = !!(calibratedEffectiveness && calibratedEffectiveness.trim());
  const activeContent = renderMarkdown(calibratedEffectiveness ?? effectiveness);

  // When a re-evaluation (calibrated) is present, derive BOTH the dimensions and
  // the headline FROM the calibrated breakdown so they stay coherent — never mix
  // re-evaluated headline with original sub-scores. Otherwise prefer the persisted
  // (code-derived) sub-scores from the original analysis.
  const scoreMatch =
    activeContent.match(/Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i) ??
    activeContent.match(/(\d+(?:\.\d+)?)\s*\/\s*10\s*$/);

  let dimensions: { label: string; score: number; rationale: string }[];
  let finalScore: number | null;
  if (isCalibrated) {
    const d = deriveScore(calibratedEffectiveness!);
    dimensions =
      d.subScores.length > 0
        ? d.subScores.map((s) => ({ label: s.dimension, score: s.score, rationale: s.rationale }))
        : extractDimensions(activeContent);
    finalScore = d.finalScore ?? (scoreMatch ? parseFloat(scoreMatch[1]) : null);
  } else {
    dimensions =
      subScores && subScores.length > 0
        ? subScores.map((s) => ({ label: s.dimension, score: s.score, rationale: s.rationale }))
        : extractDimensions(activeContent);
    finalScore =
      finalScoreProp != null ? finalScoreProp : scoreMatch ? parseFloat(scoreMatch[1]) : null;
  }

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
          Copy Quality Score
        </h3>
        {finalScore !== null && (
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: dimensionColor(finalScore).text }}
          >
            {finalScore.toFixed(1)}/10
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

// The known offer fields the prompt asks for, in display order. Used to decide
// what counts as a real field header vs. a sub-bullet of a multi-value field.
const KNOWN_FIELDS = [
  "Big Idea",
  "Publisher",
  "Product name",
  "What it is",
  "Price",
  "Payment options",
  "Premiums",
  "Guarantee",
  "Urgency",
];

// Match a label to a known field. Strips a trailing parenthetical (so "Price(s)"
// and "Payment options (annual, etc.)" still match) and requires an exact match
// first to avoid false positives from bonus/premium titles that merely start
// with a field word. "Bonuses" is mapped to the renamed "Premiums".
function matchKnownField(rawLabel: string): string | null {
  const cleaned = rawLabel.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  if (!cleaned) return null;
  for (const f of KNOWN_FIELDS) {
    if (cleaned === f.toLowerCase()) return f;
  }
  if (cleaned === "bonuses" || cleaned === "premiums") return "Premiums";
  if (cleaned.startsWith("price")) return "Price";
  if (cleaned.startsWith("payment")) return "Payment options";
  if (cleaned.includes("urgency") || cleaned.includes("scarcity")) return "Urgency";
  if (cleaned.startsWith("product")) return "Product name";
  if (cleaned === "what it is") return "What it is";
  return null;
}

interface OfferField {
  label: string;
  value: string;      // inline value ("" for header-only multi-value fields)
  bullets: string[];  // sub-bullets grouped beneath (e.g. each bonus title)
}

/**
 * Parse the offer copy into clean labeled fields. A line that begins a known
 * field starts a new field; subsequent bullet lines that are NOT themselves a
 * known field are attached as sub-bullets of the current field (this is how
 * multi-value fields like Bonuses render as a header followed by their list,
 * instead of each bullet being misclassified as its own header).
 */
function parseOfferFields(content: string): { bigIdea: string; fields: OfferField[] } {
  const lines = content.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  let bigIdea = "";
  const fields: OfferField[] = [];
  let current: OfferField | null = null;

  for (const line of lines) {
    // Detect a known-field header directly (don't use parseLine here — it rejects
    // header-only fields like "Bonuses:" and parenthetical labels like "Price(s)").
    const hdr = renderMarkdown(line.replace(/^\s*[-•*]\s*/, ""));
    const colonIdx = hdr.indexOf(":");
    let known: string | null = null;
    let inlineValue = "";
    if (colonIdx !== -1 && colonIdx <= 45) {
      known = matchKnownField(hdr.slice(0, colonIdx));
      inlineValue = hdr.slice(colonIdx + 1).trim();
    }

    if (known) {
      if (known === "Big Idea") {
        bigIdea = inlineValue;
        current = null;
        continue;
      }
      current = { label: known, value: inlineValue, bullets: [] };
      fields.push(current);
      continue;
    }

    // Not a known-field header. If it's a bullet under an open field, group it.
    const isBullet = /^\s*[-•*]\s+/.test(line);
    const text = renderMarkdown(line.replace(/^\s*[-•*]\s*/, "")).trim();
    if (!text) continue;
    if (current && (isBullet || current.value === "")) {
      current.bullets.push(text);
    } else if (current && current.value) {
      // continuation of a single-value field's text
      current.value = `${current.value} ${text}`.trim();
    }
    // orphan line with no current field — ignore (avoids inventing headers)
  }

  return { bigIdea, fields };
}

export default function OfferSection({ content, stockTease, effectiveness, calibratedEffectiveness, subScores, finalScore }: Props) {

  const parsed = parseOfferFields(content);
  const bigIdea = parsed.bigIdea;
  // Publisher and Product are now editable in the PromoMetadata block above, so
  // drop them from the read-only parsed display to avoid duplication.
  const fields = parsed.fields.filter(
    (f) => f.label !== "Publisher" && f.label !== "Product name"
  );

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
      {fields.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
            Offer Details
          </h3>
          <div className="space-y-3">
            {fields.map((field, i) =>
              field.bullets.length > 0 ? (
                // Multi-value field: label header followed by its bullet list beneath
                <div key={i} className="text-sm">
                  <p className="font-semibold text-gray-600 mb-1">{field.label}:</p>
                  {field.value && <p className="text-gray-800 mb-1 ml-1">{field.value}</p>}
                  <ul className="list-disc list-inside space-y-0.5 ml-2 text-gray-800">
                    {field.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                // Single-value labeled field
                <div key={i} className="flex gap-2 text-sm">
                  <span className="font-semibold text-gray-600 w-40 shrink-0">
                    {field.label}:
                  </span>
                  <span className="text-gray-800">{field.value || "—"}</span>
                </div>
              )
            )}
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
          subScores={subScores ?? null}
          finalScore={finalScore ?? null}
        />
      )}
    </div>
  );
}
