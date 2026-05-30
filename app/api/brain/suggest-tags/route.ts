import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

const BRAIN_DIR = "/Users/stephenprior/Documents/github/brain";

/**
 * Parse all tags from a YAML frontmatter block.
 * Handles both inline array format (tags: [a, b]) and
 * YAML block sequence format (tags:\n  - a\n  - b).
 * Also extracts from people: and topic_areas: fields.
 */
function extractTagsFromFrontmatter(content: string): string[] {
  const tags: string[] = [];

  // Match the frontmatter block (between --- delimiters)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return tags;
  const fm = fmMatch[1];

  // Helper: parse a YAML field that is either inline array or block sequence
  function parseYamlList(fieldName: string): string[] {
    const results: string[] = [];

    // Inline: fieldName: [a, b, c]
    const inlineMatch = fm.match(new RegExp(`^${fieldName}:\\s*\\[([^\\]]*)\\]`, "m"));
    if (inlineMatch) {
      inlineMatch[1].split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
        .forEach((t) => results.push(t));
      return results;
    }

    // Block sequence: fieldName:\n  - item
    const blockMatch = fm.match(
      new RegExp(`^${fieldName}:\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, "m")
    );
    if (blockMatch) {
      blockMatch[1]
        .split("\n")
        .map((l) => l.replace(/^[ \t]+-\s*/, "").trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
        .forEach((t) => results.push(t));
    }
    return results;
  }

  // Gather from tags, topic_areas, and people fields
  parseYamlList("tags").forEach((t) => tags.push(t));
  parseYamlList("topic_areas").forEach((t) => tags.push(`topic/${t}`));
  parseYamlList("people").forEach((t) => {
    // Convert "First Last" → person/first-last
    const slug = t.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (slug) tags.push(`person/${slug}`);
  });

  return tags;
}

/**
 * Scan the brain vault and collect the current active tag vocabulary
 * across all relevant namespaces.
 */
function scanVaultTags(): {
  people: string[];
  publishers: string[];
  orgs: string[];
  topics: string[];
  promoTypes: string[];
} {
  const people = new Set<string>();
  const publishers = new Set<string>();
  const orgs = new Set<string>();
  const topics = new Set<string>();
  const promoTypes = new Set<string>();

  // Known content_type values from auto-tagged system
  const PROMO_TYPE_ENUMS = new Set([
    "fe-live-webinar", "fe-vsl", "be-live-webinar", "be-vsl",
    "mega-bundle-live-webinar", "mega-bundle-vsl", "external-competitor",
  ]);

  function walk(dir: string) {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) { walk(full); continue; }
        if (!entry.endsWith(".md")) continue;
        const content = fs.readFileSync(full, "utf-8");

        const tags = extractTagsFromFrontmatter(content);
        for (const tag of tags) {
          if (tag.startsWith("person/"))    people.add(tag);
          else if (tag.startsWith("publisher/")) publishers.add(tag);
          else if (tag.startsWith("org/"))   orgs.add(tag);
          else if (tag.startsWith("topic/")) topics.add(tag);
          else if (PROMO_TYPE_ENUMS.has(tag)) promoTypes.add(tag);
        }

        // Also capture content_type field directly
        const ctMatch = content.match(/^content_type:\s*["']?([^\n"']+)["']?/m);
        if (ctMatch) {
          const ct = ctMatch[1].trim();
          if (PROMO_TYPE_ENUMS.has(ct)) promoTypes.add(ct);
        }
      } catch { continue; }
    }
  }

  walk(BRAIN_DIR);

  return {
    people: [...people].sort(),
    publishers: [...publishers].sort(),
    orgs: [...orgs].sort(),
    topics: [...topics].sort(),
    promoTypes: [...promoTypes].sort(),
  };
}

const PROMPT = `You are tagging a financial promo note in an Obsidian vault. Use the vault's CURRENT tag vocabulary shown below.

## Current Tag Vocabulary (from vault)

### Person tags (person/firstname-lastname)
{PEOPLE_TAGS}

### Publisher tags (publisher/name)
{PUBLISHER_TAGS}

### Org tags
{ORG_TAGS}

### Topic tags (topic/slug)
{TOPIC_TAGS}

### Promo type tags (from content_type field in vault)
{PROMO_TYPE_TAGS}

## Promo to Tag
Filename: {FILENAME}
Promo type selected by user: {PROMO_TYPE}

Headline:
{HEADLINE}

Offer section:
{OFFER}

## Rules
**promoTypeTag**: Map user's promo type to the vault's content_type enum:
- "Front-end" → "fe-vsl" (if written VSL) or "fe-live-webinar" (if webinar)
- "Backend Live Webinar" → "be-live-webinar"
- "Backend VSL" → "be-vsl"
- "Mega-Bundle Live Webinar" → "mega-bundle-live-webinar"
- "Mega-Bundle VSL" → "mega-bundle-vsl"
- Unknown → ""
Infer VSL vs live-webinar from the content if ambiguous.

**peopleTags**: Identify the main presenter/analyst/guru. Use existing person/ tags if they match. Create new ones as person/firstname-lastname (lowercase, hyphenated). MTA people: person/bryan-bottarelli, person/nate-bear, person/karim-rahemtulla, person/ryan-fitzwater. Max 2 people.

**productCodeTag**: If MTA product, identify the 2-4 letter code (DPL, TPU, PSU, WAR, WNM, PMK, MIC, DPS, NBS, etc.) as a lowercase flat tag (e.g. "dpl"). Empty string if not MTA.

**publisherTag**: For MTA promos use "publisher/monument-traders-alliance". For external use existing publisher/ tag or create publisher/name (lowercase, hyphenated). Empty string if unclear.

**orgTag**: For anything in the Agora universe use "org/agora". For Oxford Group specifically use "org/oxford-group". Empty string otherwise.

**topicTags**: 1-3 topic tags capturing the investment theme. Use existing topic/ tags when they match. Create new ones as topic/slug. Examples: topic/options-trading, topic/ai-investing, topic/macro, topic/ipo, topic/commodities, topic/crypto, topic/income-investing, topic/retirement.

Return ONLY valid JSON:
{
  "promoTypeTag": "",
  "peopleTags": [],
  "productCodeTag": "",
  "publisherTag": "",
  "orgTag": "",
  "topicTags": []
}`;

export async function POST(req: NextRequest) {
  const { filename, promoType, sections } = await req.json();

  const vaultTags = scanVaultTags();

  const prompt = PROMPT
    .replace("{PEOPLE_TAGS}",     vaultTags.people.join("\n")      || "(none yet — create as person/firstname-lastname)")
    .replace("{PUBLISHER_TAGS}",  vaultTags.publishers.join("\n")  || "(none yet — create as publisher/name)")
    .replace("{ORG_TAGS}",        vaultTags.orgs.join("\n")        || "(none yet)")
    .replace("{TOPIC_TAGS}",      vaultTags.topics.join("\n")      || "(none yet — create as topic/slug)")
    .replace("{PROMO_TYPE_TAGS}", vaultTags.promoTypes.join("\n")  || "(none yet)")
    .replace("{FILENAME}",        filename ?? "unknown")
    .replace("{PROMO_TYPE}",      promoType ?? "not specified")
    .replace("{HEADLINE}",        (sections?.headline ?? "").slice(0, 600))
    .replace("{OFFER}",           (sections?.offer ?? "").slice(0, 800));

  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "{}";
  let structured: Record<string, unknown>;
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}") + 1;
    structured = JSON.parse(raw.slice(jsonStart, jsonEnd));
  } catch {
    return NextResponse.json({ tags: ["promo", "copywriting", "analysis"] });
  }

  const promoTypeTag   = (structured.promoTypeTag as string)   ?? "";
  const peopleTags     = (structured.peopleTags as string[])   ?? [];
  const productCodeTag = (structured.productCodeTag as string) ?? "";
  const publisherTag   = (structured.publisherTag as string)   ?? "";
  const orgTag         = (structured.orgTag as string)         ?? "";
  const topicTags      = (structured.topicTags as string[])    ?? [];

  // Build tag list in logical order
  const tags: string[] = ["promo"];
  if (productCodeTag) tags.push(productCodeTag);
  for (const p of peopleTags) if (p) tags.push(p);
  if (publisherTag) tags.push(publisherTag);
  if (orgTag) tags.push(orgTag);
  if (promoTypeTag) tags.push(promoTypeTag);
  tags.push("copywriting", "analysis");
  for (const t of topicTags) if (t) tags.push(t);

  return NextResponse.json({ tags, structured });
}
