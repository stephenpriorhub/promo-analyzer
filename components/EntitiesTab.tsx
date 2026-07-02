"use client";

/**
 * Directory tab — the entity graph: publishers with their gurus and products
 * (iSpyEmail-style), with inline editing:
 *   · rename an entity (persists as an alias — the brain learns the correction)
 *   · merge duplicates into a canonical name (same mechanics; past reviews are
 *     rewritten and future attribution applies it automatically)
 *   · assign a guru/product to a publisher (manual assignment beats the
 *     directory)
 *   · pub code per product (blank until Stephen fills them)
 */

import { useCallback, useEffect, useState } from "react";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

interface ProductEntry { name: string; pubCode: string; reviewCount: number }
interface GuruEntry { name: string; reviewCount: number }
interface PublisherGroup { name: string; gurus: GuruEntry[]; products: ProductEntry[]; reviewCount: number }
interface Graph {
  publishers: PublisherGroup[];
  unassigned: { gurus: GuruEntry[]; products: ProductEntry[] };
}

type Kind = "guru" | "product" | "publisher";

export default function EntitiesTab() {
  const [graph, setGraph] = useState<Graph | null>(null);
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

  if (!graph) {
    return <div className="max-w-4xl mx-auto mt-12 text-center text-sm text-gray-400">Loading directory…</div>;
  }

  const publisherNames = graph.publishers.map((p) => p.name);
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

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-bold" style={{ color: NAVY }}>Directory</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Publishers with their gurus and products. Hover an entity to rename (✏) or merge (⇄ — click it, then click the merge target).
          Corrections are learned: past promos are rewritten and all future attribution applies them.
        </p>
      </div>

      {merging && (
        <div className="mb-3 text-sm rounded border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2">
          Merging <b>{mergeSource!.name}</b> ({mergeSource!.kind}) — click the {mergeSource!.kind} it should become, or{" "}
          <button className="underline" onClick={() => setMergeSource(null)}>cancel</button>.
        </div>
      )}
      {flash && <div className="mb-3 text-sm rounded border border-green-200 bg-green-50 text-green-800 px-3 py-2">{flash}</div>}
      {error && <div className="mb-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2">{error}</div>}

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
                    {pub.products.map((p) => (
                      <div key={p.name} className="group flex items-center gap-2 text-xs">
                        <span className="flex-1 truncate" title={p.name} {...mergeTargetProps("product", p.name)}>
                          {p.name}
                          {p.reviewCount > 0 && <span className="text-gray-300"> ·{p.reviewCount}</span>}
                        </span>
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
                    ))}
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

      <p className="text-[11px] text-gray-400 mt-4">
        Sources: the brain&apos;s Financial Publishing Directory ∪ values used on analyzed promos. Counts are analyzed promos referencing the entity. Pub codes are stored for future creative-code mapping.
      </p>
    </div>
  );
}
