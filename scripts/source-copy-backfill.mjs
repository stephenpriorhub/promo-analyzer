#!/usr/bin/env node
/**
 * Source Copy backfill — write the FULL copy of every already-analyzed promo
 * into the brain vault as `Resources/Promo Analysis/Source Copy/Promo Copy - X.md`,
 * linked to its analysis note.
 *
 * Usage: HUB_API_TOKEN=... node scripts/source-copy-backfill.mjs <baseUrl> [--vision-only|--text-only]
 *
 * Sequential + paced + RESUMABLE (progress log; re-runs skip completed ids).
 * Scanned PDFs take a multi-turn vision transcription — minutes each — so the
 * per-request timeout is generous and the pacing is deliberate.
 */
import fs from "node:fs";
import path from "node:path";

const [, , BASE_RAW, ...FLAGS] = process.argv;
if (!BASE_RAW) {
  console.error("Usage: node scripts/source-copy-backfill.mjs <baseUrl> [--vision-only|--text-only]");
  process.exit(1);
}
const BASE = BASE_RAW.replace(/\/$/, "");
const ONLY = FLAGS.includes("--vision-only") ? "vision" : FLAGS.includes("--text-only") ? "text" : null;
const PROGRESS = path.join(process.cwd(), ".source-copy-backfill-progress.log");
const PACE_MS = Number(process.env.PACE_MS ?? 3000);
const AUTH = process.env.HUB_API_TOKEN ? { "x-hub-token": process.env.HUB_API_TOKEN } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const done = new Set(
  fs.existsSync(PROGRESS)
    ? fs.readFileSync(PROGRESS, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)
    : []
);

const reviews = await (await fetch(`${BASE}/api/reviews`, { headers: AUTH })).json();
console.log(`${reviews.length} reviews; ${done.size} already written (progress log)${ONLY ? `; filter: ${ONLY}` : ""}`);

let ok = 0, skipped = 0, failed = 0, words = 0;
for (const r of reviews) {
  const name = r.displayName ?? r.filename;
  if (done.has(r.id)) { skipped++; continue; }

  if (ONLY) {
    const probe = await fetch(`${BASE}/api/source-copy?reviewId=${r.id}`, { headers: AUTH })
      .then((res) => res.json())
      .catch(() => ({}));
    if (probe.mode !== ONLY) { skipped++; continue; }
  }

  process.stdout.write(`...  ${name.slice(0, 50)} `);
  try {
    const res = await fetch(`${BASE}/api/source-copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ reviewId: r.id }),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    if (j.skipped) {
      console.log(`SKIP (${j.why})`);
      fs.appendFileSync(PROGRESS, `${r.id}\n`);
      skipped++;
    } else if (j.ok) {
      const link = j.linked
        ? j.analysisTitle && `Promo Copy - ${j.analysisTitle}` !== j.title
          ? ` [linked to renamed note: ${j.analysisTitle}]`
          : ""
        : " (analysis note NOT linked — none in vault)";
      console.log(`OK ${j.mode} ${j.words} words → ${j.title}${link}`);
      fs.appendFileSync(PROGRESS, `${r.id}\n`);
      words += j.words ?? 0;
      ok++;
    } else {
      console.log(`FAIL: ${j.error}`);
      failed++;
    }
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    failed++;
  }
  await sleep(PACE_MS);
}
console.log(`\nSource copy backfill: ${ok} written (${words.toLocaleString()} words), ${skipped} skipped, ${failed} failed.`);
