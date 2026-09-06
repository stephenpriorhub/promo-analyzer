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
import { recordBrainWrite } from "./brain-health";

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
  knowledge: "Resources/Promo Analysis/Knowledge",
  "source-copy": "Resources/Promo Analysis/Source Copy",
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Contents API commits to the default branch; when two commits race the
 * branch ref GitHub rejects the loser with 409 "is at <X> but expected <Y>"
 * (also "does not match"). Every analysis fires several writes back-to-back
 * (note + intel + ledger) and bulk backfills fire many more, so this is the
 * dominant brain-write failure — not a dead token.
 */
/** Thrown by a `build` callback to abort a write that turned out to be a no-op. */
class SkipWrite extends Error {}

function isRefConflict(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("but expected") || m.includes("does not match") || m.includes("409");
}

/**
 * Serialize every Contents API write to the brain repo within this process so
 * the app's own bursts don't race each other. A separate backfill *script*
 * hitting the deployed API runs in this same process, so it shares the queue;
 * only writes from a different replica can still collide — the retry covers those.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * PUT a file, retrying on the branch-ref 409. `build` is re-invoked each attempt
 * with the file's *current* state, so callers that splice into existing content
 * (the ledger) re-splice against fresh data before retrying. Non-conflict errors
 * (dead token, missing markers) throw immediately without burning retries.
 */
async function githubPutWithRetry(
  relPath: string,
  build: (existing: { sha: string; content: string } | null) => { content: string; message: string },
  attempts = 5
): Promise<void> {
  let lastErr: unknown = new Error("GitHub write failed");
  for (let i = 0; i < attempts; i++) {
    const existing = await githubGetFile(relPath);
    const { content, message } = build(existing);
    try {
      await githubPutFile(relPath, content, message, existing?.sha);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRefConflict(err) || i === attempts - 1) throw err;
      await sleep(250 * (i + 1)); // linear backoff; next loop re-fetches the fresh sha
    }
  }
  throw lastErr;
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
      await serialize(() =>
        githubPutWithRetry(relPath, () => ({ content, message: `Add promo analysis: ${safeTitle}` }))
      );
      recordBrainWrite(true, `note:${safeTitle}`);
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
    recordBrainWrite(true, `note:${safeTitle}`);
    return { ok: true, path: filepath };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Write failed";
    console.warn(`[brain-writer] note write failed (${relPath}): ${error}`);
    recordBrainWrite(false, `note:${safeTitle}`, error);
    return { ok: false, error };
  }
}

/**
 * Insert a single line into an existing note, once. Used to hang the
 * `**Full Copy:** [[Promo Copy - X]]` link off an analysis note without
 * rewriting the analysis itself (which the analyzer regenerates only on
 * re-teach). Idempotent: a note that already carries the line is left alone.
 *
 * The line goes directly after the first line matching `afterRe`, else after
 * the H1, else at the top of the body. Missing notes are not an error — a
 * promo can be taught before its analysis note lands.
 */
export async function addLineToBrainNote(
  title: string,
  subfolder: string,
  line: string,
  afterRe: RegExp
): Promise<{ ok: boolean; added: boolean; error?: string }> {
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, "-").trim();
  if (!safeTitle) return { ok: false, added: false, error: "Invalid title" };
  const relPath = resolveRelPath(subfolder, safeTitle);

  const splice = (content: string): string | null => {
    if (content.includes(line.trim())) return null; // already linked
    const lines = content.split("\n");
    let at = lines.findIndex((l) => afterRe.test(l));
    if (at === -1) at = lines.findIndex((l) => l.startsWith("# "));
    if (at === -1) at = 0;
    lines.splice(at + 1, 0, line);
    return lines.join("\n");
  };

  try {
    if (process.env.GITHUB_TOKEN) {
      let added = false;
      await serialize(() =>
        githubPutWithRetry(relPath, (existing) => {
          if (!existing) throw new Error("note not found");
          const next = splice(existing.content);
          if (next === null) throw new SkipWrite();
          added = true;
          return { content: next, message: `Link source copy: ${safeTitle}` };
        })
      ).catch((e) => {
        if (e instanceof SkipWrite) return;
        throw e;
      });
      return { ok: true, added };
    }
    const filepath = path.join(BRAIN_VAULT_ROOT, relPath);
    if (!fs.existsSync(filepath)) return { ok: false, added: false, error: "note not found" };
    const next = splice(fs.readFileSync(filepath, "utf-8"));
    if (next === null) return { ok: true, added: false };
    fs.writeFileSync(filepath, next, "utf-8");
    return { ok: true, added: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "link write failed";
    console.warn(`[brain-writer] link insert failed (${relPath}): ${error}`);
    return { ok: false, added: false, error };
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
      // build re-splices against the *current* ledger on every retry, so a
      // racing append never clobbers rows another writer just added.
      await serialize(() =>
        githubPutWithRetry(LEDGER_REL_PATH, (existing) => {
          if (!existing) throw new Error("Performance Ledger.md not found in vault repo");
          const next = spliceRows(existing.content, rows);
          if (!next) throw new Error("Ledger splice markers missing");
          return { content: next, message: `Performance ledger: +${rows.length} row(s)` };
        })
      );
      recordBrainWrite(true, "performance-ledger");
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
    recordBrainWrite(false, "performance-ledger", error);
    return { ok: false, error };
  }
}
