#!/usr/bin/env node
/**
 * Re-run analysis on every saved review (e.g. after a scoring-logic change) and
 * record how each review's effectiveness score moved.
 *
 * Usage:
 *   node scripts/rerun-all.mjs <baseUrl>
 *
 * For each review returned by GET /api/reviews:
 *   - POST `${BASE}/api/reanalyze {reviewId}` (streams; we drain it),
 *   - record before -> after `effectivenessScore` to a report file,
 *   - reviews whose reanalyze 404s (missing source file) are skipped and listed.
 *
 * RESUMABLE: each completed reviewId is appended to `.rerun-all-progress.log`
 * and skipped on re-run. The report is written to `rerun-all-report.json`.
 *
 * Does NOT run automatically — invoke manually.
 */

import fs from "node:fs";
import path from "node:path";

const [, , BASE_RAW] = process.argv;
if (!BASE_RAW) {
  console.error("Usage: node scripts/rerun-all.mjs <baseUrl>");
  process.exit(1);
}
const BASE = BASE_RAW.replace(/\/$/, "");
const PROGRESS_LOG = path.join(process.cwd(), ".rerun-all-progress.log");
const REPORT_FILE = path.join(process.cwd(), "rerun-all-report.json");

function loadProgress() {
  if (!fs.existsSync(PROGRESS_LOG)) return new Set();
  return new Set(
    fs.readFileSync(PROGRESS_LOG, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)
  );
}
function logProgress(reviewId) {
  fs.appendFileSync(PROGRESS_LOG, `${reviewId}\n`, "utf-8");
}

async function getReviews() {
  const res = await fetch(`${BASE}/api/reviews`);
  if (!res.ok) throw new Error(`GET /api/reviews failed: ${res.status}`);
  const reviews = await res.json();
  return Array.isArray(reviews) ? reviews : [];
}

async function getReviewScore(reviewId) {
  const reviews = await getReviews();
  const r = reviews.find((x) => x.id === reviewId);
  return r ? r.effectivenessScore ?? null : null;
}

/** Returns 'ok' | 'missing-source' | 'error'. Drains the stream on success. */
async function reanalyze(reviewId) {
  const res = await fetch(`${BASE}/api/reanalyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewId }),
  });
  if (res.status === 404) return "missing-source";
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`reanalyze failed (${res.status}): ${msg.slice(0, 200)}`);
  }
  await res.text(); // drain the stream so the server finishes persisting
  return "ok";
}

async function main() {
  const done = loadProgress();
  const reviews = await getReviews();
  console.log(`Found ${reviews.length} review(s).`);

  const report = [];
  const skippedMissingSource = [];
  let ok = 0;
  let failed = 0;

  for (const review of reviews) {
    const id = review.id;
    const name = review.displayName ?? review.filename;
    const before = review.effectivenessScore ?? null;

    if (done.has(id)) {
      console.log(`SKIP  ${name} (already re-run)`);
      continue;
    }

    try {
      process.stdout.write(`...   ${name} (before ${before ?? "—"}) `);
      const status = await reanalyze(id);
      if (status === "missing-source") {
        skippedMissingSource.push({ id, name });
        console.log("SKIP (missing source, 404)");
        continue;
      }
      const after = await getReviewScore(id);
      report.push({ id, name, before, after, delta: before != null && after != null ? +(after - before).toFixed(1) : null });
      logProgress(id);
      ok++;
      console.log(`OK -> after ${after ?? "—"}`);
    } catch (err) {
      failed++;
      console.log(`FAIL: ${err.message}`);
    }
  }

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), report, skippedMissingSource }, null, 2),
    "utf-8"
  );

  console.log(`\nDone. ${ok} re-run, ${skippedMissingSource.length} skipped (missing source), ${failed} failed.`);
  if (skippedMissingSource.length) {
    console.log("Reviews with no source file (cannot re-analyze):");
    for (const s of skippedMissingSource) console.log(`  - ${s.name} (${s.id})`);
  }
  console.log(`Report written to ${REPORT_FILE}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
