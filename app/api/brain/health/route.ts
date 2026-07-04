/**
 * GET /api/brain/health — the brain-writes watchdog.
 *
 * Combines recorded write outcomes (every note/ledger write reports in) with a
 * LIVE GitHub-token probe, so a dead credential is visible immediately — not
 * days later via a suspiciously thin vault (2026-07-04 incident).
 */

import { NextResponse } from "next/server";
import { readBrainHealth } from "@/lib/brain-health";

export const runtime = "nodejs";

const BRAIN_GITHUB_REPO = process.env.BRAIN_GITHUB_REPO ?? "stephenpriorhub/brain";

export async function GET() {
  const recorded = readBrainHealth();

  // Live probe: can the configured token still read the vault repo?
  let tokenOk: boolean | null = null;
  if (process.env.GITHUB_TOKEN) {
    try {
      const res = await fetch(`https://api.github.com/repos/${BRAIN_GITHUB_REPO}`, {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "User-Agent": "promo-analyzer",
          Accept: "application/vnd.github+json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      tokenOk = res.ok;
    } catch {
      tokenOk = false;
    }
  }

  const healthy =
    tokenOk !== false &&
    (recorded.lastFailure == null ||
      (recorded.lastSuccess != null && recorded.lastSuccess.at > recorded.lastFailure.at));

  return NextResponse.json({ healthy, tokenOk, ...recorded });
}
