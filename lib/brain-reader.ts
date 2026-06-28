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

// Hosts/analysts who front shows but don't own products — excluded from guru options.
const NON_GURU_HOSTS = new Set(["Chris Johnson"]);

/** Known publisher labels (deduped) for seeding dropdown options. */
export function getKnownPublishers(): string[] {
  return Array.from(new Set(Object.values(PUBLISHER_KEYWORDS))).sort((a, b) => a.localeCompare(b));
}

/** Known gurus (editors/strategists only — hosts excluded) for seeding dropdown options. */
export function getKnownGurus(): string[] {
  return Object.keys(GURU_MAP).filter((g) => !NON_GURU_HOSTS.has(g)).sort((a, b) => a.localeCompare(b));
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

/**
 * Load the industry-signals files (affiliate send-frequency + cross-publisher
 * topic-frequency) maintained in the brain by the hourly Brain Master. GitHub
 * Contents API first, local fallback. Returns combined markdown or null.
 */
export async function loadMarketIntelligence(): Promise<string | null> {
  const [aff, topics] = await Promise.all([
    readVaultFile(
      "Resources/Market Intelligence/MarketBeat Send Frequency.md",
      path.join(RESOURCES, "Market Intelligence", "MarketBeat Send Frequency.md")
    ),
    readVaultFile(
      "Resources/Market Intelligence/Topic Frequency Trends.md",
      path.join(RESOURCES, "Market Intelligence", "Topic Frequency Trends.md")
    ),
  ]);
  const parts = [aff, topics].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Build the Industry Signals Layer — an explicitly SECONDARY scoring layer.
 * Copy quality stays primary; signals are a probability factor only, and the
 * promo's run date gates how relevant the (possibly newer) signal data is.
 */
export function buildIndustrySignalsBlock(
  promoRunStartDate: string | null | undefined,
  marketIntelText: string | null
): string {
  if (!marketIntelText || !marketIntelText.trim()) return "";
  const dateLine = promoRunStartDate
    ? `This promo started running approximately on ${promoRunStartDate}. Judge the signals' relevance against that date: if the data is much more recent and shows no current activity for this promo's offer, that is NOT evidence of failure — the campaign may simply have ended. Conversely, signals from around the run date are most relevant.`
    : `No promo run date was provided — treat these signals as current-context only; do not assume this promo is recent.`;
  return [
    "\n\n## Industry Signals Layer — SECONDARY (must NOT override copy quality)",
    "Real-world industry signals: what affiliate marketers (e.g. MarketBeat) are mailing and how often, and which topics many publishers are pushing. These reflect what is getting traction in the market.",
    dateLine,
    "HOW TO USE: Copy quality and strategy remain the PRIMARY driver of the effectiveness score and must not be overridden by these signals. Use them ONLY as a secondary probability factor — repeated affiliate lifts of the same offer over multiple weeks indicate it is working; many publishers pushing a topic indicates rising interest (a tailwind ONLY IF the copy is strong). Use signals to inform your confidence and to help explain gaps between predicted and actual performance — never to inflate or deflate the core copy-based score on their own.",
    stripObsidianMarkup(marketIntelText),
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
    // Protect escaped pipes inside wikilink aliases ("[[Target\|Display]]") so
    // they don't get treated as column separators, then restore them.
    const cells = t
      .replace(/\\\|/g, "§PIPE§")
      .split("|")
      .map((c) => c.replace(/§PIPE§/g, "|").trim());
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

/** Strip a trailing product code parenthetical, e.g. "The War Room (WAR)" -> "The War Room". */
export function stripProductCode(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export interface CanonicalEntities {
  gurus: string[];
  publishers: string[];
  products: string[];
}

let _canonCache: { at: number; data: CanonicalEntities } | null = null;

/**
 * The canonical guru / publisher / product entities from the brain's Financial
 * Publishing Directory. These are the names the brain uses (note titles), so
 * storing them on a review lets the brain link everything uniformly via
 * [[wikilinks]]. Hosts (e.g. Chris Johnson) are excluded from the guru list.
 * Cached 5 min; returns empty lists gracefully if the directory is unavailable.
 */
export async function getCanonicalEntities(): Promise<CanonicalEntities> {
  const now = Date.now();
  if (_canonCache && now - _canonCache.at < 300_000) return _canonCache.data;

  const rows = parseDirectory(await loadPublishingDirectory());
  const gurus = new Set<string>();
  const publishers = new Set<string>();
  const products = new Set<string>();
  // A cell that's only a parenthetical note (e.g. "(independent)") isn't a real entity.
  const isJunk = (s: string) => !s || s.startsWith("(");
  for (const r of rows) {
    // Co-authored cells like "Alexander Green + Marc Lichtenfeld" → individual gurus.
    for (const g of r.guru.split(/\s+[+&]\s+/).map((x) => x.trim())) {
      if (!isJunk(g) && !NON_GURU_HOSTS.has(g)) gurus.add(g);
    }
    if (!isJunk(r.parent)) publishers.add(r.parent);
    if (r.publication) {
      const p = stripProductCode(r.publication);
      if (!isJunk(p)) products.add(p);
    }
  }
  const srt = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  const data: CanonicalEntities = {
    gurus: srt(gurus),
    publishers: srt(publishers),
    products: srt(products),
  };
  _canonCache = { at: now, data };
  return data;
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
