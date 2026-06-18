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

const BRAIN_GITHUB_REPO = process.env.BRAIN_GITHUB_REPO ?? "stephenpriorhub/brain";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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

function readFileLocal(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read a vault file via the GitHub Contents API. Works on Railway where the
 * vault isn't mounted. `relPath` is repo-relative, e.g.
 * "Resources/Bryan Bottarelli.md". Returns null gracefully on any failure
 * (e.g. 404 for a guru with no profile) — never throws.
 */
async function readViaGitHub(relPath: string): Promise<string | null> {
  if (!GITHUB_TOKEN) return null;
  try {
    const apiBase = `https://api.github.com/repos/${BRAIN_GITHUB_REPO}/contents/${encodeURIComponent(relPath)}`;
    const res = await fetch(apiBase, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "promo-analyzer",
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: string };
    if (!json.content) return null;
    return Buffer.from(json.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Read a vault file: GitHub Contents API first (when GITHUB_TOKEN is set),
 * falling back to the local filesystem if GitHub fails or no token is present.
 * `relPath` is repo-relative; `localPath` is the absolute local path.
 */
async function readVaultFile(relPath: string, localPath: string): Promise<string | null> {
  if (GITHUB_TOKEN) {
    const fromGitHub = await readViaGitHub(relPath);
    if (fromGitHub !== null) return fromGitHub;
  }
  return readFileLocal(localPath);
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
export async function loadBrainContext(offerText: string): Promise<BrainContext> {
  const guru = detectGuru(offerText);
  const publisher = detectPublisher(offerText);

  let guruProfile: string | null = null;
  if (guru && GURU_MAP[guru]) {
    guruProfile = await readVaultFile(
      `Resources/${GURU_MAP[guru]}`,
      path.join(RESOURCES, GURU_MAP[guru])
    );
  }

  const copywritingPrinciples = await readVaultFile(
    "Resources/Promo Analysis/Copywriting Principles.md",
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

/**
 * Load the Industry Publishing Directory (Resources/Financial Publishing
 * Directory.md) — a compact markdown table mapping gurus to publications,
 * parent companies, strategies, and topics. GitHub Contents API first, local
 * fallback. Returns null gracefully if the file doesn't exist (404) — never
 * throws.
 */
export async function loadPublishingDirectory(): Promise<string | null> {
  return readVaultFile(
    "Resources/Financial Publishing Directory.md",
    path.join(RESOURCES, "Financial Publishing Directory.md")
  );
}

/**
 * Wrap the raw directory markdown in a compact prompt section. The directory
 * is already compact markdown — inject as-is (no parsing). Returns "" if there
 * is no directory available so the prompt stays clean.
 */
export function buildDirectoryBlock(text: string | null): string {
  if (!text || !text.trim()) return "";
  const cleaned = stripObsidianMarkup(text);
  return [
    "\n\n## Industry Publishing Directory (use to identify the publisher/guru/parent)",
    "This is a directory of known financial-publishing gurus, their publications, parent companies, strategies, and topics. Use it to identify who is behind a promo with high confidence instead of guessing from style.",
    "",
    cleaned,
  ].join("\n");
}

export interface DirectoryEntry {
  guru: string;
  publication: string;
  parent: string;
}

/** Strip wikilink brackets and trailing parentheticals from a directory cell. */
function cleanCell(cell: string): string {
  return cell
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

/**
 * Parse the Financial Publishing Directory markdown table into structured rows.
 * Expected columns: Guru | Publication | Parent Company | Strategies | Topics | Confidence
 */
export function parseDirectory(text: string | null): DirectoryEntry[] {
  if (!text) return [];
  const rows: DirectoryEntry[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.split("|").map((c) => c.trim());
    // cells[0] is empty (leading pipe). guru=1, publication=2, parent=3
    if (cells.length < 4) continue;
    const guru = cleanCell(cells[1] ?? "");
    const publication = cleanCell(cells[2] ?? "");
    const parent = cleanCell(cells[3] ?? "");
    // Skip header / separator rows
    if (!guru || /^guru$/i.test(guru) || /^-+$/.test(guru)) continue;
    rows.push({ guru, publication, parent });
  }
  return rows;
}

/**
 * Deterministically match a promo's text against the directory. Scans for any
 * guru OR publication name appearing in the copy (case-insensitive). Returns the
 * matched rows so a forceful, specific attribution directive can be injected —
 * far more reliable than asking the model to cross-reference a table itself.
 */
export function matchDirectoryEntities(promoText: string, directoryText: string | null): DirectoryEntry[] {
  const entries = parseDirectory(directoryText);
  if (entries.length === 0) return [];
  // Normalize whitespace — .docx extraction often splits names across runs
  // ("Larry  Benedict"), so collapse all whitespace before matching.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const hay = norm(promoText);
  const matches: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const guruN = norm(e.guru);
    const pubN = norm(e.publication);
    const guruHit = guruN.length >= 5 && hay.includes(guruN);
    const pubHit = pubN.length >= 5 && hay.includes(pubN);
    if (guruHit || pubHit) {
      const key = `${e.guru}::${e.publication}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push(e);
      }
    }
  }
  return matches;
}

/**
 * Build a high-priority, authoritative attribution directive from directory
 * matches. This is what actually drives publisher identification — code found
 * the name in the copy, so the model must not override it with style guesses.
 */
export function buildDirectiveBlock(matches: DirectoryEntry[]): string {
  if (matches.length === 0) return "";
  const lines: string[] = [];
  lines.push("\n\n## CONFIRMED ATTRIBUTION — AUTHORITATIVE (from brain directory)");
  lines.push(
    "The promo copy explicitly names the following known entities, matched against the brain's verified publishing directory. In the [OFFER] section you MUST attribute the Publisher and guru using these mappings. Do NOT let price point, VSL/format style, or copy tone override these — they are confirmed facts, not inferences:"
  );
  for (const m of matches) {
    lines.push(`- Guru "${m.guru}" → Publication: ${m.publication} → Parent company: ${m.parent}`);
  }
  if (matches.length > 1) {
    lines.push("If several are listed, choose the one whose publication/product best matches this promo.");
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
