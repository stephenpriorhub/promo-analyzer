import { NextRequest, NextResponse } from "next/server";
import { getAllReviews, type SavedReview } from "@/lib/reviews-store";
import { getAllPerformanceRecords } from "@/lib/performance-db";
import { deriveTiers } from "@/lib/performance-tier";
import { normalizeCode } from "@/lib/promo-stats";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/top-promos?guru=Nate%20Bear&service=PSU&limit=5
 *
 * Read-only feed for the Promo Builder: the best-scoring analyzed promos for a
 * given guru and/or service, so the VSL it writes is grounded in what actually
 * performed. Sorted by effectiveness; enriched with the real performance tier
 * where a creative code matches the performance dataset.
 *
 * Sits behind the hub-auth wall (proxy.ts). Promo Builder calls it
 * server-to-server with x-hub-token, which proxy.ts accepts as a service call.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const guru = (searchParams.get("guru") ?? "").trim().toLowerCase();
  const service = (searchParams.get("service") ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 5, 1), 20);

  if (!guru && !service) {
    return NextResponse.json({ promos: [] });
  }

  const reviews = getAllReviews();

  const guruMatch = (r: SavedReview) => {
    if (!guru) return true;
    const last = guru.split(" ").pop() ?? guru;
    return (r.gurus ?? []).some((g) => {
      const gl = g.toLowerCase();
      return gl.includes(guru) || gl.includes(last);
    });
  };

  const serviceMatch = (r: SavedReview) => {
    if (!service) return true;
    const hay = [r.product, r.promoCode, r.promoType, r.displayName, r.filename]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(service);
  };

  // Tier lookup: derive once, keyed by creative code.
  let tierByCode: Map<string, { tier: string }> = new Map();
  try {
    const records = getAllPerformanceRecords();
    const promoTypeByCode = new Map(
      reviews
        .filter((r) => r.promoCode && r.promoType)
        .map((r) => [normalizeCode(r.promoCode!), r.promoType!])
    );
    tierByCode = deriveTiers(records, promoTypeByCode);
  } catch {
    /* performance data optional — tier stays null */
  }

  const promos = reviews
    .filter((r) => guruMatch(r) && serviceMatch(r))
    .filter((r) => r.effectivenessScore != null)
    .sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0))
    .slice(0, limit)
    .map((r) => ({
      displayName: r.displayName || r.filename,
      effectivenessScore: r.effectivenessScore,
      tier: r.promoCode ? tierByCode.get(normalizeCode(r.promoCode))?.tier ?? null : null,
      guru: (r.gurus ?? [])[0] ?? null,
      service: r.product ?? r.promoType ?? null,
      oneLineWhyItWorked: firstSentence(r.sections?.effectiveness),
    }));

  return NextResponse.json({ promos });
}

/** First clean sentence of the effectiveness rationale, as a compact one-liner. */
function firstSentence(text: string | undefined): string | null {
  if (!text) return null;
  const clean = text
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const m = clean.match(/^.*?[.!?](\s|$)/);
  const s = (m ? m[0] : clean).trim();
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
