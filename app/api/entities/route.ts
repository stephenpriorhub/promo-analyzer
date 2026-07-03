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
  setProductGuru,
  setPubCode,
  removeEntity,
  resolveAlias,
  normKey,
  type EntityKind,
  type EntityOverrides,
} from "@/lib/entity-overrides";
import { getAllReviews, applyEntityMerge } from "@/lib/reviews-store";
import { writeBrainNote } from "@/lib/brain-writer";
import canonicalSnapshot from "@/lib/canonical-entities.json";

export const runtime = "nodejs";

interface ProductEntry {
  name: string;
  pubCode: string;
  reviewCount: number;
  /** Guru this product is assigned to ("" when none). Manual assignment beats the directory. */
  guru: string;
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
  // product → guru comes from the same directory rows; manual assignment wins.
  const guruPub = new Map<string, string>();
  const productPub = new Map<string, string>();
  const productGuru = new Map<string, string>();
  const snap = canonicalSnapshot as {
    guruPublisher?: Record<string, string>;
    publicationPublisher?: Record<string, string>;
    publicationGuru?: Record<string, string>;
  };
  for (const [g, pub] of Object.entries(snap.guruPublisher ?? {})) guruPub.set(normKey(g), canonPublisher(pub));
  for (const [p, pub] of Object.entries(snap.publicationPublisher ?? {})) productPub.set(normKey(p), canonPublisher(pub));
  for (const [p, g] of Object.entries(snap.publicationGuru ?? {})) productGuru.set(normKey(p), canonGuru(g));
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
        if (rowGurus[0]) productGuru.set(normKey(p), rowGurus[0]);
      }
    }
  }
  // Universe of names: directory/snapshot ∪ review-used values (aliased)
  const canon = await getCanonicalEntities();
  const reviews = getAllReviews();

  // Review co-occurrence beats the directory seed: what Stephen entered on
  // analyzed promos (product + gurus) IS the matching — each review is a vote,
  // the most frequent guru wins the product.
  const guruVotes = new Map<string, Map<string, { name: string; n: number }>>();
  for (const r of reviews) {
    if (!r.product || !(r.gurus ?? []).length) continue;
    const pk = normKey(canonProduct(r.product));
    const votes = guruVotes.get(pk) ?? new Map();
    for (const g0 of r.gurus ?? []) {
      const g = canonGuru(g0);
      if (!g || g.startsWith("(")) continue;
      const v = votes.get(normKey(g)) ?? { name: g, n: 0 };
      v.n += 1;
      votes.set(normKey(g), v);
    }
    guruVotes.set(pk, votes);
  }
  for (const [pk, votes] of guruVotes) {
    const top = [...votes.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0];
    if (top) productGuru.set(pk, top.name);
  }

  // Manual assignments override everything
  for (const [g, pub] of Object.entries(o.guruPublisher)) guruPub.set(g, canonPublisher(pub));
  for (const [p, pub] of Object.entries(o.productPublisher)) productPub.set(p, canonPublisher(pub));
  for (const [p, g] of Object.entries(o.productGuru)) productGuru.set(p, canonGuru(g));
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
    const g = productGuru.get(k);
    const entry: ProductEntry = {
      name,
      pubCode: o.pubCodes[k] ?? "",
      reviewCount: productCount.get(k) ?? 0,
      guru: g && !isRemoved("gurus", g) ? g : "",
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
  return NextResponse.json(await buildGraph());
}

const KINDS = new Set(["guru", "product", "publisher"]);

export async function POST(req: NextRequest) {
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

  if (body.action === "assignGuru") {
    const { product, guru } = body as { product?: string; guru?: string };
    if (!product?.trim()) return NextResponse.json({ error: "product required" }, { status: 400 });
    setProductGuru(product.trim(), guru?.trim() || null);
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
  lines.push("", "## Product → guru assignments");
  for (const [pr, g] of Object.entries(o.productGuru)) lines.push(`- product "${pr}" → **${g}**`);
  lines.push("", "## Removed from directory (reviews keep their data)");
  for (const [kind, names] of Object.entries(o.removed)) {
    for (const n of names) lines.push(`- ${kind.replace(/s$/, "")}: "${n}"`);
  }
  lines.push("", "## Pub codes");
  for (const [pr, c] of Object.entries(o.pubCodes)) lines.push(`- ${pr}: \`${c}\``);
  return lines.join("\n") + "\n";
}
