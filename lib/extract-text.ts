import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export type ExtractedFile =
  | { type: "text"; content: string; pageNote?: string }
  | { type: "pdf_vision"; base64: string };

const SCANNED_THRESHOLD = 200; // chars — below this, assume scanned/image-only
const MAX_PAGES = 60;          // cap analysis to first 60 pages for large PDFs
const MAX_PDF_VISION_MB = 8;   // base64 size cap for vision fallback

export async function extractFile(
  buffer: Buffer,
  filename: string
): Promise<ExtractedFile> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return { type: "text", content: result.value };
  }

  if (ext === "pdf") {
    // First pass: get total page count
    let totalPages = 0;
    try {
      const meta = await pdfParse(buffer, { max: 1 });
      totalPages = meta.numpages ?? 0;
    } catch { /* ignore */ }

    // Second pass: extract text, capped at MAX_PAGES
    const parsePages = totalPages > MAX_PAGES ? MAX_PAGES : 0; // 0 = all pages
    try {
      const data = await pdfParse(buffer, parsePages > 0 ? { max: parsePages } : undefined);
      const text = data.text?.trim() ?? "";
      if (text.length >= SCANNED_THRESHOLD) {
        const pageNote =
          totalPages > MAX_PAGES
            ? `Note: This PDF has ${totalPages} pages. Analysis is based on the first ${MAX_PAGES} pages.`
            : undefined;
        return { type: "text", content: text, pageNote };
      }
    } catch { /* fall through to vision */ }

    // Scanned/image-only PDF — try sending as base64 for Claude vision
    const base64 = buffer.toString("base64");
    const sizeMB = base64.length / 1024 / 1024;
    if (sizeMB > MAX_PDF_VISION_MB) {
      throw new Error(
        `This PDF has no extractable text and is too large for image-based processing (${sizeMB.toFixed(0)} MB). ` +
        `Please export it as a text-based PDF or paste the copy into a .docx file.`
      );
    }
    return { type: "pdf_vision", base64 };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}
