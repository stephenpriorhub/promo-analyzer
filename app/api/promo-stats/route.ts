import { NextRequest, NextResponse } from "next/server";
import { getPromoStats, isPromoStatsConfigured, normalizeCode } from "@/lib/promo-stats";
import { getAllPerformanceRecords } from "@/lib/performance-db";
import { deriveTiers, describeDerivation } from "@/lib/performance-tier";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/promo-stats?code=WAR1024
 * Real-world performance for a creative code. Reads the Google Sheet live
 * (5-min cache — sheet edits show up on their own) and falls back to the
 * imported performance dataset (CSV) when the sheet has no row. Includes the
 * percentile tier derivation when the local dataset can rank it honestly.
 * Soft by design — the analyzer just hides the panel when stats is null.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const configured = isPromoStatsConfigured();
  if (!code) {
    return NextResponse.json({ configured, stats: null, tier: null });
  }

  // Live sheet first; imported dataset as fallback
  let stats = await getPromoStats(code);
  const records = getAllPerformanceRecords();
  const record = records.find((r) => normalizeCode(r.promoCode) === normalizeCode(code)) ?? null;
  if (!stats && record) {
    stats = { promoCode: record.promoCode, stats: record.stats };
  }

  // Tier context from the imported dataset (needs peers to rank against)
  let tier: { tier: string; line: string } | null = null;
  if (record) {
    const d = deriveTiers(records).get(record.promoCode);
    if (d) tier = { tier: d.tier, line: describeDerivation(d) };
  }

  return NextResponse.json({ configured, stats, tier });
}
