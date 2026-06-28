import { NextResponse } from "next/server";
import { getDistinctMetaValues } from "@/lib/reviews-store";
import { getCanonicalEntities, getKnownPublishers, getKnownGurus } from "@/lib/brain-reader";

export const runtime = "nodejs";

// Old verbose label some reviews were seeded with → canonical directory name,
// so the dropdown shows one uniform "Monument Traders Alliance" entry.
const PUBLISHER_CANON: Record<string, string> = {
  "Monument Traders Alliance (MTA / Oxford Group / Agora)": "Monument Traders Alliance",
};
const canonPub = (p: string) => PUBLISHER_CANON[p] ?? p;

/**
 * GET /api/promo-meta-options
 * Dropdown options for the editable Promo Details fields. Source of truth is the
 * brain's Financial Publishing Directory (canonical gurus/publishers/products),
 * unioned with values already used across reviews. Publishers include a "Not
 * sure" sentinel. Gurus exclude hosts (handled in getCanonicalEntities/known).
 */
export async function GET() {
  const [canon, used] = await Promise.all([
    getCanonicalEntities(),
    Promise.resolve(getDistinctMetaValues()),
  ]);

  const dedupSort = (arr: string[]) =>
    Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  // Fall back to the small hardcoded known-lists if the directory was unavailable.
  const canonPublishers = canon.publishers.length ? canon.publishers : getKnownPublishers();
  const canonGurus = canon.gurus.length ? canon.gurus : getKnownGurus();

  const publishers = dedupSort([...canonPublishers, ...used.publishers.map(canonPub)]);
  const gurus = dedupSort([...canonGurus, ...used.gurus]);
  const products = dedupSort([...canon.products, ...used.products]);

  return NextResponse.json({
    publishers: ["Not sure", ...publishers],
    gurus,
    products,
  });
}
