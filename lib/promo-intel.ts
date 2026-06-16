/**
 * Promo Intelligence formatter.
 *
 * Takes the raw [PROMO_INTEL] JSON extracted during analysis and formats it
 * into a structured markdown note for the brain vault. These notes land in a
 * dedicated "Promo Intelligence" inbox area — append-only, never overwriting
 * curated guru/product profiles. The Brain Agent reviews these drops and merges
 * verified facts into the canonical profiles.
 */

export interface PromoIntel {
  guru?: {
    name?: string | null;
    backstory_claims?: string[];
    credentials_claimed?: string[];
    approach_to_market?: string | null;
    credibility_read?: string | null;
  } | null;
  product?: {
    name?: string | null;
    type?: string | null;
    what_it_offers?: string | null;
    mechanism?: string | null;
    what_guru_promises?: string | null;
    proof_elements?: string[];
    backtest_data?: string | null;
  } | null;
  publication?: string | null;
  audience_signals?: string[];
  notable_facts?: string[];
}

export function parsePromoIntel(raw: string | undefined): PromoIntel | null {
  if (!raw || !raw.trim()) return null;
  try {
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return typeof parsed === "object" && parsed !== null ? (parsed as PromoIntel) : null;
  } catch {
    return null;
  }
}

function bullets(items?: string[]): string {
  if (!items || items.length === 0) return "_None captured._";
  return items.map((i) => `- ${i}`).join("\n");
}

/**
 * Build the markdown intel note. `promoName` and `date` are caller-supplied
 * so this stays pure (no Date.now() — important for resumable workflows).
 */
export function buildIntelNote(
  intel: PromoIntel,
  promoName: string,
  date: string,
  reviewId: string,
  effectivenessScore: number | null
): string {
  const guru = intel.guru ?? {};
  const product = intel.product ?? {};

  const tags = [
    "promo-intelligence",
    "needs-review",
    guru.name ? `guru/${guru.name.toLowerCase().replace(/\s+/g, "-")}` : null,
    intel.publication ? `pub/${intel.publication.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null,
  ].filter(Boolean);

  return `---
status: needs-review
tags: [${tags.join(", ")}]
source: promo-analyzer
review_id: ${reviewId}
created: ${date}
---

# Promo Intel: ${promoName}

> [!info] Auto-extracted by Promo Analyzer. Brain Agent: review and merge verified facts into the canonical guru/product/publication profiles, then mark this note processed.

- **Guru:** ${guru.name ?? "Unknown"}
- **Publication:** ${intel.publication ?? "Unknown"}
- **Product:** ${product.name ?? "Unknown"}${effectivenessScore != null ? `\n- **Predicted Effectiveness:** ${effectivenessScore}/10` : ""}

## Guru Intelligence

**Approach to market:** ${guru.approach_to_market ?? "_Not stated._"}

**Credibility read:** ${guru.credibility_read ?? "_Not assessed._"}

### Backstory Claims
${bullets(guru.backstory_claims)}

### Credentials Claimed
${bullets(guru.credentials_claimed)}

## Product Intelligence

- **Type:** ${product.type ?? "Unknown"}
- **What it offers:** ${product.what_it_offers ?? "_Not stated._"}
- **Mechanism:** ${product.mechanism ?? "_Not stated._"}
- **What the guru promises:** ${product.what_guru_promises ?? "_Not stated._"}
- **Backtest data:** ${product.backtest_data ?? "_None cited._"}

### Proof Elements
${bullets(product.proof_elements)}

## Audience Signals
${bullets(intel.audience_signals)}

## Other Notable Facts
${bullets(intel.notable_facts)}
`;
}

/** A short slug for the intel note filename. */
export function intelNoteTitle(promoName: string): string {
  return `Promo Intel - ${promoName}`;
}
