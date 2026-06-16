/**
 * Brain Reader
 *
 * Reads relevant knowledge from the brain vault and injects it into
 * the analysis system prompt. Detects guru/publisher from the promo
 * offer section and loads their profile + universal copywriting principles.
 *
 * Works locally (direct filesystem read). On Railway, falls back gracefully
 * since the vault isn't mounted — scoring still works, just without context.
 */

import fs from "fs";
import path from "path";

const BRAIN_DIR =
  process.env.BRAIN_DIR?.replace(/\/Resources\/.*$/, "") ??
  "/Users/stephenprior/github/brain";

const RESOURCES = path.join(BRAIN_DIR, "Resources");

// Maps known guru names (as they appear in promo copy) to their brain vault files
const GURU_MAP: Record<string, string> = {
  "Bryan Bottarelli": "Bryan Bottarelli.md",
  "Karim Rahemtulla": "Karim Rahemtulla.md",
  "Nate Bear": "Nate Bear.md",
  "Chris Johnson": "Chris Johnson.md",
};

// Maps known publisher names to readable labels
const PUBLISHER_KEYWORDS: Record<string, string> = {
  "Monument Traders Alliance": "Monument Traders Alliance (MTA / Oxford Group / Agora)",
  "MTA": "Monument Traders Alliance (MTA / Oxford Group / Agora)",
  "Oxford Group": "Monument Traders Alliance (MTA / Oxford Group / Agora)",
  "Paradigm Press": "Paradigm Press",
  "Stansberry": "Stansberry Research",
  "Legacy Research": "Legacy Research",
  "InvestorPlace": "InvestorPlace",
  "Porter": "Porter & Co",
  "Banyan Hill": "Banyan Hill",
};

function readFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Detect guru name from offer section text */
export function detectGuru(offerText: string): string | null {
  for (const guru of Object.keys(GURU_MAP)) {
    if (offerText.toLowerCase().includes(guru.toLowerCase())) return guru;
  }
  return null;
}

/** Detect publisher from offer section text */
export function detectPublisher(offerText: string): string | null {
  for (const [keyword, label] of Object.entries(PUBLISHER_KEYWORDS)) {
    if (offerText.toLowerCase().includes(keyword.toLowerCase())) return label;
  }
  return null;
}

export interface BrainContext {
  guru: string | null;
  publisher: string | null;
  guruProfile: string | null;
  copywritingPrinciples: string | null;
}

/** Load relevant brain vault context for a given promo offer section */
export function loadBrainContext(offerText: string): BrainContext {
  const guru = detectGuru(offerText);
  const publisher = detectPublisher(offerText);

  let guruProfile: string | null = null;
  if (guru && GURU_MAP[guru]) {
    guruProfile = readFile(path.join(RESOURCES, GURU_MAP[guru]));
  }

  const copywritingPrinciples = readFile(
    path.join(RESOURCES, "Promo Analysis", "Copywriting Principles.md")
  );

  return { guru, publisher, guruProfile, copywritingPrinciples };
}

/**
 * Build the brain context block injected into the system prompt.
 * Strips Obsidian frontmatter and wiki links for cleaner injection.
 */
export function buildBrainContextBlock(ctx: BrainContext): string {
  if (!ctx.guruProfile && !ctx.copywritingPrinciples) return "";

  const lines: string[] = [];
  lines.push("\n\n## Publisher & Guru Intelligence (from Brain Vault)");
  lines.push(
    "The following knowledge has been accumulated from real promo performance data for this publisher. Use it to calibrate your scoring for this specific guru, audience, and product type."
  );

  if (ctx.guru) {
    lines.push(`\n**Detected Guru:** ${ctx.guru}`);
  }
  if (ctx.publisher) {
    lines.push(`**Publisher:** ${ctx.publisher}`);
  }

  if (ctx.guruProfile) {
    const cleaned = stripObsidianMarkup(ctx.guruProfile);
    lines.push(`\n### ${ctx.guru ?? "Guru"} Profile\n${cleaned}`);
  }

  if (ctx.copywritingPrinciples) {
    const cleaned = stripObsidianMarkup(ctx.copywritingPrinciples);
    lines.push(`\n### Proven Copywriting Principles for This Audience\n${cleaned}`);
  }

  return lines.join("\n");
}

/** Strip Obsidian-specific markup that's not useful in a prompt */
function stripObsidianMarkup(text: string): string {
  return text
    // Remove frontmatter block
    .replace(/^---[\s\S]*?---\n/, "")
    // Convert [[wikilinks]] to plain text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    // Remove bare Obsidian callouts > [!note] etc.
    .replace(/^>\s*\[!.*?\]\s*$/gm, "")
    .trim();
}
