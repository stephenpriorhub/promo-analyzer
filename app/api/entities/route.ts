/**
 * Entity directory API — the publisher → gurus / products graph.
 *
 * GET  — linked structure from the Financial Publishing Directory (live ∪
 *        snapshot) ∪ values used on reviews, with the publisher's overrides
 *        applied and per-entity review counts.
 * POST — corrections, all durable:
 *   {action:"merge",  kind:"guru"|"product"|"publisher", from, to}
 *   {action:"rename", kind, from, to}          (same mechanics as merge)
 *   {action:"assign", kind:"guru"|"product", name, publisher}
 *   {action:"setPubCode", product, code}
 * Merges/renames also rewrite existing reviews so past data is corrected, and
 * are recorded to the brain vault (Entity Merges note) so the correction is
 * learned, not just applied.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCanonicalEntities,
  parseDirectory,
  loadPublishingDirectory,
  stripProductCode,
  canonicalGuruName,
} from "@/lib/brain-reader";
import {
  readOverrides,
  addAlias,
  setGuruPublisher,
  setProductPublisher,
  setProductGurus,
  setPubCode,
  removeEntity,
  restoreEntity,
  resolveAlias,
  normKey,
  type EntityKind,
  type EntityOverrides,
} from "@/lib/entity-overrides";
import { getAllReviews, applyEntityMerge } from "@/lib/reviews-store";
import { getHubUser, isHubAdmin, forbidden } from "@/lib/hub-auth";
import { writeBrainNote } from "@/lib/brain-writer";
import canonicalSnapshot from "@/lib/canonical-entities.json";

export const runtime = "nodejs";

interface ProductEntry {
  name: string;
  pubCode: string;
  reviewCount: number;
  /** Gurus on this product — products can have several (e.g. The War Room:
   * Bryan + Karim; publisher direction 2026-07-03). A manual assignment
   * replaces every derived guru. */
  gurus: string[];
}
interface GuruEntry {
  name: string;
  reviewCount: number;
}
interface PublisherGroup {
  name: string;
  gurus: GuruEntry[];
  products: ProductEntry[];
  reviewCount: number;
}

async function buildGraph(): Promise<{ publishers: PublisherGroup[]; unassigned: { gurus: GuruEntry[]; products: ProductEntry[] } }> {
  const o = readOverrides();
  const canonGuru = (g: string) => canonicalGuruName(g);
  const canonProduct = (p: string) => resolveAlias("product", stripProductCode(p));
  const canonPublisher = (p: string) => resolveAlias("publisher", p);

  const isRemoved = (kind: keyof EntityOverrides["removed"], name: string) =>
    o.removed[kind].includes(normKey(name));

  // guru → publisher and product → publisher: snapshot seeds (works offline /
  // when the live directory fetch fails), live directory rows override.
  // product → gurus (plural) comes from the same sources; a manual assignment
  // REPLACES the derived set.
  const guruPub = new Map<string, string>();
  const productPub = new Map<string, string>();
  const productGurus = new Map<string, Set<string>>();
  const addProductGuru = (pk: string, guru: string) => {
    const set = productGurus.get(pk) ?? new Set<string>();
    set.add(guru);
    productGurus.set(pk, set);
  };
  const snap = canonicalSnapshot as {
    guruPublisher?: Record<string, string>;
    publicationPublisher?: Record<string, string>;
    publicationGurus?: Record<string, string[]>;
  };
  for (const [g, pub] of Object.entries(snap.guruPublisher ?? {})) guruPub.set(normKey(g), canonPublisher(pub));
  for (const [p, pub] of Object.entries(snap.publicationPublisher ?? {})) productPub.set(normKey(p), canonPublisher(pub));
  for (const [p, gs] of Object.entries(snap.publicationGurus ?? {})) {
    for (const g of gs) addProductGuru(normKey(p), canonGuru(g));
  }
  const rows = parseDirectory(await loadPublishingDirectory());
  for (const r of rows) {
    const parent = canonPublisher(stripProductCode(r.parent));
    if (!parent || parent.startsWith("(")) continue;
    const rowGurus: string[] = [];
    for (const g0 of r.guru.split(/\s+[+&]\s+/)) {
      const g = canonGuru(g0.trim());
      if (g && !g.startsWith("(")) {
        guruPub.set(normKey(g), parent);
        rowGurus.push(g);
      }
    }
    if (r.publication) {
      const p = canonProduct(r.publication);
      if (p) {
        productPub.set(normKey(p), parent);
        for (const g of rowGurus) addProductGuru(normKey(p), g);
      }
    }
  }
  // Universe of names: directory/snapshot ∪ review-used values (aliased)
  const canon = await getCanonicalEntities();
  const reviews = getAllReviews();

  // Review co-occurrence adds to the directory seed: what Stephen entered on
  // analyzed promos (product + gurus) IS the matching — products can carry
  // multiple gurus, so every guru he tagged joins the product's set.
  for (const r of reviews) {
    if (!r.product || !(r.gurus ?? []).length) continue;
    const pk = normKey(canonProduct(r.product));
    for (const g0 of r.gurus ?? []) {
      const g = canonGuru(g0);
      if (g && !g.startsWith("(")) addProductGuru(pk, g);
    }
  }

  // Manual assignments override everything; a productGurus key REPLACES the
  // whole derived set (empty list = explicitly none).
  for (const [g, pub] of Object.entries(o.guruPublisher)) guruPub.set(g, canonPublisher(pub));
  for (const [p, pub] of Object.entries(o.productPublisher)) productPub.set(p, canonPublisher(pub));
  for (const [p, gs] of Object.entries(o.productGurus)) {
    productGurus.set(p, new Set(gs.map((g) => canonGuru(g)).filter((g) => g && !g.startsWith("("))));
  }
  const guruNames = new Map<string, string>(); // normKey → display
  const productNames = new Map<string, string>();
  const publisherNames = new Map<string, string>();
  const addG = (g: string) => { const c = canonGuru(g); if (c && !c.startsWith("(") && !isRemoved("gurus", c)) guruNames.set(normKey(c), c); };
  const addP = (p: string) => { const c = canonProduct(p); if (c && !c.startsWith("(") && !isRemoved("products", c)) productNames.set(normKey(c), c); };
  const addPub = (p: string) => { const c = canonPublisher(p); if (c && !c.startsWith("(") && !isRemoved("publishers", c)) publisherNames.set(normKey(c), c); };
  canon.gurus.forEach(addG);
  canon.products.forEach(addP);
  canon.publishers.forEach(addPub);
  for (const r of reviews) {
    (r.gurus ?? []).forEach(addG);
    if (r.product) addP(r.product);
    if (r.publisher) addPub(r.publisher);
  }

  // Review counts per canonical entity
  const guruCount = new Map<string, number>();
  const productCount = new Map<string, number>();
  const publisherCount = new Map<string, number>();
  for (const r of reviews) {
    for (const g of r.gurus ?? []) {
      const k = normKey(canonGuru(g));
      guruCount.set(k, (guruCount.get(k) ?? 0) + 1);
    }
    if (r.product) {
      const k = normKey(canonProduct(r.product));
      productCount.set(k, (productCount.get(k) ?? 0) + 1);
    }
    if (r.publisher) {
      const k = normKey(canonPublisher(r.publisher));
      publisherCount.set(k, (publisherCount.get(k) ?? 0) + 1);
    }
  }

  const groups = new Map<string, PublisherGroup>();
  const groupFor = (pub: string): PublisherGroup => {
    const k = normKey(pub);
    if (!groups.has(k)) {
      groups.set(k, { name: pub, gurus: [], products: [], reviewCount: publisherCount.get(k) ?? 0 });
      publisherNames.set(k, pub);
    }
    return groups.get(k)!;
  };
  for (const [, name] of publisherNames) groupFor(name);

  const unassigned: { gurus: GuruEntry[]; products: ProductEntry[] } = { gurus: [], products: [] };
  for (const [k, name] of guruNames) {
    const entry: GuruEntry = { name, reviewCount: guruCount.get(k) ?? 0 };
    const pub = guruPub.get(k);
    // A removed publisher never resurrects as a group — its entities go unassigned.
    if (pub && !isRemoved("publishers", pub)) groupFor(pub).gurus.push(entry);
    else unassigned.gurus.push(entry);
  }
  for (const [k, name] of productNames) {
    const gs = [...(productGurus.get(k) ?? [])].filter((g) => !isRemoved("gurus", g)).sort();
    const entry: ProductEntry = {
      name,
      pubCode: o.pubCodes[k] ?? "",
      reviewCount: productCount.get(k) ?? 0,
      gurus: gs,
    };
    const pub = productPub.get(k);
    if (pub && !isRemoved("publishers", pub)) groupFor(pub).products.push(entry);
    else unassigned.products.push(entry);
  }

  const srt = <T extends { name: string }>(a: T[]) => a.sort((x, y) => x.name.localeCompare(y.name));
  const publishers = [...groups.values()]
    .map((g) => ({ ...g, gurus: srt(g.gurus), products: srt(g.products) }))
    .sort((a, b) => b.reviewCount - a.reviewCount || a.name.localeCompare(b.name));
  return { publishers, unassigned: { gurus: srt(unassigned.gurus), products: srt(unassigned.products) } };
}

export async function GET() {
  const graph = await buildGraph();
  // Hidden entities ride along so the UI can offer restore (accidental ✕).
  const o = readOverrides();
  return NextResponse.json({
    ...graph,
    removed: [
      ...o.removed.gurus.map((n) => ({ kind: "guru" as const, name: n })),
      ...o.removed.products.map((n) => ({ kind: "product" as const, name: n })),
      ...o.removed.publishers.map((n) => ({ kind: "publisher" as const, name: n })),
    ],
  });
}

const KINDS = new Set(["guru", "product", "publisher"]);

export async function POST(req: NextRequest) {
  // Directory corrections (merge/rename/remove/assign) rewrite past reviews and
  // teach every future resolver — hub admins only.
  if (!isHubAdmin(await getHubUser(req))) return forbidden("Only OxfordHub Admins can edit the directory.");
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    kind?: string;
    from?: string;
    to?: string;
    name?: string;
    publisher?: string;
    product?: string;
    code?: string;
  };

  if (body.action === "merge" || body.action === "rename") {
    const { kind, from, to } = body;
    if (!kind || !KINDS.has(kind) || !from?.trim() || !to?.trim()) {
      return NextResponse.json({ error: "kind, from, to required" }, { status: 400 });
    }
    if (normKey(from) === normKey(to)) {
      return NextResponse.json({ error: "from and to are the same" }, { status: 400 });
    }
    addAlias(kind as EntityKind, from.trim(), to.trim());
    // Correct past data too
    const rewritten = applyEntityMerge(kind as EntityKind, from.trim(), to.trim());
    // Teach the brain: durable record of the correction (graceful, non-blocking)
    void writeBrainNote(
      "Entity Merges",
      buildMergeNote(),
      "promo-analysis-tool"
    );
    return NextResponse.json({ ok: true, rewrittenReviews: rewritten });
  }

  if (body.action === "assign") {
    const { kind, name, publisher } = body;
    if ((kind !== "guru" && kind !== "product") || !name?.trim()) {
      return NextResponse.json({ error: "kind (guru|product) and name required" }, { status: 400 });
    }
    if (kind === "guru") setGuruPublisher(name.trim(), publisher?.trim() || null);
    else setProductPublisher(name.trim(), publisher?.trim() || null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "setPubCode") {
    if (!body.product?.trim()) return NextResponse.json({ error: "product required" }, { status: 400 });
    setPubCode(body.product.trim(), body.code ?? null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "setProductGurus") {
    const { product, gurus } = body as { product?: string; gurus?: unknown };
    if (!product?.trim() || !Array.isArray(gurus) || gurus.some((g) => typeof g !== "string")) {
      return NextResponse.json({ error: "product and gurus[] required" }, { status: 400 });
    }
    setProductGurus(product.trim(), gurus as string[]);
    void writeBrainNote("Entity Merges", buildMergeNote(), "promo-analysis-tool");
    return NextResponse.json({ ok: true });
  }

  if (body.action === "remove") {
    const { kind, name } = body;
    if (!kind || !KINDS.has(kind) || !name?.trim()) {
      return NextResponse.json({ error: "kind and name required" }, { status: 400 });
    }
    removeEntity(kind as EntityKind, name.trim());
    void writeBrainNote("Entity Merges", buildMergeNote(), "promo-analysis-tool");
    return NextResponse.json({ ok: true });
  }

  if (body.action === "restore") {
    const { kind, name } = body;
    if (!kind || !KINDS.has(kind) || !name?.trim()) {
      return NextResponse.json({ error: "kind and name required" }, { status: 400 });
    }
    restoreEntity(kind as EntityKind, name.trim());
    void writeBrainNote("Entity Merges", buildMergeNote(), "promo-analysis-tool");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** Render the full current alias/assignment state as a vault note body. */
function buildMergeNote(): string {
  const o = readOverrides();
  const lines: string[] = [
    "# Entity Merges & Corrections",
    "",
    "Publisher-made corrections from the Promo Analyzer Directory page. These are",
    "durable: every resolver (guru matching, publisher attribution) applies them.",
    `Last updated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "## Merged / renamed",
  ];
  for (const [kind, table] of Object.entries(o.aliases)) {
    for (const [from, to] of Object.entries(table)) lines.push(`- ${kind}: "${from}" → **${to}**`);
  }
  lines.push("", "## Manual publisher assignments");
  for (const [g, p] of Object.entries(o.guruPublisher)) lines.push(`- guru "${g}" → **${p}**`);
  for (const [pr, p] of Object.entries(o.productPublisher)) lines.push(`- product "${pr}" → **${p}**`);
  lines.push("", "## Product → guru assignments (products can have multiple gurus)");
  for (const [pr, gs] of Object.entries(o.productGurus)) lines.push(`- product "${pr}" → **${gs.join(", ") || "(none)"}**`);
  lines.push("", "## Removed from directory (reviews keep their data)");
  for (const [kind, names] of Object.entries(o.removed)) {
    for (const n of names) lines.push(`- ${kind.replace(/s$/, "")}: "${n}"`);
  }
  lines.push("", "## Pub codes");
  for (const [pr, c] of Object.entries(o.pubCodes)) lines.push(`- ${pr}: \`${c}\``);
  return lines.join("\n") + "\n";
}
