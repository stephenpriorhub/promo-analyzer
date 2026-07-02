/**
 * Performance dataset — persistent store of real-world promo results keyed by
 * creative (promo) code.
 *
 * Sources:
 *   - CSV upload (an export of the Agora performance sheet)
 *   - Full Google Sheet sync (reuses the promo-stats service-account reader)
 *
 * Raw stat columns are kept verbatim (header → string value), exactly like
 * lib/promo-stats.ts. Enrichment fields (publication, guru, promoType, notes,
 * tier override) are Stephen's — a re-import NEVER clobbers them; it only
 * refreshes `stats`.
 *
 * These records are the real-outcome half of the (copy-features, real-outcome)
 * training pairs. Tier derivation lives in lib/performance-tier.ts; the
 * learning pipeline lives in /api/performance/learn.
 */

import fs from "fs";
import path from "path";
import { normalizeCode } from "./promo-stats";
import type { PerformanceTier } from "./learning-kb";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const PERF_FILE = path.join(DATA_DIR, "performance.json");

export interface PerformanceRecord {
  /** Creative code as authored in the sheet (display). Key is normalizeCode(promoCode). */
  promoCode: string;
  /** Raw sheet columns, header → cell value (strings as-authored). */
  stats: Record<string, string>;
  // ---- enrichment (user-owned; never overwritten by re-import) ----
  /** Agora publication this promo ran for (canonical directory name). */
  publication: string | null;
  guru: string | null;
  promoType: string | null;
  notes: string;
  /** Manual tier override — when set, wins over the derived tier. */
  tierOverride: PerformanceTier | null;
  /** Preferred stat column for tiering — when set, wins over auto-detection. */
  primaryMetricOverride: string | null;
  // ---- bookkeeping ----
  source: "csv" | "sheet";
  importedAt: string;
  updatedAt: string;
  /** ISO timestamp of the last time this record fed the learning pipeline. */
  learnedAt: string | null;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): Record<string, PerformanceRecord> {
  ensureDataDir();
  if (!fs.existsSync(PERF_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PERF_FILE, "utf-8")) as Record<string, PerformanceRecord>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, PerformanceRecord>) {
  ensureDataDir();
  fs.writeFileSync(PERF_FILE, JSON.stringify(map, null, 2), "utf-8");
}

export function getAllPerformanceRecords(): PerformanceRecord[] {
  return Object.values(readAll()).sort((a, b) => a.promoCode.localeCompare(b.promoCode));
}

export function getPerformanceRecord(code: string): PerformanceRecord | null {
  return readAll()[normalizeCode(code)] ?? null;
}

/**
 * Upsert imported rows. New codes create records; existing codes get their
 * `stats` refreshed (imports are the source of truth for raw numbers) while
 * every enrichment field is preserved.
 */
export function upsertPerformanceRecords(
  rows: Array<{ promoCode: string; stats: Record<string, string> }>,
  source: "csv" | "sheet"
): { added: number; updated: number } {
  const map = readAll();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  // Agora exports often carry Publication/Guru columns — seed enrichment from
  // them when the field is still empty (never overwrite a user-entered value).
  const seedFrom = (stats: Record<string, string>, patterns: RegExp): string | null => {
    const hit = Object.keys(stats).find((h) =>
      patterns.test(h.trim().toLowerCase().replace(/[\s_]+/g, ""))
    );
    return hit ? stats[hit].trim() || null : null;
  };
  for (const row of rows) {
    const key = normalizeCode(row.promoCode);
    if (!key) continue;
    const existing = map[key];
    if (existing) {
      existing.stats = row.stats;
      existing.source = source;
      existing.updatedAt = now;
      if (!existing.publication) existing.publication = seedFrom(row.stats, /^(publication|pub|newsletter)$/);
      if (!existing.guru) existing.guru = seedFrom(row.stats, /^(guru|editor)$/);
      updated++;
    } else {
      map[key] = {
        promoCode: row.promoCode.trim(),
        stats: row.stats,
        publication: seedFrom(row.stats, /^(publication|pub|newsletter)$/),
        guru: seedFrom(row.stats, /^(guru|editor)$/),
        promoType: null,
        notes: "",
        tierOverride: null,
        primaryMetricOverride: null,
        source,
        importedAt: now,
        updatedAt: now,
        learnedAt: null,
      };
      added++;
    }
  }
  writeAll(map);
  return { added, updated };
}

export interface PerformanceEnrichment {
  publication?: string | null;
  guru?: string | null;
  promoType?: string | null;
  notes?: string;
  tierOverride?: PerformanceTier | null;
  primaryMetricOverride?: string | null;
}

export function updatePerformanceRecord(code: string, patch: PerformanceEnrichment): PerformanceRecord | null {
  const map = readAll();
  const rec = map[normalizeCode(code)];
  if (!rec) return null;
  if (patch.publication !== undefined) rec.publication = patch.publication?.trim() || null;
  if (patch.guru !== undefined) rec.guru = patch.guru?.trim() || null;
  if (patch.promoType !== undefined) rec.promoType = patch.promoType?.trim() || null;
  if (patch.notes !== undefined) rec.notes = patch.notes.trim();
  if (patch.tierOverride !== undefined) rec.tierOverride = patch.tierOverride;
  if (patch.primaryMetricOverride !== undefined)
    rec.primaryMetricOverride = patch.primaryMetricOverride?.trim() || null;
  rec.updatedAt = new Date().toISOString();
  writeAll(map);
  return rec;
}

export function markPerformanceLearned(codes: string[]): void {
  const map = readAll();
  const now = new Date().toISOString();
  for (const code of codes) {
    const rec = map[normalizeCode(code)];
    if (rec) rec.learnedAt = now;
  }
  writeAll(map);
}

export function deletePerformanceRecord(code: string): boolean {
  const map = readAll();
  const key = normalizeCode(code);
  if (!map[key]) return false;
  delete map[key];
  writeAll(map);
  return true;
}

// ---- CSV parsing --------------------------------------------------------------

/** Header patterns accepted as the creative-code key column, in priority order. */
const CODE_HEADERS = ["creativecode", "promocode", "creative", "code", "promo"];

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, "");
}

export function findCodeColumn(headers: string[]): number {
  for (const wanted of CODE_HEADERS) {
    const idx = headers.findIndex((h) => normHeader(h) === wanted);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** RFC-4180-ish CSV parse: quoted fields, escaped quotes, CR/LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully-empty trailing rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Parse a performance CSV into upsert-ready rows. The first row must be
 * headers and must include a creative-code column.
 */
export function parsePerformanceCsv(
  text: string
): { rows: Array<{ promoCode: string; stats: Record<string, string> }>; error?: string } {
  const parsed = parseCsv(text);
  if (parsed.length < 2) return { rows: [], error: "CSV needs a header row and at least one data row" };
  const headers = parsed[0].map((h) => h.trim());
  const codeIdx = findCodeColumn(headers);
  if (codeIdx === -1) {
    return {
      rows: [],
      error: `No creative-code column found. Expected a header like "Creative Code" or "Promo Code" — got: ${headers.join(", ")}`,
    };
  }
  const rows: Array<{ promoCode: string; stats: Record<string, string> }> = [];
  for (const cells of parsed.slice(1)) {
    const rawCode = (cells[codeIdx] ?? "").trim();
    if (!rawCode) continue;
    const stats: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (i === codeIdx || !h) return;
      const val = (cells[i] ?? "").trim();
      if (val) stats[h] = val;
    });
    rows.push({ promoCode: rawCode, stats });
  }
  return { rows };
}
