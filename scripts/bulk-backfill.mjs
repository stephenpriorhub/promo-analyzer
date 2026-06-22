#!/usr/bin/env node
/**
 * Bulk backfill — analyze a tree of promo files and label them with a
 * band-midpoint performance score derived from the folder they live in.
 *
 * Usage:
 *   node scripts/bulk-backfill.mjs <rootFolder> <baseUrl>
 *
 * The <rootFolder> must contain `Strong/`, `Mediocre/`, and `Weak/` subfolders
 * (case-insensitive). Each PDF/.docx inside is:
 *   1. POSTed to `${BASE}/api/analyze` (multipart, field `file`),
 *   2. its `reviewId` read from the streamed `[META]...[/META]` block, then
 *   3. PATCHed to `${BASE}/api/reviews` with a training performanceScore equal
 *      to the band midpoint (Strong=8, Average=5, Weak=2).
 *
 * Sequential and RESUMABLE:
 *   - GET /api/reviews first; any filename already present is skipped.
 *   - Each completed file is appended to `.bulk-backfill-progress.log`; logged
 *     entries are skipped on re-run.
 *
 * Does NOT run automatically — invoke manually.
 */

import fs from "node:fs";
import path from "node:path";

const [, , ROOT, BASE_RAW] = process.argv;

if (!ROOT || !BASE_RAW) {
  console.error("Usage: node scripts/bulk-backfill.mjs <rootFolder> <baseUrl>");
  process.exit(1);
}
const BASE = BASE_RAW.replace(/\/$/, "");
const PROGRESS_LOG = path.join(process.cwd(), ".bulk-backfill-progress.log");

// Band config: folder name -> { tier label, midpoint score }
const BANDS = [
  { match: /^strong/i, tier: "Strong", band: "7-10", score: 8 },
  { match: /^(mediocre|average|medium)/i, tier: "Average", band: "4-6", score: 5 },
  { match: /^weak/i, tier: "Weak", band: "1-3", score: 2 },
];

const VALID_EXT = new Set([".pdf", ".docx"]);

function loadProgress() {
  if (!fs.existsSync(PROGRESS_LOG)) return new Set();
  return new Set(
    fs
      .readFileSync(PROGRESS_LOG, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  );
}

function logProgress(filename) {
  fs.appendFileSync(PROGRESS_LOG, `${filename}\n`, "utf-8");
}

async function getExistingFilenames() {
  const res = await fetch(`${BASE}/api/reviews`);
  if (!res.ok) throw new Error(`GET /api/reviews failed: ${res.status}`);
  const reviews = await res.json();
  return new Set((Array.isArray(reviews) ? reviews : []).map((r) => r.filename));
}

function discoverFiles(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const band = BANDS.find((b) => b.match.test(entry.name));
    if (!band) continue;
    const dir = path.join(root, entry.name);
    for (const f of fs.readdirSync(dir)) {
      if (VALID_EXT.has(path.extname(f).toLowerCase())) {
        out.push({ filePath: path.join(dir, f), filename: f, band });
      }
    }
  }
  return out;
}

/** Stream the analyze response and pull the reviewId out of the [META] block. */
async function analyzeFile(filePath, filename) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  const type = filename.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  form.append("file", new Blob([buf], { type }), filename);

  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", body: form });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`analyze failed (${res.status}): ${msg.slice(0, 200)}`);
  }
  const full = await res.text();
  const m = full.match(/\[META\]([\s\S]*?)\[\/META\]/);
  if (!m) throw new Error("no [META] block in analyze response");
  const meta = JSON.parse(m[1]);
  if (!meta.reviewId) throw new Error("[META] block missing reviewId");
  return meta.reviewId;
}

async function labelReview(reviewId, band) {
  const res = await fetch(`${BASE}/api/reviews`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: reviewId,
      training: {
        promoType: null,
        performanceScore: band.score,
        myScore: null,
        reasoning: `Bulk backfill — ${band.tier} (band ${band.band})`,
        lastUpdated: new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`PATCH /api/reviews failed (${res.status}): ${msg.slice(0, 200)}`);
  }
}

async function main() {
  if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
    console.error(`Root folder not found: ${ROOT}`);
    process.exit(1);
  }

  const done = loadProgress();
  const existing = await getExistingFilenames();
  const files = discoverFiles(ROOT);

  console.log(`Discovered ${files.length} file(s) across band subfolders.`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const { filePath, filename, band } of files) {
    if (done.has(filename) || existing.has(filename)) {
      skipped++;
      console.log(`SKIP  ${filename} (already processed)`);
      continue;
    }
    try {
      process.stdout.write(`...   ${filename} [${band.tier}] `);
      const reviewId = await analyzeFile(filePath, filename);
      await labelReview(reviewId, band);
      logProgress(filename);
      ok++;
      console.log(`OK -> ${reviewId} (score ${band.score})`);
    } catch (err) {
      failed++;
      console.log(`FAIL: ${err.message}`);
    }
  }

  console.log(`\nDone. ${ok} processed, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
