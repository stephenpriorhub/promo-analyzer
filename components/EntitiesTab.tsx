"use client";

/**
 * Directory tab — the entity graph in two views (publisher direction 2026-07-03):
 *   · Publications: publishers with their gurus and products (iSpyEmail-style)
 *   · Gurus: each guru with the products assigned to them
 * Inline editing everywhere:
 *   · rename an entity (persists as an alias — the brain learns the correction)
 *   · merge duplicates into a canonical name (past reviews rewritten, future
 *     attribution applies it automatically)
 *   · assign a guru/product to a publisher, and products to a guru
 *   · remove an entity from the directory (reviews keep their data)
 *   · pub code per product (blank until Stephen fills them)
 */

import { useCallback, useEffect, useState } from "react";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface ProductEntry { name: string; pubCode: string; reviewCount: number; gurus: string[] }
interface GuruEntry { name: string; reviewCount: number }
interface PublisherGroup { name: string; gurus: GuruEntry[]; products: ProductEntry[]; reviewCount: number }
interface Graph {
  publishers: PublisherGroup[];
  unassigned: { gurus: GuruEntry[]; products: ProductEntry[] };
  removed?: { kind: "guru" | "product" | "publisher"; name: string }[];
}

type Kind = "guru" | "product" | "publisher";
type View = "publications" | "gurus";

export default function EntitiesTab() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [view, setView] = useState<View>("publications");
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<{ kind: Kind; name: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/entities");
    if (res.ok) setGraph(await res.json());
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  const say = (m: string) => { setFlash(m); setError(null); setTimeout(() => setFlash(null), 6000); };
  const fail = (m: string) => { setError(m); setFlash(null); };

  const post = useCallback(async (body: Record<string, unknown>, okMsg: string) => {
    const res = await fetch("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { fail((json as { error?: string }).error ?? "Action failed"); return false; }
    say(okMsg + ((json as { rewrittenReviews?: number }).rewrittenReviews ? ` · ${(json as { rewrittenReviews?: number }).rewrittenReviews} past promo(s) corrected` : ""));
    await load();
    return true;
  }, [load]);

  const rename = async (kind: Kind, from: string) => {
    const to = window.prompt(`Rename ${kind} "${from}" to:`, from);
    if (!to || !to.trim() || to.trim() === from) return;
    await post({ action: "rename", kind, from, to: to.trim() }, `Renamed "${from}" → "${to.trim()}" (learned)`);
  };

  const mergeInto = async (kind: Kind, target: string) => {
    if (!mergeSource || mergeSource.kind !== kind || mergeSource.name === target) return;
    const ok = await post(
      { action: "merge", kind, from: mergeSource.name, to: target },
      `Merged "${mergeSource.name}" into "${target}" (learned)`
    );
    if (ok) setMergeSource(null);
  };

  const assign = async (kind: "guru" | "product", name: string, publisher: string) => {
    await post({ action: "assign", kind, name, publisher }, `Assigned "${name}" to ${publisher}`);
  };

  // Products can have multiple gurus: writes the FULL list (replaces derived set).
  const setProductGurus = async (product: string, gurus: string[], okMsg: string) => {
    await post({ action: "setProductGurus", product, gurus }, okMsg);
  };
  const addGuruToProduct = async (p: ProductEntry, guru: string) => {
    await setProductGurus(p.name, [...p.gurus, guru], `Added ${guru} to "${p.name}"`);
  };
  const removeGuruFromProduct = async (p: ProductEntry, guru: string) => {
    await setProductGurus(p.name, p.gurus.filter((g) => g !== guru), `Removed ${guru} from "${p.name}"`);
  };

  const remove = async (kind: Kind, name: string) => {
    if (!window.confirm(`Remove ${kind} "${name}" from the directory?\n\nPast promos keep their data — this only hides the entry.`)) return;
    await post({ action: "remove", kind, name }, `Removed "${name}" from the directory`);
  };

  if (!graph) {
    return <div className="max-w-4xl mx-auto mt-12 text-center text-sm text-gray-400">Loading directory…</div>;
  }

  const publisherNames = graph.publishers.map((p) => p.name);
  const guruPublisher = new Map<string, string>();
  for (const pub of graph.publishers) for (const g of pub.gurus) guruPublisher.set(g.name, pub.name);
  const allGurus = [
    ...graph.publishers.flatMap((pub) => pub.gurus),
    ...graph.unassigned.gurus,
  ].sort((a, b) => b.reviewCount - a.reviewCount || a.name.localeCompare(b.name));
  const allProducts: (ProductEntry & { publisher: string | null })[] = [
    ...graph.publishers.flatMap((pub) => pub.products.map((p) => ({ ...p, publisher: pub.name }))),
    ...graph.unassigned.products.map((p) => ({ ...p, publisher: null })),
  ];
  const merging = mergeSource !== null;

  const EntityActions = ({ kind, name }: { kind: Kind; name: string }) => (
    <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={() => void rename(kind, name)} title="Rename (aliases the old name)"
        className="text-gray-400 hover:text-blue-600 text-[11px] px-0.5">✏</button>
      <button
        onClick={() => setMergeSource(mergeSource?.name === name ? null : { kind, name })}
        title={mergeSource?.name === name ? "Cancel merge" : "Merge this into another — click this, then click the target"}
        className={`text-[11px] px-0.5 ${mergeSource?.name === name ? "text-red-500" : "text-gray-400 hover:text-amber-600"}`}
      >⇄</button>
      <button onClick={() => void remove(kind, name)} title="Remove from directory (past promos keep their data)"
        className="text-gray-400 hover:text-red-600 text-[11px] px-0.5">✕</button>
    </span>
  );

  const mergeTargetProps = (kind: Kind, name: string) =>
    merging && mergeSource!.kind === kind && mergeSource!.name !== name
      ? {
          onClick: () => void mergeInto(kind, name),
          className: "cursor-pointer ring-2 ring-amber-300 rounded",
          title: `Merge "${mergeSource!.name}" into "${name}"`,
        }
      : {};

  const GuruChips = ({ product }: { product: ProductEntry }) => (
    <span className="inline-flex items-center gap-1 flex-wrap max-w-56">
      {product.gurus.map((g) => (
        <span key={g} className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 border bg-white text-gray-600 border-gray-200">
          {g}
          <button onClick={() => void removeGuruFromProduct(product, g)} title={`Remove ${g}`}
            className="text-gray-300 hover:text-red-500">×</button>
        </span>
      ))}
      <select
        value=""
        onChange={(ev) => { if (ev.target.value) void addGuruToProduct(product, ev.target.value); }}
        className="text-[10px] rounded border border-gray-200 px-1 py-0.5 text-gray-400 w-14"
        title="Add a guru — products can have several"
      >
        <option value="">+ guru</option>
        {allGurus.filter((g) => !product.gurus.includes(g.name)).map((g) => (
          <option key={g.name} value={g.name}>{g.name}</option>
        ))}
      </select>
    </span>
  );

  const ProductRow = ({ p, showGuru }: { p: ProductEntry; showGuru: boolean }) => (
    <div className="group flex items-center gap-2 text-xs">
      <span className="flex-1 truncate" title={p.name} {...mergeTargetProps("product", p.name)}>
        {p.name}
        {p.reviewCount > 0 && <span className="text-gray-300"> ·{p.reviewCount}</span>}
      </span>
      {showGuru && <GuruChips product={p} />}
      <input
        defaultValue={p.pubCode}
        placeholder="pub code"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== p.pubCode) void post({ action: "setPubCode", product: p.name, code: v }, `Pub code for ${p.name} saved`);
        }}
        className="w-20 text-[11px] font-mono rounded border border-gray-200 px-1 py-0.5"
      />
      <EntityActions kind="product" name={p.name} />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4 flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Directory</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Hover an entity to rename (✏), merge (⇄ — click it, then click the target), or remove (✕).
            Corrections are learned: past promos are rewritten and all future attribution applies them.
          </p>
        </div>
        <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: NAVY_BORDER }}>
          {(["publications", "gurus"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-4 py-1.5 text-xs font-semibold capitalize"
              style={view === v ? { background: NAVY, color: "white" } : { background: "white", color: NAVY }}
            >
              {v === "publications" ? "Publications" : "Gurus"}
            </button>
          ))}
        </div>
      </div>

      {merging && (
        <div className="mb-3 text-sm rounded border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2">
          Merging <b>{mergeSource!.name}</b> ({mergeSource!.kind}) — click the {mergeSource!.kind} it should become, or{" "}
          <button className="underline" onClick={() => setMergeSource(null)}>cancel</button>.
        </div>
      )}
      {flash && <div className="mb-3 text-sm rounded border border-green-200 bg-green-50 text-green-800 px-3 py-2">{flash}</div>}
      {error && <div className="mb-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2">{error}</div>}

      {view === "publications" ? (
        <div className="space-y-4">
          {graph.publishers.map((pub) => (
            <div key={pub.name} className="rounded-lg border" style={{ borderColor: NAVY_BORDER }}>
              <div className="px-4 py-2.5 flex items-center justify-between group" style={{ background: NAVY_BG }}>
                <span className="flex items-center gap-2" {...mergeTargetProps("publisher", pub.name)}>
                  <span className="font-bold text-sm" style={{ color: NAVY }}>{pub.name}</span>
                  {pub.reviewCount > 0 && <span className="text-[11px] text-gray-400">{pub.reviewCount} promo{pub.reviewCount === 1 ? "" : "s"}</span>}
                </span>
                <EntityActions kind="publisher" name={pub.name} />
              </div>
              <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Gurus</p>
                  {pub.gurus.length === 0 ? (
                    <p className="text-xs text-gray-300">none</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {pub.gurus.map((g) => (
                        <span key={g.name} className="group inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border bg-white"
                          style={{ borderColor: NAVY_BORDER, color: NAVY }} {...mergeTargetProps("guru", g.name)}>
                          {g.name}
                          {g.reviewCount > 0 && <span className="text-gray-300">·{g.reviewCount}</span>}
                          <EntityActions kind="guru" name={g.name} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Products</p>
                  {pub.products.length === 0 ? (
                    <p className="text-xs text-gray-300">none</p>
                  ) : (
                    <div className="space-y-1">
                      {pub.products.map((p) => <ProductRow key={p.name} p={p} showGuru />)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {(graph.unassigned.gurus.length > 0 || graph.unassigned.products.length > 0) && (
            <div className="rounded-lg border border-dashed border-gray-300">
              <div className="px-4 py-2.5 bg-gray-50">
                <span className="font-bold text-sm text-gray-500">Unassigned</span>
                <span className="text-[11px] text-gray-400 ml-2">no known publisher — assign below</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                {[...graph.unassigned.gurus.map((g) => ({ kind: "guru" as const, name: g.name, count: g.reviewCount })),
                  ...graph.unassigned.products.map((p) => ({ kind: "product" as const, name: p.name, count: p.reviewCount }))].map((e) => (
                  <div key={`${e.kind}:${e.name}`} className="group flex items-center gap-2 text-xs">
                    <span className="text-[10px] uppercase text-gray-300 w-14">{e.kind}</span>
                    <span className="flex-1 truncate" {...mergeTargetProps(e.kind, e.name)}>
                      {e.name}{e.count > 0 && <span className="text-gray-300"> ·{e.count}</span>}
                    </span>
                    <select
                      defaultValue=""
                      onChange={(ev) => { if (ev.target.value) void assign(e.kind, e.name, ev.target.value); }}
                      className="text-[11px] rounded border border-gray-200 px-1 py-0.5 text-gray-500"
                    >
                      <option value="">Assign to…</option>
                      {publisherNames.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <EntityActions kind={e.kind} name={e.name} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {allGurus.map((g) => {
            const products = allProducts.filter((p) => p.gurus.includes(g.name));
            return (
              <div key={g.name} className="rounded-lg border" style={{ borderColor: NAVY_BORDER }}>
                <div className="px-4 py-2.5 flex items-center justify-between group" style={{ background: NAVY_BG }}>
                  <span className="flex items-center gap-2" {...mergeTargetProps("guru", g.name)}>
                    <span className="font-bold text-sm" style={{ color: NAVY }}>{g.name}</span>
                    {guruPublisher.has(g.name) && (
                      <span className="text-[11px] rounded-full px-2 py-0.5 border bg-white" style={{ borderColor: NAVY_BORDER, color: NAVY }}>
                        {guruPublisher.get(g.name)}
                      </span>
                    )}
                    {g.reviewCount > 0 && <span className="text-[11px] text-gray-400">{g.reviewCount} promo{g.reviewCount === 1 ? "" : "s"}</span>}
                  </span>
                  <EntityActions kind="guru" name={g.name} />
                </div>
                <div className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Products</p>
                  {products.length === 0 ? (
                    <p className="text-xs text-gray-300 mb-2">none assigned</p>
                  ) : (
                    <div className="space-y-1 mb-2">
                      {products.map((p) => (
                        <div key={p.name} className="group flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate" title={p.name} {...mergeTargetProps("product", p.name)}>
                            {p.name}
                            {p.publisher && <span className="text-gray-400"> — {p.publisher}</span>}
                            {p.reviewCount > 0 && <span className="text-gray-300"> ·{p.reviewCount}</span>}
                          </span>
                          {p.gurus.length > 1 && (
                            <span className="text-[10px] text-gray-300">+{p.gurus.length - 1} more</span>
                          )}
                          <button
                            onClick={() => void removeGuruFromProduct(p, g.name)}
                            title={`Remove ${g.name} from this product (other gurus stay)`}
                            className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-400 hover:text-red-600"
                          >unassign</button>
                          <EntityActions kind="product" name={p.name} />
                        </div>
                      ))}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(ev) => {
                      const prod = allProducts.find((p) => p.name === ev.target.value);
                      if (prod) void addGuruToProduct(prod, g.name);
                    }}
                    className="text-[11px] rounded border border-gray-200 px-1 py-0.5 text-gray-500"
                  >
                    <option value="">Assign a product…</option>
                    {allProducts.filter((p) => !p.gurus.includes(g.name)).map((p) => (
                      <option key={p.name} value={p.name}>{p.name}{p.gurus.length ? ` (also ${p.gurus.join(", ")})` : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}

          {allProducts.some((p) => p.gurus.length === 0) && (
            <div className="rounded-lg border border-dashed border-gray-300">
              <div className="px-4 py-2.5 bg-gray-50">
                <span className="font-bold text-sm text-gray-500">Products without a guru</span>
                <span className="text-[11px] text-gray-400 ml-2">assign below</span>
              </div>
              <div className="px-4 py-3 space-y-1">
                {allProducts.filter((p) => p.gurus.length === 0).map((p) => (
                  <div key={p.name} className="group flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate" title={p.name} {...mergeTargetProps("product", p.name)}>
                      {p.name}
                      {p.publisher && <span className="text-gray-400"> — {p.publisher}</span>}
                      {p.reviewCount > 0 && <span className="text-gray-300"> ·{p.reviewCount}</span>}
                    </span>
                    <GuruChips product={p} />
                    <EntityActions kind="product" name={p.name} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(graph.removed?.length ?? 0) > 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300">
          <div className="px-4 py-2 bg-gray-50">
            <span className="font-bold text-sm text-gray-500">Removed from directory</span>
            <span className="text-[11px] text-gray-400 ml-2">hidden, not deleted — restore anytime</span>
          </div>
          <div className="px-4 py-2 space-y-1">
            {graph.removed!.map((e) => (
              <div key={`${e.kind}:${e.name}`} className="flex items-center gap-2 text-xs text-gray-500">
                <span className="text-[10px] uppercase text-gray-300 w-14">{e.kind}</span>
                <span className="flex-1 truncate capitalize">{e.name}</span>
                <button
                  onClick={() => void post({ action: "restore", kind: e.kind, name: e.name }, `Restored "${e.name}"`)}
                  className="text-[11px] text-blue-600 hover:underline"
                >restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-4">
        Sources: the brain&apos;s Financial Publishing Directory ∪ values used on analyzed promos. Counts are analyzed promos referencing the entity.
        Removal only hides an entry — past promos keep their data. Pub codes are stored for future creative-code mapping.
      </p>
    </div>
  );
}
