/**
 * Copy-knowledge corpus — SQLite on the data volume.
 *
 * The 73+ stored promo source documents are a trustworthy education corpus
 * (publisher directive 2026-07-04): the brain learns FACTS (about gurus,
 * products, markets), VOICE (verbatim guru passages), and CRAFT PATTERNS from
 * the copy itself. Performance data stays on the prediction side — it never
 * defines this knowledge, it only later helps select which patterns win.
 *
 * This database is the queryable raw layer; the vault's markdown ledgers and
 * guru profiles are the curated, human-readable projection of it. It is fully
 * rebuildable from the stored source docs, so it can never be "lost".
 *
 * Speaker rule (publisher directive): in transcripts with a host + guru, voice
 * passages are stored ONLY when the speaker is the guru; host statements about
 * the guru are kept as facts (speaker recorded), never as voice.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

let db: Database.Database | null = null;

export function corpusDb(): Database.Database {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "corpus.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS extractions (
      review_id TEXT PRIMARY KEY,
      promo_title TEXT NOT NULL,
      guru TEXT,
      publisher TEXT,
      product TEXT,
      source_format TEXT,           -- written | transcript
      extracted_at TEXT NOT NULL,
      model TEXT
    );
    CREATE TABLE IF NOT EXISTS passages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      guru TEXT,                    -- whose voice this is (guru speaker only)
      type TEXT NOT NULL,           -- lead_open | personal_story | mechanism_explain | proof_presentation | objection_handle | close | ps
      quote TEXT NOT NULL,          -- verbatim
      topics TEXT,                  -- JSON array
      quality INTEGER,              -- 1-5 extraction judgment of how exemplary
      UNIQUE(review_id, type, quote)
    );
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,  -- subject|normalized fact, dedup key
      subject_kind TEXT NOT NULL,        -- guru | product | publication | market | other
      subject TEXT NOT NULL,             -- canonical name
      fact TEXT NOT NULL,                -- normalized statement
      quote TEXT NOT NULL,               -- verbatim as first seen
      backup_type TEXT,                  -- track_record | study | news | testimonial | credential | projection | none  (reliability signal only)
      stated_by TEXT,                    -- guru | host | narrator
      topics TEXT,                       -- JSON array
      first_review_id TEXT NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 1,
      seen_reviews TEXT NOT NULL         -- JSON array of review ids
    );
    CREATE TABLE IF NOT EXISTS style_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guru TEXT NOT NULL,
      review_id TEXT NOT NULL,
      note TEXT NOT NULL,                -- one observed voice trait, cited
      UNIQUE(guru, review_id, note)
    );
    CREATE INDEX IF NOT EXISTS idx_passages_guru ON passages(guru, type);
    CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_kind, subject);
  `);
  return db;
}

export interface ExtractedPassage {
  type: string;
  quote: string;
  guru: string | null;
  topics: string[];
  quality: number;
}
export interface ExtractedFact {
  subjectKind: string;
  subject: string;
  fact: string;
  quote: string;
  backupType: string;
  statedBy: string;
  topics: string[];
}

export function factFingerprint(subject: string, fact: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$.]+/g, " ").trim();
  return crypto.createHash("sha1").update(`${norm(subject)}|${norm(fact)}`).digest("hex").slice(0, 16);
}

/** Store one promo's extraction. Idempotent: re-extracting a review replaces its passages/style notes and re-counts its facts. */
export function storeExtraction(
  meta: { reviewId: string; promoTitle: string; guru: string | null; publisher: string | null; product: string | null; sourceFormat: string; model: string },
  passages: ExtractedPassage[],
  facts: ExtractedFact[],
  styleNotes: { guru: string; note: string }[]
): { passages: number; factsNew: number; factsSeenAgain: number; styleNotes: number } {
  const d = corpusDb();
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO extractions (review_id, promo_title, guru, publisher, product, source_format, extracted_at, model)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(review_id) DO UPDATE SET promo_title=excluded.promo_title, guru=excluded.guru,
         publisher=excluded.publisher, product=excluded.product, source_format=excluded.source_format,
         extracted_at=excluded.extracted_at, model=excluded.model`
    ).run(meta.reviewId, meta.promoTitle, meta.guru, meta.publisher, meta.product, meta.sourceFormat, new Date().toISOString(), meta.model);

    d.prepare(`DELETE FROM passages WHERE review_id = ?`).run(meta.reviewId);
    d.prepare(`DELETE FROM style_notes WHERE review_id = ?`).run(meta.reviewId);

    const insP = d.prepare(
      `INSERT OR IGNORE INTO passages (review_id, guru, type, quote, topics, quality) VALUES (?,?,?,?,?,?)`
    );
    for (const p of passages) insP.run(meta.reviewId, p.guru, p.type, p.quote, JSON.stringify(p.topics ?? []), p.quality ?? 3);

    let factsNew = 0;
    let factsSeenAgain = 0;
    const getF = d.prepare(`SELECT id, seen_reviews FROM facts WHERE fingerprint = ?`);
    const insF = d.prepare(
      `INSERT INTO facts (fingerprint, subject_kind, subject, fact, quote, backup_type, stated_by, topics, first_review_id, seen_count, seen_reviews)
       VALUES (?,?,?,?,?,?,?,?,?,1,?)`
    );
    const bumpF = d.prepare(`UPDATE facts SET seen_count = seen_count + 1, seen_reviews = ? WHERE id = ?`);
    for (const f of facts) {
      const fp = factFingerprint(f.subject, f.fact);
      const existing = getF.get(fp) as { id: number; seen_reviews: string } | undefined;
      if (existing) {
        const seen: string[] = JSON.parse(existing.seen_reviews);
        if (!seen.includes(meta.reviewId)) {
          seen.push(meta.reviewId);
          bumpF.run(JSON.stringify(seen), existing.id);
          factsSeenAgain++;
        }
      } else {
        insF.run(fp, f.subjectKind, f.subject, f.fact, f.quote, f.backupType, f.statedBy, JSON.stringify(f.topics ?? []), meta.reviewId, JSON.stringify([meta.reviewId]));
        factsNew++;
      }
    }

    const insS = d.prepare(`INSERT OR IGNORE INTO style_notes (guru, review_id, note) VALUES (?,?,?)`);
    for (const s of styleNotes) insS.run(s.guru, meta.reviewId, s.note);
    return { passages: passages.length, factsNew, factsSeenAgain, styleNotes: styleNotes.length };
  });
  return tx();
}

export function corpusStats() {
  const d = corpusDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    extractions: one(`SELECT COUNT(*) n FROM extractions`),
    passages: one(`SELECT COUNT(*) n FROM passages`),
    facts: one(`SELECT COUNT(*) n FROM facts`),
    styleNotes: one(`SELECT COUNT(*) n FROM style_notes`),
  };
}

export function factsForSubject(subject: string): unknown[] {
  return corpusDb()
    .prepare(`SELECT * FROM facts WHERE subject = ? COLLATE NOCASE ORDER BY seen_count DESC, id ASC`)
    .all(subject);
}
export function passagesForGuru(guru: string, type?: string): unknown[] {
  const d = corpusDb();
  return type
    ? d.prepare(`SELECT * FROM passages WHERE guru = ? COLLATE NOCASE AND type = ? ORDER BY quality DESC`).all(guru, type)
    : d.prepare(`SELECT * FROM passages WHERE guru = ? COLLATE NOCASE ORDER BY type, quality DESC`).all(guru);
}
export function styleNotesForGuru(guru: string): unknown[] {
  return corpusDb().prepare(`SELECT * FROM style_notes WHERE guru = ? COLLATE NOCASE`).all(guru);
}
export function extractedReviewIds(): Set<string> {
  return new Set(
    (corpusDb().prepare(`SELECT review_id FROM extractions`).all() as { review_id: string }[]).map((r) => r.review_id)
  );
}
