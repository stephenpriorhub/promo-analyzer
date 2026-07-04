/**
 * Brain-write health — the watchdog for app→vault writes.
 *
 * Every brain write (notes, performance ledger, pattern ledger) reports its
 * outcome here; the health endpoint combines the recorded outcomes with a live
 * token probe. Born 2026-07-04: the production GITHUB_TOKEN had been dead for
 * days and every "graceful" write failed silently — the brain quietly stopped
 * learning and only the thin vault gave it away. Never again: failures must be
 * visible in the UI.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "brain-health.json");

export interface BrainHealth {
  lastSuccess: { at: string; ctx: string } | null;
  lastFailure: { at: string; ctx: string; error: string } | null;
  successCount: number;
  failureCount: number;
}

const EMPTY: BrainHealth = { lastSuccess: null, lastFailure: null, successCount: 0, failureCount: 0 };

export function readBrainHealth(): BrainHealth {
  try {
    if (!fs.existsSync(FILE)) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(fs.readFileSync(FILE, "utf-8")) as Partial<BrainHealth>) };
  } catch {
    return { ...EMPTY };
  }
}

/** Record a brain-write outcome. Never throws — the watchdog must not become a new failure mode. */
export function recordBrainWrite(ok: boolean, ctx: string, error?: string): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const h = readBrainHealth();
    const at = new Date().toISOString();
    if (ok) {
      h.lastSuccess = { at, ctx };
      h.successCount += 1;
    } else {
      h.lastFailure = { at, ctx, error: error ?? "unknown" };
      h.failureCount += 1;
    }
    fs.writeFileSync(FILE, JSON.stringify(h, null, 2), "utf-8");
  } catch (e) {
    console.warn("[brain-health] record failed:", e);
  }
}
