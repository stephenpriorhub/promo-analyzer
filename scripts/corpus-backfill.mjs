#!/usr/bin/env node
/**
 * Corpus backfill — mine every stored promo source document for the
 * copy-knowledge corpus (facts, voice, style), then project the top gurus'
 * knowledge into the vault.
 *
 * Usage: HUB_API_TOKEN=... node scripts/corpus-backfill.mjs <baseUrl> [guru1,guru2,...]
 *
 * Sequential + paced + RESUMABLE (progress log, re-runs skip completed ids).
 */
import fs from "node:fs";
import path from "node:path";

const [, , BASE_RAW, GURUS_RAW] = process.argv;
if (!BASE_RAW) {
  console.error("Usage: node scripts/corpus-backfill.mjs <baseUrl> [gurus,comma,separated]");
  process.exit(1);
}
const BASE = BASE_RAW.replace(/\/$/, "");
const PROGRESS = path.join(process.cwd(), ".corpus-backfill-progress.log");
const PACE_MS = Number(process.env.PACE_MS ?? 4000);
const AUTH = process.env.HUB_API_TOKEN ? { "x-hub-token": process.env.HUB_API_TOKEN } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const done = new Set(
  fs.existsSync(PROGRESS)
    ? fs.readFileSync(PROGRESS, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)
    : []
);

const reviews = await (await fetch(`${BASE}/api/reviews`, { headers: AUTH })).json();
console.log(`${reviews.length} reviews; ${done.size} already extracted (progress log)`);

let ok = 0, skipped = 0, failed = 0;
for (const r of reviews) {
  const name = r.displayName ?? r.filename;
  if (done.has(r.id)) { skipped++; continue; }
  process.stdout.write(`...  ${name.slice(0, 50)} `);
  try {
    const res = await fetch(`${BASE}/api/corpus`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ reviewId: r.id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    if (j.skipped) {
      console.log(`SKIP (${j.why})`);
      fs.appendFileSync(PROGRESS, `${r.id}\n`);
      skipped++;
    } else if (j.ok) {
      console.log(`OK +${j.factsNew} facts (${j.factsSeenAgain} repeats), ${j.passages} passages, ${j.styleNotes} style [${j.sourceFormat}]`);
      fs.appendFileSync(PROGRESS, `${r.id}\n`);
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
console.log(`\nExtraction done: ${ok} ok, ${skipped} skipped, ${failed} failed.`);

const stats = await (await fetch(`${BASE}/api/corpus?stats=true`, { headers: AUTH })).json();
console.log("Corpus:", JSON.stringify(stats));

const gurus = (GURUS_RAW ?? "").split(",").map((g) => g.trim()).filter(Boolean);
for (const g of gurus) {
  process.stdout.write(`project ${g} ... `);
  const res = await fetch(`${BASE}/api/corpus`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ project: true, guru: g }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(j.ok ? `OK (${j.facts} facts, ${j.passages} passages → ${j.notes.join(" + ")})` : `FAIL: ${j.error}`);
  await sleep(1500);
}
