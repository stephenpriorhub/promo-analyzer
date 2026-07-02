/**
 * Direct brain-vault writer — GitHub Contents API first (works on Railway),
 * local filesystem fallback. Extracted from /api/brain so server-side code
 * (the performance learning pipeline) can write notes in-process instead of
 * making fragile self-HTTP calls.
 *
 * Teaching the brain must NEVER break the product: every export here is
 * graceful — logs and returns a result, never throws.
 */

import fs from "fs";
import path from "path";

const BRAIN_DIR =
  process.env.BRAIN_DIR ??
  "/Users/stephenprior/github/brain/Resources/Promo Analysis/Promo Analysis Tool";

// Base of the vault repo (strip the Resources suffix) for writing to other areas
const BRAIN_VAULT_ROOT = BRAIN_DIR.replace(/\/Resources\/.*$/, "");

const BRAIN_GITHUB_REPO = process.env.BRAIN_GITHUB_REPO ?? "stephenpriorhub/brain";

// Known relative subfolders within the vault (validated allowlist — no arbitrary paths)
export const SUBFOLDER_MAP: Record<string, string> = {
  "promo-analysis-tool": "Resources/Promo Analysis/Promo Analysis Tool",
  "promo-intelligence": "Resources/Promo Analysis/Promo Intelligence",
  performance: "Resources/Promo Analysis/Performance",
};

function resolveRelPath(subfolder: string | undefined, safeTitle: string): string {
  const rel = SUBFOLDER_MAP[subfolder ?? "promo-analysis-tool"] ?? SUBFOLDER_MAP["promo-analysis-tool"];
  return `${rel}/${safeTitle}.md`;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "promo-analyzer",
    Accept: "application/vnd.github+json",
  };
}

async function githubGetFile(relPath: string): Promise<{ sha: string; content: string } | null> {
  const url = `https://api.github.com/repos/${BRAIN_GITHUB_REPO}/contents/${encodeURIComponent(relPath)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) return null;
  const json = (await res.json()) as { sha: string; content: string };
  return { sha: json.sha, content: Buffer.from(json.content, "base64").toString("utf-8") };
}

async function githubPutFile(relPath: string, content: string, message: string, sha?: string): Promise<void> {
  const url = `https://api.github.com/repos/${BRAIN_GITHUB_REPO}/contents/${encodeURIComponent(relPath)}`;
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: githubHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "GitHub write failed");
  }
}

/** Write (create or overwrite) a note in an allowlisted vault subfolder. */
export async function writeBrainNote(
  title: string,
  content: string,
  subfolder?: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, "-").trim();
  if (!safeTitle) return { ok: false, error: "Invalid title" };
  const relPath = resolveRelPath(subfolder, safeTitle);
  try {
    if (process.env.GITHUB_TOKEN) {
      const existing = await githubGetFile(relPath);
      await githubPutFile(relPath, content, `Add promo analysis: ${safeTitle}`, existing?.sha);
      return { ok: true, path: `github:${BRAIN_GITHUB_REPO}/${relPath}` };
    }
    // Local fallback
    const filepath = path.join(BRAIN_VAULT_ROOT, relPath);
    if (!filepath.startsWith(BRAIN_VAULT_ROOT + path.sep)) return { ok: false, error: "Invalid path" };
    if (!fs.existsSync(BRAIN_VAULT_ROOT)) {
      return { ok: false, error: "Brain vault not available. Set BRAIN_DIR env var or configure GITHUB_TOKEN." };
    }
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content, "utf-8");
    return { ok: true, path: filepath };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Write failed";
    console.warn(`[brain-writer] note write failed (${relPath}): ${error}`);
    return { ok: false, error };
  }
}

// ---- Performance Ledger append ------------------------------------------------

const LEDGER_REL_PATH = "Resources/Promo Analysis/Performance/Performance Ledger.md";
const LEDGER_START = "<!-- promo-analyzer-performance:start -->";
const LEDGER_END = "<!-- promo-analyzer-performance:end -->";

function spliceRows(content: string, rows: string[]): string | null {
  // Markers must be whole lines — the ledger's caution text quotes the marker
  // strings inline (in backticks), so a substring match would splice into prose.
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === LEDGER_START);
  const endIdx = lines.findIndex((l) => l.trim() === LEDGER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  // Re-teaching a promo replaces its row instead of duplicating it.
  const codeOf = (row: string) => row.split("|")[1]?.trim();
  const newCodes = new Set(rows.map(codeOf).filter(Boolean));
  const kept = lines.filter((l, i) => {
    if (i <= startIdx + 2 || i >= endIdx) return true; // markers + header + separator
    return !newCodes.has(codeOf(l) ?? "");
  });
  const keptEndIdx = kept.findIndex((l) => l.trim() === LEDGER_END);
  kept.splice(keptEndIdx, 0, ...rows);
  return kept.join("\n");
}

/**
 * Append markdown table rows to the Performance Ledger, inside the splice
 * markers Brain Master seeded. Rows are pre-rendered `| ... |` lines.
 */
export async function appendPerformanceLedgerRows(
  rows: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (rows.length === 0) return { ok: true };
  try {
    if (process.env.GITHUB_TOKEN) {
      const existing = await githubGetFile(LEDGER_REL_PATH);
      if (!existing) return { ok: false, error: "Performance Ledger.md not found in vault repo" };
      const next = spliceRows(existing.content, rows);
      if (!next) return { ok: false, error: "Ledger splice markers missing" };
      await githubPutFile(LEDGER_REL_PATH, next, `Performance ledger: +${rows.length} row(s)`, existing.sha);
      return { ok: true };
    }
    const filepath = path.join(BRAIN_VAULT_ROOT, LEDGER_REL_PATH);
    if (!fs.existsSync(filepath)) return { ok: false, error: "Performance Ledger.md not found locally" };
    const next = spliceRows(fs.readFileSync(filepath, "utf-8"), rows);
    if (!next) return { ok: false, error: "Ledger splice markers missing" };
    fs.writeFileSync(filepath, next, "utf-8");
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Ledger append failed";
    console.warn(`[brain-writer] ledger append failed: ${error}`);
    return { ok: false, error };
  }
}
