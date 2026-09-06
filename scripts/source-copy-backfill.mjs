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

let ok = 0, skipped = 0, failed = 0, words = 0, cost = 0;
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
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });
    let j = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) throw new Error(j.error ?? `HTTP ${res.status}`);

    // Vision transcriptions run in the background (a synchronous request dies
    // at the platform edge). Poll until the job lands.
    if (j.queued) {
      process.stdout.write("(transcribing");
      const deadline = Date.now() + 40 * 60 * 1000;
      let job;
      for (;;) {
        await sleep(20000);
        process.stdout.write(".");
        const probe = await fetch(`${BASE}/api/source-copy?reviewId=${r.id}`, { headers: AUTH })
          .then((p) => p.json())
          .catch(() => ({}));
        job = probe.job;
        if (job && job.status !== "running") break;
        if (Date.now() > deadline) { job = { status: "error", error: "timed out waiting for transcription" }; break; }
      }
      process.stdout.write(") ");
      j = job.status === "done" ? job.result : { ok: false, error: job.error ?? "transcription failed" };
    }
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
      const spend = j.usage
        ? ` [${j.usage.turns} turn(s), ${(j.usage.cacheReadTokens / 1000).toFixed(0)}k cached, $${j.usage.costUsd.toFixed(3)}]`
        : "";
      console.log(`OK ${j.mode} ${j.words} words → ${j.title}${spend}${link}`);
      cost += j.usage?.costUsd ?? 0;
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
console.log(
  `\nSource copy backfill: ${ok} written (${words.toLocaleString()} words), ${skipped} skipped, ${failed} failed` +
    (cost > 0 ? `, $${cost.toFixed(2)} spent.` : ".")
);
