/**
 * Performance dataset API.
 *
 * GET    — all records joined with tier derivations + review match status
 * POST   — import: { csv: "<raw csv text>" } or { sync: true } (full Google Sheet pull)
 * PATCH  — enrich one record: { promoCode, publication?, guru?, promoType?, notes?,
 *          tierOverride?, primaryMetricOverride?, linkReviewId? }
 * DELETE — ?code=<promoCode>
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAllPerformanceRecords,
  upsertPerformanceRecords,
  updatePerformanceRecord,
  deletePerformanceRecord,
  parsePerformanceCsv,
  type PerformanceEnrichment,
} from "@/lib/performance-db";
import { deriveTiers, type TierDerivation } from "@/lib/performance-tier";
import { fetchAllSheetStats, isPromoStatsConfigured, normalizeCode } from "@/lib/promo-stats";
import { getAllReviews, updateReviewPromoCode } from "@/lib/reviews-store";

export const runtime = "nodejs";

export interface PerformanceView {
  record: ReturnType<typeof getAllPerformanceRecords>[number];
  derivation: TierDerivation | null;
  match: { reviewId: string; reviewName: string; hasTraining: boolean } | null;
}

function buildViews(): { views: PerformanceView[]; unmatchedReviews: Array<{ id: string; name: string; promoCode: string | null }> } {
  const records = getAllPerformanceRecords();
  const derivations = deriveTiers(records);
  const reviews = getAllReviews();
  const reviewByCode = new Map(
    reviews.filter((r) => r.promoCode).map((r) => [normalizeCode(r.promoCode!), r])
  );
  const views: PerformanceView[] = records.map((record) => {
    const review = reviewByCode.get(normalizeCode(record.promoCode)) ?? null;
    return {
      record,
      derivation: derivations.get(record.promoCode) ?? null,
      match: review
        ? {
            reviewId: review.id,
            reviewName: review.displayName ?? review.filename.replace(/\.[^.]+$/, ""),
            hasTraining: review.training != null,
          }
        : null,
    };
  });
  const matchedIds = new Set(views.filter((v) => v.match).map((v) => v.match!.reviewId));
  const unmatchedReviews = reviews
    .filter((r) => !matchedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.displayName ?? r.filename.replace(/\.[^.]+$/, ""),
      promoCode: r.promoCode ?? null,
    }));
  return { views, unmatchedReviews };
}

export async function GET() {
  const { views, unmatchedReviews } = buildViews();
  return NextResponse.json({
    views,
    unmatchedReviews,
    sheetConfigured: isPromoStatsConfigured(),
    asOf: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { csv?: string; sync?: boolean };

  if (body.csv) {
    const { rows, error } = parsePerformanceCsv(body.csv);
    if (error) return NextResponse.json({ error }, { status: 400 });
    const result = upsertPerformanceRecords(rows, "csv");
    return NextResponse.json({ ok: true, ...result, imported: rows.length });
  }

  if (body.sync) {
    if (!isPromoStatsConfigured()) {
      return NextResponse.json(
        { error: "Google Sheet not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON and PERFORMANCE_SHEET_ID, or upload a CSV export instead." },
        { status: 400 }
      );
    }
    const all = await fetchAllSheetStats();
    if (all.length === 0) {
      return NextResponse.json({ error: "Sheet returned no rows (check sharing with the service account and the code column header)." }, { status: 400 });
    }
    const result = upsertPerformanceRecords(all, "sheet");
    return NextResponse.json({ ok: true, ...result, imported: all.length });
  }

  return NextResponse.json({ error: "Provide { csv } or { sync: true }" }, { status: 400 });
}

const VALID_TIERS = new Set(["gold_standard", "strong", "average", "weak", "failed"]);

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as
    | (PerformanceEnrichment & { promoCode?: string; linkReviewId?: string | null })
    | Record<string, never>;
  if (!body.promoCode) return NextResponse.json({ error: "promoCode required" }, { status: 400 });
  if (body.tierOverride != null && !VALID_TIERS.has(body.tierOverride)) {
    return NextResponse.json(
      { error: `tierOverride must be one of: ${[...VALID_TIERS].join(", ")}` },
      { status: 400 }
    );
  }

  // Linking a review = writing this creative code onto the review's promoCode field
  if (body.linkReviewId !== undefined) {
    if (body.linkReviewId) {
      const ok = updateReviewPromoCode(body.linkReviewId, body.promoCode);
      if (!ok) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
  }
  // Unlinking clears the review's promoCode (record itself is untouched)
  const unlinkId = (body as { unlinkReviewId?: string }).unlinkReviewId;
  if (unlinkId) {
    const ok = updateReviewPromoCode(unlinkId, null);
    if (!ok) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const updated = updatePerformanceRecord(body.promoCode, body);
  if (!updated) return NextResponse.json({ error: "Performance record not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record: updated });
}

export async function DELETE(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  const ok = deletePerformanceRecord(code);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
