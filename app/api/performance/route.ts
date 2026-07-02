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
import { fetchAllSheetStats, getSheetLoadError, getSheetLoadStats, isPromoStatsConfigured, normalizeCode } from "@/lib/promo-stats";
import { getAllReviews, updateReviewPromoCode } from "@/lib/reviews-store";
import { classifyStatColumn, normalizedStatNumber } from "@/lib/stat-format";
import { predictAllPerformanceScores } from "@/lib/predict";

export const runtime = "nodejs";

export interface PerformanceView {
  record: ReturnType<typeof getAllPerformanceRecords>[number];
  derivation: TierDerivation | null;
  match: { reviewId: string; reviewName: string; hasTraining: boolean; copyScore: number | null; promoType: string | null } | null;
}

/**
 * Baseline context from the full industry dataset — what conversion rates are
 * actually achievable. Percentiles over every record's conversion column.
 */
function conversionBaseline(records: ReturnType<typeof getAllPerformanceRecords>) {
  const vals: number[] = [];
  for (const r of records) {
    const col = Object.keys(r.stats).find(
      (h) => classifyStatColumn(h) === "percent" && h.toLowerCase().includes("conversion")
    );
    if (!col) continue;
    const n = normalizedStatNumber(r.stats[col], "percent");
    if (n != null && n >= 0 && n <= 100) vals.push(n);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const pct = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  return {
    n: vals.length,
    median: Math.round(pct(0.5) * 100) / 100,
    top10: Math.round(pct(0.9) * 100) / 100,
    top1: Math.round(pct(0.99) * 100) / 100,
  };
}

function buildViews(): { views: PerformanceView[]; unmatchedReviews: Array<{ id: string; name: string; promoCode: string | null }> } {
  const records = getAllPerformanceRecords();
  const reviews = getAllReviews();
  const reviewByCode = new Map(
    reviews.filter((r) => r.promoCode).map((r) => [normalizeCode(r.promoCode!), r])
  );
  // Promo type per creative code drives which metric ranks each record.
  const promoTypeByCode = new Map(
    reviews.filter((r) => r.promoCode && r.promoType).map((r) => [normalizeCode(r.promoCode!), r.promoType!])
  );
  const derivations = deriveTiers(records, promoTypeByCode);
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
            copyScore: review.effectivenessScore,
            promoType: review.promoType ?? null,
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

/** One row per analyzed promo: both scores always; real results when matched. */
export interface PromoRow {
  reviewId: string;
  name: string;
  promoCode: string | null;
  publisher: string | null;
  product: string | null;
  promoType: string | null;
  promoStatus: string | null;
  copyScore: number | null;
  /** k-NN prediction — the promo's OWN real result never informs it. */
  predicted: { score: number; confidence: string } | null;
  real: {
    tier: string;
    performanceScore: number;
    bucket: string;
    stats: Record<string, string>;
    learnedAt: string | null;
  } | null;
}

function buildPromoRows(): PromoRow[] {
  const reviews = getAllReviews();
  const records = getAllPerformanceRecords();
  const recordByCode = new Map(records.map((r) => [normalizeCode(r.promoCode), r]));
  const promoTypeByCode = new Map(
    reviews.filter((r) => r.promoCode && r.promoType).map((r) => [normalizeCode(r.promoCode!), r.promoType!])
  );
  const derivations = deriveTiers(records, promoTypeByCode);
  const predictions = predictAllPerformanceScores(reviews);

  return reviews.map((r) => {
    const rec = r.promoCode ? recordByCode.get(normalizeCode(r.promoCode)) ?? null : null;
    const d = rec ? derivations.get(rec.promoCode) ?? null : null;
    const p = predictions.get(r.id) ?? null;
    return {
      reviewId: r.id,
      name: r.displayName ?? r.filename.replace(/\.[^.]+$/, ""),
      promoCode: r.promoCode ?? null,
      publisher: r.publisher ?? null,
      product: r.product ?? null,
      promoType: r.promoType ?? null,
      promoStatus: r.promoStatus ?? null,
      copyScore: r.effectivenessScore,
      predicted: p ? { score: p.score, confidence: p.confidence } : null,
      real: rec && d
        ? {
            tier: d.tier,
            performanceScore: d.performanceScore,
            bucket: d.bucket,
            stats: rec.stats,
            learnedAt: rec.learnedAt,
          }
        : null,
    };
  });
}

export async function GET() {
  const { views, unmatchedReviews } = buildViews();
  return NextResponse.json({
    views,
    unmatchedReviews,
    promos: buildPromoRows(),
    baseline: conversionBaseline(getAllPerformanceRecords()),
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
      return NextResponse.json(
        { error: getSheetLoadError() ?? "Sheet returned no rows (check sharing with the service account and the code column header)." },
        { status: 400 }
      );
    }
    const result = upsertPerformanceRecords(all, "sheet");
    return NextResponse.json({ ok: true, ...result, imported: all.length, sheet: getSheetLoadStats() });
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
