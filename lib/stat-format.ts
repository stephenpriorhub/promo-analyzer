/**
 * Stat column typing + value normalization.
 *
 * Performance sheets carry three kinds of columns — rates (%), money ($), and
 * counts — but the raw cell values don't always carry their unit: percent
 * columns often arrive as raw ratios ("0.05354" meaning 5.354%) or in
 * scientific notation ("2.14E-04"). This module classifies a column from its
 * header and produces (a) a canonical NUMBER for ranking/tiering and (b) a
 * clean DISPLAY string with the right unit — so the same value reads
 * consistently in the UI and ranks correctly regardless of source formatting.
 */

export type StatType = "percent" | "currency" | "number" | "text";

// Order matters: percent patterns are checked before number patterns so
// "Click thru Rate" (a rate) isn't captured as a count by "click".
const PERCENT_RE = /(\bcr\b|cr%|\brate\b|conversion|\bctr\b|click.?thru|percent|%)/i;
const CURRENCY_RE = /(revenue|cart\s*value|\bvalue\b|\bprice\b|\bcost\b|\baov\b|\bepc\b|earnings|amount|spend|\brpm\b|\bcpa\b)/i;
const NUMBER_RE = /(views?|clicks?|orders?|count|sends?|opens?|leads?|units?|quantity|impressions?|sales\b)/i;

/** Classify a column by its header. */
export function classifyStatColumn(header: string): StatType {
  const h = header.toLowerCase();
  if (PERCENT_RE.test(h)) return "percent";
  if (CURRENCY_RE.test(h)) return "currency";
  if (NUMBER_RE.test(h)) return "number";
  return "text";
}

/** Parse "$1,234.56" / "3.2%" / "2.14E-04" / "1,204" → number. Null if non-numeric. */
export function toNumber(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[$,%\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Canonical numeric value for a stat, in a consistent scale for its type.
 * Percent values are normalized to PERCENTAGE POINTS: an explicit "%" is taken
 * as-is; a bare ratio below 1 is ×100 (0.05354 → 5.354); a bare value ≥ 1 is
 * assumed already in points (4.44 → 4.44). This reconciles ratio-scale and
 * point-scale cells in the same column so ranking is apples-to-apples.
 */
export function normalizedStatNumber(raw: string | number | undefined, type: StatType): number | null {
  const n = toNumber(raw);
  if (n == null) return null;
  if (type !== "percent") return n;
  const hasPercent = typeof raw === "string" && raw.includes("%");
  if (hasPercent) return n;
  return n < 1 ? n * 100 : n;
}

/** Clean display string with the right unit. Non-numeric values pass through unchanged. */
export function formatStatValue(raw: string | number | undefined, type: StatType): string {
  const n = toNumber(raw);
  if (n == null) return raw == null ? "" : String(raw);
  switch (type) {
    case "currency":
      return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "number":
      return Math.round(n).toLocaleString("en-US");
    case "percent": {
      const pct = normalizedStatNumber(raw, "percent") ?? n;
      return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    }
    default:
      return String(raw);
  }
}
