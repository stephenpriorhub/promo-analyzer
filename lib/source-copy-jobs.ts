/**
 * Job store for vision transcriptions.
 *
 * A scanned promo takes minutes to transcribe, and nothing streams while it
 * runs, so a synchronous request dies at Railway's edge with a 502 (the same
 * trap VidRipper's analysis proxy hit). The route starts a job and returns
 * immediately; callers poll.
 *
 * State is persisted so a poll survives a container restart, and written
 * atomically — an in-place truncate that loses a restart race is how VidRipper
 * silently wiped its manifest.
 */

import fs from "fs";
import path from "path";
import type { SourceCopyResult } from "./promo-source";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const JOBS_FILE = path.join(DATA_DIR, "source-copy-jobs.json");

/**
 * A job still marked running after this long was orphaned by a restart —
 * nothing else would ever move it off. Generous: six 32k-token turns on a
 * 60-page magalog is slow but legitimate.
 */
const STALE_MS = 30 * 60 * 1000;

export interface SourceCopyJob {
  reviewId: string;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  result?: SourceCopyResult;
  error?: string;
}

function readAll(): Record<string, SourceCopyJob> {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")) as Record<string, SourceCopyJob>;
  } catch {
    return {};
  }
}

function writeAll(jobs: Record<string, SourceCopyJob>): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${JOBS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), "utf-8");
    fs.renameSync(tmp, JOBS_FILE);
  } catch (err) {
    console.warn("[source-copy] job store write failed:", err);
  }
}

/** Read one job, reporting a restart-orphaned job as an error rather than "running" forever. */
export function getJob(reviewId: string): SourceCopyJob | null {
  const job = readAll()[reviewId];
  if (!job) return null;
  if (job.status === "running" && Date.now() - Date.parse(job.startedAt) > STALE_MS) {
    return { ...job, status: "error", error: "transcription was interrupted (server restart or timeout)" };
  }
  return job;
}

export function startJob(reviewId: string): SourceCopyJob {
  const jobs = readAll();
  const job: SourceCopyJob = { reviewId, status: "running", startedAt: new Date().toISOString() };
  jobs[reviewId] = job;
  writeAll(jobs);
  return job;
}

export function finishJob(reviewId: string, result: SourceCopyResult): void {
  const jobs = readAll();
  jobs[reviewId] = {
    reviewId,
    startedAt: jobs[reviewId]?.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: result.ok ? "done" : "error",
    result,
    error: result.ok ? undefined : result.error,
  };
  writeAll(jobs);
}
