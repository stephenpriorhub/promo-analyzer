/**
 * Entity overrides — the publisher's manual corrections to the entity graph
 * (gurus / products / publishers), persisted on the data volume and consulted
 * by every resolver. This is how "merging teaches the brain": a merge becomes a
 * durable alias that all FUTURE attribution applies automatically, and the
 * assignment overrides beat the directory (Stephen's word > inferred data).
 *
 *   aliases.gurus:      "alex green" -> "Alexander Green"   (merge/rename)
 *   aliases.products:   old name     -> canonical name
 *   aliases.publishers: old name     -> canonical name
 *   guruPublisher:      "alexander green" -> "The Oxford Club"   (reassignment)
 *   productPublisher:   normalized product -> publisher           (reassignment)
 *   pubCodes:           normalized product -> Agora pub code
 */

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "entity-overrides.json");

export type EntityKind = "guru" | "product" | "publisher";

export interface EntityOverrides {
  aliases: { gurus: Record<string, string>; products: Record<string, string>; publishers: Record<string, string> };
  guruPublisher: Record<string, string>;
  productPublisher: Record<string, string>;
  pubCodes: Record<string, string>;
}

const EMPTY: EntityOverrides = {
  aliases: { gurus: {}, products: {}, publishers: {} },
  guruPublisher: {},
  productPublisher: {},
  pubCodes: {},
};

export function normKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function readOverrides(): EntityOverrides {
  try {
    if (!fs.existsSync(FILE)) return structuredClone(EMPTY);
    const raw = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Partial<EntityOverrides>;
    return {
      aliases: {
        gurus: raw.aliases?.gurus ?? {},
        products: raw.aliases?.products ?? {},
        publishers: raw.aliases?.publishers ?? {},
      },
      guruPublisher: raw.guruPublisher ?? {},
      productPublisher: raw.productPublisher ?? {},
      pubCodes: raw.pubCodes ?? {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function writeOverrides(o: EntityOverrides) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(o, null, 2), "utf-8");
}

const KIND_MAP: Record<EntityKind, keyof EntityOverrides["aliases"]> = {
  guru: "gurus",
  product: "products",
  publisher: "publishers",
};

/**
 * Record a merge/rename: every future occurrence of `from` resolves to `to`.
 * Follows existing chains so aliases never point at another alias.
 */
export function addAlias(kind: EntityKind, from: string, to: string): EntityOverrides {
  const o = readOverrides();
  const table = o.aliases[KIND_MAP[kind]];
  const target = resolveAliasIn(table, to); // collapse chains
  table[normKey(from)] = target;
  // Re-point anything that aliased to `from`
  for (const [k, v] of Object.entries(table)) {
    if (normKey(v) === normKey(from)) table[k] = target;
  }
  writeOverrides(o);
  return o;
}

export function setGuruPublisher(guru: string, publisher: string | null): EntityOverrides {
  const o = readOverrides();
  if (publisher) o.guruPublisher[normKey(guru)] = publisher;
  else delete o.guruPublisher[normKey(guru)];
  writeOverrides(o);
  return o;
}

export function setProductPublisher(product: string, publisher: string | null): EntityOverrides {
  const o = readOverrides();
  if (publisher) o.productPublisher[normKey(product)] = publisher;
  else delete o.productPublisher[normKey(product)];
  writeOverrides(o);
  return o;
}

export function setPubCode(product: string, code: string | null): EntityOverrides {
  const o = readOverrides();
  if (code && code.trim()) o.pubCodes[normKey(product)] = code.trim();
  else delete o.pubCodes[normKey(product)];
  writeOverrides(o);
  return o;
}

function resolveAliasIn(table: Record<string, string>, name: string): string {
  let cur = name;
  const seen = new Set<string>();
  while (table[normKey(cur)] && !seen.has(normKey(cur))) {
    seen.add(normKey(cur));
    cur = table[normKey(cur)];
  }
  return cur;
}

/** Resolve a name through the alias table for its kind (chain-safe). */
export function resolveAlias(kind: EntityKind, name: string): string {
  return resolveAliasIn(readOverrides().aliases[KIND_MAP[kind]], name);
}
