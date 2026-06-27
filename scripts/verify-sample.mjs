#!/usr/bin/env node
/**
 * Verify the discrimination fix on a small sample WITHOUT re-running all reviews.
 * Re-analyzes a fixed set of loser + winner reviewIds and prints before/after
 * predicted scores vs the known actual (training.performanceScore).
 *
 * Usage: node scripts/verify-sample.mjs <baseUrl>
 */
import fs from "node:fs";

const BASE = (process.argv[2] || "https://analyzer.oxfordhub.app").replace(/\/$/, "");

// id -> label, picked from calibration (losers actual=2, winners actual=8)
const SAMPLE = [
  { id: "9b2af9ea-d54b-49ca-8c7c-442ea574fcb5", tag: "LOSER", name: "TPU China Script", actual: 2 },
  { id: "cc8c958d-657d-4fa3-ad81-7d34122fc17e", tag: "LOSER", name: "TPU Tweet Post-Legal", actual: 2 },
  { id: "0a08c9f7-22f5-41d6-b84d-898ab30b438f", tag: "LOSER", name: "The Next Big Short", actual: 2 },
  { id: "de418c5a-dec2-4a47-873c-de168e00377f", tag: "LOSER", name: "WAR Dot FINAL", actual: 2 },
  { id: "517fa35f-94f9-4005-9851-fd2672c26164", tag: "LOSER", name: "Banyan WMC", actual: 2 },
  { id: "9eeefbb7-0d85-4201-8846-3634e4d8606b", tag: "LOSER", name: "War Magic Cub Legal", actual: 2 },
  { id: "ba008108-cd77-4f2d-894a-5e35afc72c37", tag: "WINNER", name: "Prins EVs", actual: 8 },
  { id: "f0dc4188-e519-46ae-be25-b1dc3b1627ea", tag: "WINNER", name: "MWL Partner", actual: 8 },
  { id: "5c823768-ee64-4ac6-9faa-a35f3ca8d384", tag: "WINNER", name: "Stansberry Bonner 4th Warning", actual: 8 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if ([429, 500, 502, 503, 504].includes(res.status)) { last = new Error(`HTTP ${res.status}`); await sleep(10000 * (i + 1)); continue; }
      return res;
    } catch (e) { last = e; await sleep(10000 * (i + 1)); }
  }
  throw last;
}

async function scoreOf(id) {
  const res = await fetch(`${BASE}/api/reviews`);
  const arr = await res.json();
  const r = (Array.isArray(arr) ? arr : []).find((x) => x.id === id);
  return r ? r.effectivenessScore ?? null : null;
}

async function main() {
  const rows = [];
  for (const s of SAMPLE) {
    const before = await scoreOf(s.id);
    process.stdout.write(`... ${s.tag} ${s.name} (before ${before ?? "—"}, actual ${s.actual}) `);
    try {
      const res = await fetchRetry(`${BASE}/api/reanalyze`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: s.id }),
      });
      if (res.status === 404) { console.log("SKIP (missing source)"); continue; }
      await res.text();
      const after = await scoreOf(s.id);
      rows.push({ ...s, before, after, errBefore: before != null ? +Math.abs(before - s.actual).toFixed(1) : null, errAfter: after != null ? +Math.abs(after - s.actual).toFixed(1) : null });
      console.log(`-> after ${after ?? "—"}`);
    } catch (e) { console.log(`FAIL ${e.message}`); }
    await sleep(3000);
  }
  console.log("\n=== SUMMARY ===");
  for (const r of rows) console.log(`${r.tag.padEnd(7)} ${r.name.padEnd(30)} actual ${r.actual}  ${r.before} -> ${r.after}  |err| ${r.errBefore} -> ${r.errAfter}`);
  const losers = rows.filter((r) => r.tag === "LOSER" && r.after != null);
  const winners = rows.filter((r) => r.tag === "WINNER" && r.after != null);
  const avg = (a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null;
  console.log(`\nLosers  avg predicted ${avg(losers.map(r=>r.before))} -> ${avg(losers.map(r=>r.after))} (actual 2)`);
  console.log(`Winners avg predicted ${avg(winners.map(r=>r.before))} -> ${avg(winners.map(r=>r.after))} (actual 8)`);
  console.log(`Loser MAE  ${avg(losers.map(r=>r.errBefore))} -> ${avg(losers.map(r=>r.errAfter))}`);
  console.log(`Winner MAE ${avg(winners.map(r=>r.errBefore))} -> ${avg(winners.map(r=>r.errAfter))}`);
  fs.writeFileSync("verify-sample-report.json", JSON.stringify(rows, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
