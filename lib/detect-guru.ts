/**
 * Guru name detection from free text.
 *
 * Matches full display names as whole words (case-insensitive, flexible
 * whitespace) plus a small allow-list of distinctive surnames/nicknames that
 * are safe alone. Never matches bare first names or dictionary-word surnames
 * (Bear, Johnson, Matt, Chris, Nate, …) — those false-positive on ordinary
 * English ("bear market", "Christmas", "it doesn't matter").
 *
 * When several gurus match, pick the one with the most non-overlapping hits;
 * break ties by earliest position in the text.
 */

/** Distinctive surnames/nicknames safe to match alone (not common words). */
export const GURU_ALIASES: Record<string, string> = {
  McCall: "Matt McCall",
  Bottarelli: "Bryan Bottarelli",
  Rahemtulla: "Karim Rahemtulla",
};

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive pattern; flexible whitespace between tokens. */
export function wordBoundaryPattern(phrase: string): RegExp {
  const inner = phrase
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  return new RegExp(`\\b${inner}\\b`, "gi");
}

type Range = { start: number; end: number };

function findRanges(text: string, phrase: string): Range[] {
  const re = wordBoundaryPattern(phrase);
  const ranges: Range[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return ranges;
}

/** Prefer longer spans; drop overlaps so "Matt McCall" isn't also counted as "McCall". */
function nonOverlapping(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start)
  );
  const kept: Range[] = [];
  for (const r of sorted) {
    if (kept.some((k) => r.start < k.end && r.end > k.start)) continue;
    kept.push(r);
  }
  return kept;
}

/**
 * Detect which guru (from `guruNames`) is mentioned in `text`.
 * `aliases` maps alias → canonical guru display name (must be in guruNames).
 */
export function detectGuruInText(
  text: string,
  guruNames: readonly string[],
  aliases: Record<string, string> = GURU_ALIASES
): string | null {
  if (!text) return null;

  const nameSet = new Set(guruNames);
  type Score = { guru: string; count: number; firstIndex: number };
  const scores = new Map<string, Score>();

  for (const guru of guruNames) {
    const ranges = findRanges(text, guru);
    for (const [alias, target] of Object.entries(aliases)) {
      if (target === guru && nameSet.has(target)) {
        ranges.push(...findRanges(text, alias));
      }
    }
    const hits = nonOverlapping(ranges);
    if (hits.length === 0) continue;
    const firstIndex = Math.min(...hits.map((h) => h.start));
    scores.set(guru, { guru, count: hits.length, firstIndex });
  }

  if (scores.size === 0) return null;

  return [...scores.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.firstIndex - b.firstIndex;
  })[0].guru;
}
