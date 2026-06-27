import { NextRequest, NextResponse } from "next/server";
import { getPromoStats, isPromoStatsConfigured } from "@/lib/promo-stats";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/promo-stats?code=WAR1024
 * Returns the real-world performance stats for a promo code from the Google
 * Sheet, or { configured, stats: null } when there's no match / not configured.
 * Soft by design — the analyzer just hides the panel when stats is null.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const configured = isPromoStatsConfigured();
  if (!code) {
    return NextResponse.json({ configured, stats: null });
  }
  const stats = await getPromoStats(code);
  return NextResponse.json({ configured, stats });
}
