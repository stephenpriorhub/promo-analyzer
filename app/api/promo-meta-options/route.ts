import { NextResponse } from "next/server";
import { getDistinctMetaValues } from "@/lib/reviews-store";
import { getKnownPublishers, getKnownGurus } from "@/lib/brain-reader";

export const runtime = "nodejs";

/**
 * GET /api/promo-meta-options
 * Dropdown options for the editable Offer Details fields: a union of
 * previously-used values (across reviews) and known directory values.
 * Publishers always include a "Not sure" sentinel.
 */
export async function GET() {
  const used = getDistinctMetaValues();
  const dedupSort = (arr: string[]) =>
    Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const publishers = dedupSort([...getKnownPublishers(), ...used.publishers]);
  const gurus = dedupSort([...getKnownGurus(), ...used.gurus]);
  const products = dedupSort(used.products);

  return NextResponse.json({
    publishers: ["Not sure", ...publishers],
    gurus,
    products,
  });
}
