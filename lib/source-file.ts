/**
 * Stored-source reader — the one place that knows how a promo's original
 * upload is persisted on disk (`<DATA_DIR>/files/<reviewId>/source.{docx,pdf}`)
 * and how to turn it back into something a model can read.
 *
 * Returns extracted text when the file has a text layer, otherwise the raw PDF
 * buffer for the vision path (scanned/visual promos). Shared by the corpus
 * extractor and the Source Copy vault writer so both see the same source.
 */

import fs from "fs";
import path from "path";
import { FILES_DIR } from "./reviews-store";
import { extractFile } from "./extract-text";

export interface StoredSource {
  text?: string;
  pdf?: Buffer;
  /** Extension of the stored file, for provenance in notes. */
  ext?: "docx" | "pdf";
  /** Set when text extraction covered only the first N pages of a long PDF. */
  pageNote?: string;
  why?: string;
}

/** Pull the promo's source: extracted text when available, else the raw PDF for the vision path. */
export async function readStoredSource(reviewId: string): Promise<StoredSource> {
  const dir = path.join(FILES_DIR, reviewId);
  for (const ext of ["docx", "pdf"] as const) {
    const p = path.join(dir, `source.${ext}`);
    if (!fs.existsSync(p)) continue;
    const buffer = fs.readFileSync(p);
    const extracted = await extractFile(buffer, `source.${ext}`);
    if (extracted.type === "text" && extracted.content?.trim())
      return { text: extracted.content, ext, pageNote: extracted.pageNote };
    if (extracted.type === "pdf_raw") {
      if (extracted.textForFK?.trim()) return { text: extracted.textForFK, ext, pageNote: extracted.pageNote };
      // Scanned/visual PDF — no text layer; hand back the buffer to be read visually.
      return { pdf: buffer, ext };
    }
  }
  return { why: "no stored source file" };
}
