/**
 * Source Copy vault writer — publisher directive 2026-09-06: every analyzed
 * promo's FULL copy (transcript, .docx, or PDF) gets its own markdown note in
 * the brain vault, linked to its analysis note.
 *
 * Until now the vault only ever held *derived* structures (scores, intel,
 * ledger rows, corpus facts/voice). The primary text lived only on the app's
 * Railway volume as `source.docx` / `source.pdf`, and — for VSL rips — inside
 * VidRipper's manifest. That made the copy itself unsearchable in Obsidian and
 * single-copy on a volume. These notes fix both.
 *
 * Text-layer sources are copied verbatim. Scanned/visual PDFs (no text layer)
 * are transcribed with a vision pass (publisher-approved 2026-09-06) so those
 * promos are readable text in the vault too.
 *
 * Every export is graceful: teaching the brain must never break the product.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ANALYSIS_MODEL } from "./models";
import { getEnv } from "./env";
import { writeBrainNote, addLineToBrainNote } from "./brain-writer";
import { intelNoteTitle } from "./promo-intel";

/** Vault note title for a promo's full copy (mirrors `Promo Intel - X`). */
export function sourceNoteTitle(promoTitle: string): string {
  return `Promo Copy - ${promoTitle}`;
}

/**
 * Hard ceiling on note size. A 60-page promo lands around 200 KB; the cap is
 * only there so a pathological source can't push a single GitHub Contents API
 * write (base64, held in memory) into failure territory.
 */
const MAX_NOTE_CHARS = 900_000;

/** Collapse runaway blank lines from .docx/PDF extraction without reflowing the copy. */
function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const countWords = (s: string) => (s.match(/\S+/g) ?? []).length;

const TRANSCRIBE_PROMPT = `Transcribe this promotional sales letter into Markdown, VERBATIM.

Rules:
- Reproduce the words exactly as printed. Do not paraphrase, summarize, correct, condense, or skip anything — including the fine print, footnotes, disclaimers, and the order form.
- Preserve reading order and structure: headline as \`#\`, subheads as \`##\`, kickers/eyebrows as plain lines above the headline, bullets as \`-\`, and keep paragraph breaks where they fall.
- Keep every number, price, date, percentage, ticker, and name exactly as written.
- Where a chart, screenshot, photo, or table carries information, transcribe any text in it and add a short bracketed marker on its own line, e.g. \`[chart: AOL 1992-1999 share price]\`. Never invent content that is not on the page.
- No commentary, no analysis, no preamble, no closing note. Output the transcription only.`;

/**
 * Vision transcription for scanned/visual PDFs (no text layer). Streams (a
 * >21k max_tokens non-streamed call throws) and continues across turns when a
 * long promo runs past the output budget.
 */
async function transcribePdfVisually(
  pdfBuffer: Buffer,
  promoTitle: string
): Promise<string> {
  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  let fileId: string | null = null;
  try {
    const uploaded = await client.beta.files.upload({
      file: new File([Uint8Array.from(pdfBuffer)], "promo.pdf", { type: "application/pdf" }),
    });
    fileId = uploaded.id;

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "file", file_id: fileId } },
          // Cache the pages: a long promo needs continuation turns, and each one
          // would otherwise re-read (and re-bill) the whole PDF.
          {
            type: "text",
            text: `${TRANSCRIBE_PROMPT}\n\nPromo: ${promoTitle}`,
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ];

    let out = "";
    // Up to 6 turns: one 32k-token turn covers most promos; the longest VSLs
    // and 60-page magalogs need continuations.
    for (let turn = 0; turn < 6; turn++) {
      const stream = client.beta.messages.stream({
        model: ANALYSIS_MODEL,
        betas: ["files-api-2025-04-14"],
        // Transcription is mechanical — no reasoning budget needed, and thinking
        // tokens would eat the output budget.
        output_config: { effort: "low" },
        max_tokens: 32000,
        messages,
      });
      const msg = await stream.finalMessage();
      // Adaptive thinking can make content[0] a thinking block — take text blocks only.
      const part = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      out += (out && part ? "\n" : "") + part;
      if (msg.stop_reason !== "max_tokens") break;
      messages.push({ role: "assistant", content: part });
      messages.push({
        role: "user",
        content:
          "Continue the transcription from exactly where you stopped. Do not repeat any text you already produced, and do not add commentary.",
      });
    }
    return out.trim();
  } finally {
    if (fileId) void client.beta.files.delete(fileId).catch(() => {});
  }
}

/**
 * Only one vision transcription at a time. Each holds a large PDF buffer for
 * several minutes after the analysis response has already closed; two
 * concurrent 80 MB scans is exactly the memory profile that has OOM'd this
 * service before (the analyze route's maxDuration was cut for the same reason).
 */
let visionChain: Promise<unknown> = Promise.resolve();
function queueVision<T>(fn: () => Promise<T>): Promise<T> {
  const run = visionChain.then(fn, fn);
  visionChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export type SourceMode = "text" | "vision" | "none";

export interface SourceCopyParams {
  reviewId: string;
  promoTitle: string;
  filename: string;
  date: string;
  publisher?: string | null;
  gurus?: string[];
  product?: string | null;
  promoCode?: string | null;
  effectivenessScore?: number | null;
  /** Extracted text when the source has a text layer. */
  text?: string;
  /** Raw PDF for the vision path (scanned/visual promos with no text layer). */
  pdfBuffer?: Buffer;
  /**
   * Set when the text extractor covered only the first N pages of a long PDF —
   * surfaced on the note so a partial copy is never mistaken for the whole promo.
   */
  pageNote?: string;
}

export interface SourceCopyResult {
  ok: boolean;
  mode: SourceMode;
  title?: string;
  words?: number;
  linked?: boolean;
  error?: string;
}

export function buildSourceNote(
  params: SourceCopyParams,
  body: string,
  mode: Exclude<SourceMode, "none">,
  truncatedByCap: boolean
): string {
  const { promoTitle, filename, date, publisher, gurus, product, promoCode, effectivenessScore, reviewId } = params;
  const today = new Date().toISOString().slice(0, 10);
  const sourceFormat =
    mode === "vision" ? "visual-pdf (vision transcription)" : filename.toLowerCase().endsWith(".pdf") ? "pdf (text layer)" : "document/transcript";

  const links: string[] = [`- **Analysis:** [[${promoTitle}]]`, `- **Intel:** [[${intelNoteTitle(promoTitle)}]]`];
  if (publisher) links.push(`- **Publisher:** [[${publisher}]]`);
  if (gurus?.length) links.push(`- **Guru(s):** ${gurus.map((g) => `[[${g}]]`).join(", ")}`);
  if (product) links.push(`- **Product:** [[${product}]]`);
  if (promoCode) links.push(`- **Creative Code:** ${promoCode}`);

  const lines: (string | null)[] = [
    "---",
    `title: ${yamlQuote(sourceNoteTitle(promoTitle))}`,
    "status: source",
    `review_id: ${reviewId}`,
    `source_file: ${yamlQuote(filename)}`,
    `source_format: ${yamlQuote(sourceFormat)}`,
    `analysis: ${yamlQuote(`[[${promoTitle}]]`)}`,
    effectivenessScore != null ? `effectiveness: ${effectivenessScore}/10` : null,
    `words: ${countWords(body)}`,
    `analyzed: ${date}`,
    `created: ${today}`,
    `updated: ${today}`,
    "tags:",
    "  - promo-source",
    "  - promo-copy",
    "  - machine-written",
    mode === "vision" ? "  - vision-transcribed" : null,
    "---",
    "",
    `# ${sourceNoteTitle(promoTitle)}`,
    "",
    "Full source copy of the promo, exactly as analyzed. Machine-written — do not hand-edit; re-teach the promo to regenerate.",
    "",
    ...links,
    "",
    mode === "vision"
      ? "> [!info] This promo had no text layer (scanned/visual PDF). The copy below is a vision transcription of the pages — faithful, but verify wording before quoting it as verbatim.\n"
      : null,
    truncatedByCap
      ? "> [!warning] Source exceeded the note size cap and was truncated here. The complete file remains on the analyzer volume.\n"
      : null,
    params.pageNote ? `> [!warning] ${params.pageNote} The remaining pages are not in this note.\n` : null,
    "---",
    "",
    body,
    "",
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * Write (or refresh) a promo's Source Copy note and link it from the analysis
 * note. Never throws.
 */
export async function writeSourceCopyNote(params: SourceCopyParams): Promise<SourceCopyResult> {
  try {
    let mode: SourceMode = "none";
    let body = "";

    if (params.text?.trim()) {
      mode = "text";
      body = tidy(params.text);
    } else if (params.pdfBuffer) {
      mode = "vision";
      const pdf = params.pdfBuffer;
      body = tidy(await queueVision(() => transcribePdfVisually(pdf, params.promoTitle)));
      if (!body) return { ok: false, mode, error: "vision transcription returned nothing" };
    } else {
      return { ok: false, mode: "none", error: "no source text or pdf" };
    }

    let truncatedByCap = false;
    if (body.length > MAX_NOTE_CHARS) {
      body = body.slice(0, MAX_NOTE_CHARS);
      truncatedByCap = true;
    }

    const title = sourceNoteTitle(params.promoTitle);
    const content = buildSourceNote(params, body, mode, truncatedByCap);
    const res = await writeBrainNote(title, content, "source-copy");
    if (!res.ok) return { ok: false, mode, title, error: res.error };

    // Forward link from the analysis note (Obsidian backlinks cover the reverse,
    // but the publisher asked for an explicit link on the analysis note).
    const linked = await addLineToBrainNote(
      params.promoTitle,
      "promo-analysis-tool",
      `- **Full Copy:** [[${title}]]`,
      /^- \*\*Review ID:\*\*/
    );

    return { ok: true, mode, title, words: countWords(body), linked: linked.ok };
  } catch (err) {
    const error = err instanceof Error ? err.message : "source copy write failed";
    console.warn(`[source-copy] failed for ${params.reviewId}: ${error}`);
    return { ok: false, mode: "none", error };
  }
}
