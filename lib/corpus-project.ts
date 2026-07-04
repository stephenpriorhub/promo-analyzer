/**
 * Vault projection — renders a guru's corpus knowledge into readable brain
 * notes under Resources/Promo Analysis/Knowledge/. These files are wholly
 * machine-owned (regenerated on every projection), so they never fight the
 * curated guru profiles in Resources/Experts — Brain Master promotes from
 * here into profile canon on its own schedule.
 */

import { writeBrainNote } from "@/lib/brain-writer";
import { factsForSubject, passagesForGuru, styleNotesForGuru, corpusDb } from "@/lib/corpus-db";

interface FactRow {
  subject_kind: string;
  fact: string;
  quote: string;
  backup_type: string;
  stated_by: string;
  seen_count: number;
  seen_reviews: string;
  first_review_id: string;
}
interface PassageRow {
  review_id: string;
  type: string;
  quote: string;
  topics: string;
  quality: number;
}
interface StyleRow {
  review_id: string;
  note: string;
}

const TYPE_LABEL: Record<string, string> = {
  lead_open: "Lead / Opening",
  personal_story: "Personal Story",
  mechanism_explain: "Mechanism Explanation",
  proof_presentation: "Proof Presentation",
  objection_handle: "Objection Handling",
  close: "Close",
  ps: "P.S.",
};

function promoTitleById(): Map<string, string> {
  const rows = corpusDb().prepare(`SELECT review_id, promo_title FROM extractions`).all() as {
    review_id: string;
    promo_title: string;
  }[];
  return new Map(rows.map((r) => [r.review_id, r.promo_title]));
}

export async function projectGuruKnowledge(
  guru: string
): Promise<{ ok: boolean; facts: number; passages: number; notes: string[]; error?: string }> {
  const facts = factsForSubject(guru) as FactRow[];
  const passages = passagesForGuru(guru) as PassageRow[];
  const style = styleNotesForGuru(guru) as StyleRow[];
  const titles = promoTitleById();
  const day = new Date().toISOString().slice(0, 10);
  const link = (id: string) => (titles.get(id) ? `[[${titles.get(id)}]]` : id);

  if (facts.length === 0 && passages.length === 0) {
    return { ok: false, facts: 0, passages: 0, notes: [], error: "nothing in corpus for this guru" };
  }

  // ---- Facts note ----
  const factLines: string[] = [
    "---",
    "status: active",
    `updated: ${day}`,
    "tags:",
    "  - promo-knowledge",
    "  - machine-written",
    "---",
    "",
    `# ${guru} — Facts`,
    "",
    `Knowledge mined from promo copy (education corpus). Facts seen in multiple promos are well-established. Machine-regenerated — curate into [[${guru}]] canon, don't hand-edit here.`,
    "",
    "| Fact | Backup in copy | Stated by | Seen | Source |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const f of facts) {
    const seen: string[] = JSON.parse(f.seen_reviews);
    factLines.push(
      `| ${f.fact.replace(/\|/g, "/")} | ${f.backup_type} | ${f.stated_by} | ${f.seen_count}× | ${seen.slice(0, 3).map(link).join(", ")} |`
    );
  }

  // ---- Voice note ----
  const voiceLines: string[] = [
    "---",
    "status: active",
    `updated: ${day}`,
    "tags:",
    "  - promo-knowledge",
    "  - voice",
    "  - machine-written",
    "---",
    "",
    `# ${guru} — Voice`,
    "",
    `Verbatim exemplars of ${guru}'s own words (guru speech only — host/narrator excluded), by rhetorical function. Machine-regenerated.`,
    "",
    "## Style Observations",
    ...[...new Set(style.map((s) => s.note))].slice(0, 25).map((n) => `- ${n}`),
  ];
  const byType = new Map<string, PassageRow[]>();
  for (const p of passages) {
    const arr = byType.get(p.type) ?? [];
    arr.push(p);
    byType.set(p.type, arr);
  }
  for (const [type, arr] of byType) {
    voiceLines.push("", `## ${TYPE_LABEL[type] ?? type}`);
    for (const p of arr.sort((a, b) => b.quality - a.quality).slice(0, 5)) {
      voiceLines.push("", `> ${p.quote.replace(/\n/g, "\n> ")}`, `> — ${link(p.review_id)} (quality ${p.quality}/5)`);
    }
  }

  const notes: string[] = [];
  let ok = true;
  let error: string | undefined;
  for (const [title, content] of [
    [`${guru} — Facts`, factLines.join("\n") + "\n"],
    [`${guru} — Voice`, voiceLines.join("\n") + "\n"],
  ] as const) {
    const res = await writeBrainNote(title, content, "knowledge");
    if (res.ok) notes.push(title);
    else {
      ok = false;
      error = res.error;
    }
  }
  return { ok, facts: facts.length, passages: passages.length, notes, error };
}
