import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

const BRAIN_DIR = "/Users/stephenprior/Documents/github/brain";

/**
 * Scan the brain vault and extract all unique tags that match known
 * namespaces: person/, publisher/, publications/.../people/,
 * publications/.../product/, topic/
 */
function scanVaultTags(): {
  people: string[];
  products: string[];
  publishers: string[];
  topics: string[];
} {
  const people = new Set<string>();
  const products = new Set<string>();
  const publishers = new Set<string>();
  const topics = new Set<string>();

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
        // Parse YAML frontmatter tags line
        const tagMatch = content.match(/^tags:\s*\[([^\]]*)\]/m);
        if (!tagMatch) continue;
        const tags = tagMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, ""));
        for (const tag of tags) {
          if (tag.match(/\/people\//)) people.add(tag);
          else if (tag.match(/\/product\//)) products.add(tag);
          else if (tag.startsWith("publisher/")) publishers.add(tag);
          else if (tag.startsWith("person/")) people.add(tag);
          else if (tag.startsWith("topic/")) topics.add(tag);
          else if (tag.startsWith("publications/agora/oxford-group/monument-traders-alliance") && !tag.includes("/")) {
            publishers.add(tag);
          }
        }
      } catch { continue; }
    }
  }

  walk(BRAIN_DIR);
  return {
    people: [...people].sort(),
    products: [...products].sort(),
    publishers: [...publishers].sort(),
    topics: [...topics].sort(),
  };
}

const PROMPT = `You are tagging a financial promo note for an Obsidian vault. Return a JSON object with suggested tags based on the promo content and the vault's existing tag vocabulary.

## Vault's Existing Tags

### People (use these exact strings when there's a clear match)
{PEOPLE_TAGS}

### Products (use these exact strings when there's a clear match)
{PRODUCT_TAGS}

### Publishers (use these exact strings when there's a clear match)
{PUBLISHER_TAGS}

### Topics (use these or create new ones in topic/[slug] format)
{TOPIC_TAGS}

## Promo Details
Filename: {FILENAME}
Promo type: {PROMO_TYPE}
Headline section:
{HEADLINE}

Offer section:
{OFFER}

## Tag Rules
- promoTypeTags: derive from promo type. front-end → ["front-end"]. back-end + live webinar → ["back-end", "live-webinar"]. back-end + VSL → ["back-end", "vsl"]. mega-bundle + live webinar → ["mega-bundle", "live-webinar"]. mega-bundle + VSL → ["mega-bundle", "vsl"]. Unknown → [].
- peopleTags: identify the presenter/guru/analyst from the content. Use existing vault tags if they match. For MTA people use the full publications/... path. For external people use person/firstname-lastname (lowercase, hyphenated). Only include people clearly identified in the content. Max 2-3 people.
- productTag: if this is an MTA product, identify its code (e.g. TPU, PSU, DPL, WAR, WNM, PMK, MIC, DPS, NBS) and use publications/agora/oxford-group/monument-traders-alliance/product/[CODE]. Also include the lowercase code as a flat tag (e.g. "tpu"). If not an MTA product, omit.
- publisherTag: publications/agora/oxford-group/monument-traders-alliance for MTA promos. For external, use existing publisher/ tag or create publisher/[name] (lowercase, hyphenated).
- topicTags: 1-3 tags capturing the core investment theme or hook (e.g. topic/options-trading, topic/ai, topic/elon-musk, topic/ipo, topic/energy, topic/crypto). Use existing topic/ tags if relevant, create new ones otherwise.

Return ONLY valid JSON, no explanation:
{
  "promoTypeTags": [],
  "peopleTags": [],
  "productTag": "",
  "productCodeTag": "",
  "publisherTag": "",
  "topicTags": []
}

If a field has no value, use "" for strings and [] for arrays.`;

export async function POST(req: NextRequest) {
  const { filename, promoType, sections } = await req.json();

  const vaultTags = scanVaultTags();

  const prompt = PROMPT
    .replace("{PEOPLE_TAGS}", vaultTags.people.join("\n") || "(none yet)")
    .replace("{PRODUCT_TAGS}", vaultTags.products.join("\n") || "(none yet)")
    .replace("{PUBLISHER_TAGS}", vaultTags.publishers.join("\n") || "(none yet)")
    .replace("{TOPIC_TAGS}", vaultTags.topics.join("\n") || "(none yet)")
    .replace("{FILENAME}", filename ?? "unknown")
    .replace("{PROMO_TYPE}", promoType ?? "unknown")
    .replace("{HEADLINE}", (sections?.headline ?? "").slice(0, 600))
    .replace("{OFFER}", (sections?.offer ?? "").slice(0, 800));

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

  // Build flat tag list in logical order
  const tags: string[] = ["promo"];

  const promoTypeTags = (structured.promoTypeTags as string[]) ?? [];
  const peopleTags = (structured.peopleTags as string[]) ?? [];
  const productTag = (structured.productTag as string) ?? "";
  const productCodeTag = (structured.productCodeTag as string) ?? "";
  const publisherTag = (structured.publisherTag as string) ?? "";
  const topicTags = (structured.topicTags as string[]) ?? [];

  if (productCodeTag) tags.push(productCodeTag);
  if (productTag) tags.push(productTag);
  for (const p of peopleTags) if (p) tags.push(p);
  if (publisherTag) tags.push(publisherTag);
  for (const t of promoTypeTags) if (t) tags.push(t);
  tags.push("copywriting", "analysis");
  for (const t of topicTags) if (t) tags.push(t);

  return NextResponse.json({ tags, structured });
}
