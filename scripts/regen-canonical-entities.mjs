#!/usr/bin/env node
/**
 * Regenerate lib/canonical-entities.json from the live Financial Publishing Directory.
 *
 * Usage:
 *   node scripts/regen-canonical-entities.mjs --from /path/to/Financial\ Publishing\ Directory.md
 *   BRAIN_DIR=/path/to/brain node scripts/regen-canonical-entities.mjs
 *
 * Writes lib/canonical-entities.json. Does not commit.
 *
 * Rules:
 * - One clean product/publisher/guru name per cell (wikilinks stripped).
 * - FORMER directory rows keep publicationPublisher for attribution, but
 *   guruPublisher prefers the newest non-FORMER parent (Matt → MTA).
 * - publicationGurus only gets clean product keys (no prose / wikilink junk).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "lib", "canonical-entities.json");

function cleanCell(cell) {
  return cell
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

function stripCode(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function normKey(s) {
  return stripCode(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function parseArgs(argv) {
  const out = { from: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--from") out.from = argv[++i];
  }
  return out;
}

function resolveDirectoryPath(fromArg) {
  if (fromArg) return path.resolve(fromArg);
  if (process.env.BRAIN_DIR) {
    return path.join(
      process.env.BRAIN_DIR.replace(/\/(Resources|Areas)\/.*$/, ""),
      "Resources",
      "Financial Publishing Directory.md"
    );
  }
  // Sibling clone convention used by this workspace
  const sibling = path.resolve(ROOT, "..", "brain", "Resources", "Financial Publishing Directory.md");
  if (fs.existsSync(sibling)) return sibling;
  throw new Error(
    "Pass --from <Directory.md> or set BRAIN_DIR to the brain vault root."
  );
}

function parseDirectory(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t
      .replace(/\\\|/g, "§PIPE§")
      .split("|")
      .map((c) => c.replace(/§PIPE§/g, "|").trim());
    if (cells.length < 4) continue;
    const guru = cleanCell(cells[1] ?? "");
    const publication = cleanCell(cells[2] ?? "");
    const parent = cleanCell(cells[3] ?? "");
    const confidence = cleanCell(cells[6] ?? "");
    if (!guru || /^guru$/i.test(guru) || /^-+$/.test(guru)) continue;
    if (!publication || !parent) continue;
    if (parent.startsWith("(")) continue;
    rows.push({
      gurus: guru.split(/\s+[+&]\s+/).map((g) => g.trim()).filter(Boolean),
      publication: stripCode(publication),
      parent: stripCode(parent),
      former: /former/i.test(confidence),
    });
  }
  return rows;
}

function build(rows) {
  const gurus = new Set();
  const publishers = new Set();
  const products = new Set();
  /** @type {Record<string, string>} */
  const guruPublisher = {};
  /** @type {Record<string, string>} */
  const publicationPublisher = {};
  /** @type {Record<string, Set<string>>} */
  const publicationGurus = {};

  // First pass: non-FORMER rows win for guruPublisher
  for (const r of rows) {
    if (r.former) continue;
    publishers.add(r.parent);
    if (r.publication) {
      products.add(r.publication);
      publicationPublisher[normKey(r.publication)] = r.parent;
      const set = (publicationGurus[normKey(r.publication)] ??= new Set());
      for (const g of r.gurus) {
        gurus.add(g);
        set.add(g);
        guruPublisher[normKey(g)] = r.parent;
      }
    } else {
      for (const g of r.gurus) {
        gurus.add(g);
        guruPublisher[normKey(g)] = r.parent;
      }
    }
  }

  // Second pass: FORMER rows fill gaps only (era-accurate product attribution)
  for (const r of rows) {
    if (!r.former) continue;
    publishers.add(r.parent);
    if (r.publication) {
      products.add(r.publication);
      if (!publicationPublisher[normKey(r.publication)]) {
        publicationPublisher[normKey(r.publication)] = r.parent;
      }
      const set = (publicationGurus[normKey(r.publication)] ??= new Set());
      for (const g of r.gurus) {
        gurus.add(g);
        set.add(g);
        // Do NOT overwrite guruPublisher with FORMER parent (Matt stays MTA)
        if (!guruPublisher[normKey(g)]) guruPublisher[normKey(g)] = r.parent;
      }
    }
  }

  // Force Matt → MTA even if ordering odd
  if (gurus.has("Matt McCall") || guruPublisher["matt mccall"]) {
    gurus.add("Matt McCall");
    guruPublisher["matt mccall"] = "Monument Traders Alliance";
  }

  const srt = (s) => [...s].sort((a, b) => a.localeCompare(b));
  const pubGurusOut = {};
  for (const [k, set] of Object.entries(publicationGurus)) {
    // Skip pathological keys (prose leftovers) — keys must be short-ish product names
    if (k.length > 80 || /[;→\]]/.test(k) || k.includes("confirmed") || k.startsWith("[[")) continue;
    pubGurusOut[k] = srt(set);
  }

  return {
    gurus: srt(gurus),
    publishers: srt(publishers),
    products: srt(products),
    guruPublisher,
    publicationPublisher,
    publicationGurus: Object.fromEntries(
      Object.entries(pubGurusOut).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
}

const args = parseArgs(process.argv);
const dirPath = resolveDirectoryPath(args.from);
const text = fs.readFileSync(dirPath, "utf8");
const rows = parseDirectory(text);
if (rows.length < 10) {
  console.error(`Refusing to write: only ${rows.length} rows parsed from ${dirPath}`);
  process.exit(1);
}
const data = build(rows);
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  rows=${rows.length} gurus=${data.gurus.length} publishers=${data.publishers.length} products=${data.products.length}`);
console.log(`  matt mccall → ${data.guruPublisher["matt mccall"]}`);
console.log(`  publicationGurus keys=${Object.keys(data.publicationGurus).length}`);
