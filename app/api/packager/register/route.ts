import { NextRequest, NextResponse } from "next/server";
import {
  saveReview,
  renameReview,
  updateReviewSource,
  updateReviewPromoStatus,
  updateReviewPromoType,
  updateReviewPublisher,
  updateReviewGurus,
  updateReviewProduct,
  PROMO_TYPES,
  type PromoType,
  type AnalysisSections,
} from "@/lib/reviews-store";
import { getHubUser, isHubAdmin } from "@/lib/hub-auth";

export const runtime = "nodejs";

interface RegisterBody {
  title?: string;
  promoText?: string;
  promoType?: string | null;
  publisher?: string | null;
  gurus?: string[];
  product?: string | null;
  price?: number | null;
}

/**
 * POST /api/packager/register
 * Registers a Packager-originated promo as a Draft (Untested) review.
 *
 * Auth: admin cookie session OR the service token (x-hub-token). getHubUser
 * already resolves the service token to an admin-equivalent identity, so an
 * admin check on its result covers both cases (require admin OR service token).
 *
 * Body (JSON): { title, promoText, promoType?, publisher?, gurus?, product?, price? }
 * Returns: { reviewId }
 */
export async function POST(req: NextRequest) {
  const user = await getHubUser(req);
  if (!isHubAdmin(user)) {
    return NextResponse.json(
      { error: "Admin session or service token required." },
      { status: 403 }
    );
  }

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const promoText = body.promoText ?? "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!promoText.trim()) {
    return NextResponse.json({ error: "promoText is required" }, { status: 400 });
  }

  if (
    body.promoType != null &&
    !(PROMO_TYPES as readonly string[]).includes(body.promoType)
  ) {
    return NextResponse.json({ error: "Invalid promoType" }, { status: 400 });
  }

  // Reuse the existing create path. Empty analysis sections — this is an
  // untested draft, not an analyzed promo. Store the raw promo copy in the
  // offer section so it round-trips as the review's source text and feeds the
  // same detection/parse helpers analyzed promos use.
  const sections: AnalysisSections = {
    headline: "",
    outline: "",
    evaldo: "",
    cub: "",
    offer: promoText,
    stockTease: "",
    effectiveness: "",
  };

  const review = saveReview(
    title,      // filename — displayName is set below
    sections,
    null,       // fkReadingEase
    null,       // fkGradeLevel
    null,       // promoRunStartDate
    "text",     // inputType
    null        // promoCode
  );

  // Apply Packager-specific fields via existing setters (no parallel writer).
  renameReview(review.id, title);
  updateReviewSource(review.id, "packager");
  updateReviewPromoStatus(review.id, "Draft (Untested)");

  // Explicit metadata from the Packager overrides auto-seeded values.
  if (body.promoType != null) {
    updateReviewPromoType(review.id, body.promoType as PromoType, "manual");
  }
  if (body.publisher != null) updateReviewPublisher(review.id, body.publisher);
  if (Array.isArray(body.gurus)) updateReviewGurus(review.id, body.gurus);
  if (body.product != null) updateReviewProduct(review.id, body.product);

  return NextResponse.json({ reviewId: review.id });
}
