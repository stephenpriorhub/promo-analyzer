/**
 * Corpus extraction — mines a promo's FULL SOURCE TEXT for knowledge:
 * facts (about gurus, products, markets), voice (verbatim guru passages by
 * rhetorical function), and style observations. Publisher directive 2026-07-04:
 * the copy is trustworthy educational context; extract verbatim or not at all.
 *
 * SPEAKER RULE (non-negotiable): transcripts often have a host + guru. Voice
 * passages come ONLY from the guru's own speech. Host statements ABOUT the
 * guru (bio, track record, praise) are valuable facts — recorded with
 * stated_by:"host" — but never voice.
 *
 * Two-stage for long promos: chunked extraction, then a cheap in-process merge
 * (fact dedup happens in corpus-db by fingerprint anyway).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";
import { EXTRACTION_MODEL } from "@/lib/models";
import { storeExtraction, type ExtractedFact, type ExtractedPassage } from "@/lib/corpus-db";
import { canonicalGuruName } from "@/lib/brain-reader";

const PASSAGE_TYPES = [
  "lead_open", "personal_story", "mechanism_explain", "proof_presentation",
  "objection_handle", "close", "ps",
] as const;

const CORPUS_TOOL: Anthropic.Tool = {
  name: "record_knowledge",
  description: "Record the verbatim knowledge extracted from this promo copy chunk.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceFormat: { type: "string", enum: ["written", "transcript"] },
      guruSpeakers: {
        type: "array", items: { type: "string" },
        description: "In a transcript: the speaker name(s) identified as the guru(s). Empty for written promos.",
      },
      passages: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: [...PASSAGE_TYPES] },
            quote: { type: "string", description: "VERBATIM excerpt, 40-400 words. Never paraphrase." },
            speaker: { type: "string", enum: ["guru", "host", "narrator"], description: "Who says/writes this. Voice passages are stored only when 'guru'." },
            guruName: { type: "string", description: "Which guru's voice this is (their name). Empty string if speaker is not a guru." },
            topics: { type: "array", items: { type: "string" } },
            quality: { type: "integer", description: "1-5: how exemplary of the guru's craft/voice (5 = signature-quality)." },
          },
          required: ["type", "quote", "speaker", "guruName", "topics", "quality"],
        },
      },
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            subjectKind: { type: "string", enum: ["guru", "product", "publication", "market", "other"] },
            subject: { type: "string", description: "Who/what the fact is about (guru name, product name, ticker, etc.)" },
            fact: { type: "string", description: "The fact, normalized to one plain sentence." },
            quote: { type: "string", description: "VERBATIM supporting excerpt from the copy." },
            backupType: { type: "string", enum: ["track_record", "study", "news", "testimonial", "credential", "projection", "none"], description: "What kind of support the copy itself offers — a reliability signal." },
            statedBy: { type: "string", enum: ["guru", "host", "narrator"] },
            topics: { type: "array", items: { type: "string" } },
          },
          required: ["subjectKind", "subject", "fact", "quote", "backupType", "statedBy", "topics"],
        },
      },
      styleNotes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            guruName: { type: "string" },
            note: { type: "string", description: "One observed voice trait (rhythm, tic, catchphrase, analogy habit, risk-talk style), stated concretely with a short quoted example." },
          },
          required: ["guruName", "note"],
        },
      },
    },
    required: ["sourceFormat", "guruSpeakers", "passages", "facts", "styleNotes"],
  },
};

const PROMPT = `You are building a financial-publishing knowledge corpus from promo copy. This copy is trustworthy educational context — mine it for what it TEACHES about the guru, the products, and the craft.

## Promo context
Title: {TITLE}
Known guru(s): {GURUS}
Publisher: {PUBLISHER} | Product: {PRODUCT}
This is chunk {I} of {N}.

## Extract three things — VERBATIM ONLY (exact quotes, never paraphrase the quote fields):

1. PASSAGES — the guru at their best, typed by rhetorical function (lead_open, personal_story, mechanism_explain, proof_presentation, objection_handle, close, ps). 3-10 per chunk, favoring signature-quality moments.
   SPEAKER RULE: if this is a TRANSCRIPT with a host and a guru, first identify which speaker is the guru (match against the known gurus; use dialogue cues). Voice passages must come ONLY from the guru's own speech — never the host's. Mark each passage's speaker honestly.

2. FACTS — concrete, reusable knowledge: guru track records ("closed 21 winners in 2023"), bios/credentials, origin stories, product mechanics, pricing history, market statistics, named tickers with outcomes. Each fact: one normalized sentence + its verbatim supporting quote + what kind of backup the copy gives it. Host statements ABOUT the guru are good facts (statedBy: "host").

3. STYLE NOTES — 1-4 concrete voice observations about the guru (sentence rhythm, catchphrases, metaphor habits, how they handle risk/hedging), each with a short quoted example. Only from the guru's own words.

Skip: legal boilerplate, disclaimers, order-form mechanics, generic filler. Quality over quantity.

## Copy chunk
{CHUNK}`;

// The API rejects minimum/maximum on integer tool properties, so the 1-5
// bound lives here instead of in the CORPUS_TOOL schema.
const clampQuality = (q: number | undefined) =>
  Math.min(5, Math.max(1, Math.round(q ?? 3)));

/**
 * Vision path for scanned/visual PDFs with no text layer (publisher directive
 * 2026-07-04: "those 15 should still be scanned"). The PDF is uploaded via the
 * Files API — the same mechanism the scoring analysis uses — and read visually
 * in one pass. Quotes are the model's transcription of what it reads on the
 * page; the speaker rule applies unchanged.
 */
export async function extractCorpusKnowledgeFromPdf(params: {
  reviewId: string;
  promoTitle: string;
  pdfBuffer: Buffer;
  gurus: string[];
  publisher: string | null;
  product: string | null;
}): Promise<CorpusExtractResult> {
  const { reviewId, promoTitle, pdfBuffer, gurus, publisher, product } = params;
  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  let fileId: string | null = null;
  try {
    const uploaded = await client.beta.files.upload({
      file: new File([Uint8Array.from(pdfBuffer)], "promo.pdf", { type: "application/pdf" }),
    });
    fileId = uploaded.id;
    const prompt = PROMPT
      .replace("{TITLE}", promoTitle)
      .replace("{GURUS}", gurus.join(", ") || "unknown")
      .replace("{PUBLISHER}", publisher ?? "unknown")
      .replace("{PRODUCT}", product ?? "unknown")
      .replace("{I}", "1")
      .replace("{N}", "1")
      .replace("{CHUNK}", "(the promo is the attached PDF — read it in full, transcribe quotes exactly as printed)");
    const msg = await client.beta.messages.create({
      model: EXTRACTION_MODEL,
      betas: ["files-api-2025-04-14"],
      output_config: { effort: "low" },
      max_tokens: 16384,
      tools: [CORPUS_TOOL as Anthropic.Beta.BetaTool],
      tool_choice: { type: "tool", name: "record_knowledge" },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: fileId } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const tu = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const input = (tu?.input ?? {}) as {
      sourceFormat?: string;
      passages?: Array<{ type: string; quote: string; speaker: string; guruName: string; topics: string[]; quality: number }>;
      facts?: Array<{ subjectKind: string; subject: string; fact: string; quote: string; backupType: string; statedBy: string; topics: string[] }>;
      styleNotes?: Array<{ guruName: string; note: string }>;
    };
    const passages: ExtractedPassage[] = (input.passages ?? [])
      .filter((p) => p.speaker === "guru" && p.guruName?.trim())
      .map((p) => ({ type: p.type, quote: p.quote, guru: canonicalGuruName(p.guruName), topics: p.topics ?? [], quality: clampQuality(p.quality) }));
    const facts: ExtractedFact[] = (input.facts ?? []).map((f) => ({
      ...f,
      subject: f.subjectKind === "guru" ? canonicalGuruName(f.subject) : f.subject,
      topics: f.topics ?? [],
    }));
    const style = (input.styleNotes ?? [])
      .filter((s) => s.guruName?.trim())
      .map((s) => ({ guru: canonicalGuruName(s.guruName), note: s.note }));
    const counts = storeExtraction(
      {
        reviewId,
        promoTitle,
        guru: gurus[0] ? canonicalGuruName(gurus[0]) : null,
        publisher,
        product,
        sourceFormat: input.sourceFormat === "transcript" ? "transcript" : "visual-pdf",
        model: EXTRACTION_MODEL,
      },
      passages,
      facts,
      style
    );
    return { ok: true, sourceFormat: "visual-pdf", ...counts };
  } catch (err) {
    const error = err instanceof Error ? err.message : "pdf corpus extraction failed";
    console.warn(`[corpus] pdf extraction failed for ${reviewId}: ${error}`);
    return { ok: false, passages: 0, factsNew: 0, factsSeenAgain: 0, styleNotes: 0, sourceFormat: "visual-pdf", error };
  } finally {
    if (fileId) void client.beta.files.delete(fileId).catch(() => {});
  }
}

export interface CorpusExtractResult {
  ok: boolean;
  passages: number;
  factsNew: number;
  factsSeenAgain: number;
  styleNotes: number;
  sourceFormat: string;
  error?: string;
}

const CHUNK_CHARS = 28_000; // ~6-7k tokens of copy per call

function chunk(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
  return out;
}

export async function extractCorpusKnowledge(params: {
  reviewId: string;
  promoTitle: string;
  fullText: string;
  gurus: string[];
  publisher: string | null;
  product: string | null;
}): Promise<CorpusExtractResult> {
  const { reviewId, promoTitle, fullText, gurus, publisher, product } = params;
  try {
    const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
    const chunks = chunk(fullText);
    const allPassages: ExtractedPassage[] = [];
    const allFacts: ExtractedFact[] = [];
    const allStyle: { guru: string; note: string }[] = [];
    let sourceFormat = "written";

    for (let i = 0; i < chunks.length; i++) {
      const prompt = PROMPT
        .replace("{TITLE}", promoTitle)
        .replace("{GURUS}", gurus.join(", ") || "unknown")
        .replace("{PUBLISHER}", publisher ?? "unknown")
        .replace("{PRODUCT}", product ?? "unknown")
        .replace("{I}", String(i + 1))
        .replace("{N}", String(chunks.length))
        .replace("{CHUNK}", chunks[i]);
      const msg = await client.messages.create({
        model: EXTRACTION_MODEL,
        output_config: { effort: "low" },
        max_tokens: 8192,
        tools: [CORPUS_TOOL],
        tool_choice: { type: "tool", name: "record_knowledge" },
        messages: [{ role: "user", content: prompt }],
      });
      const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const input = (tu?.input ?? {}) as {
        sourceFormat?: string;
        passages?: Array<{ type: string; quote: string; speaker: string; guruName: string; topics: string[]; quality: number }>;
        facts?: Array<{ subjectKind: string; subject: string; fact: string; quote: string; backupType: string; statedBy: string; topics: string[] }>;
        styleNotes?: Array<{ guruName: string; note: string }>;
      };
      if (input.sourceFormat === "transcript") sourceFormat = "transcript";
      for (const p of input.passages ?? []) {
        // Speaker rule enforced in code, not just in the prompt: only the
        // guru's own speech becomes voice.
        if (p.speaker !== "guru" || !p.guruName?.trim()) continue;
        allPassages.push({
          type: p.type,
          quote: p.quote,
          guru: canonicalGuruName(p.guruName),
          topics: p.topics ?? [],
          quality: clampQuality(p.quality),
        });
      }
      for (const f of input.facts ?? []) {
        allFacts.push({
          ...f,
          subject: f.subjectKind === "guru" ? canonicalGuruName(f.subject) : f.subject,
          topics: f.topics ?? [],
        });
      }
      for (const s of input.styleNotes ?? []) {
        if (s.guruName?.trim()) allStyle.push({ guru: canonicalGuruName(s.guruName), note: s.note });
      }
    }

    const counts = storeExtraction(
      {
        reviewId,
        promoTitle,
        guru: gurus[0] ? canonicalGuruName(gurus[0]) : null,
        publisher,
        product,
        sourceFormat,
        model: EXTRACTION_MODEL,
      },
      allPassages,
      allFacts,
      allStyle
    );
    return { ok: true, sourceFormat, ...counts };
  } catch (err) {
    const error = err instanceof Error ? err.message : "corpus extraction failed";
    console.warn(`[corpus] extraction failed for ${reviewId}: ${error}`);
    return { ok: false, passages: 0, factsNew: 0, factsSeenAgain: 0, styleNotes: 0, sourceFormat: "written", error };
  }
}
