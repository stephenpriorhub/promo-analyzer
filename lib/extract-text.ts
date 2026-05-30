import mammoth from "mammoth";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buf: Buffer,
  opts?: { max?: number }
) => Promise<{ text: string; numpages?: number }>;

export type ExtractedFile =
  | { type: "text"; content: string; pageNote?: string }
  | { type: "pdf_raw"; buffer: Buffer; textForFK?: string; pageNote?: string };

const SCANNED_THRESHOLD = 200;
const MAX_TEXT_PAGES = 60;

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
    // Try to pull plain text (for FK score + text-based analysis fallback)
    let textForFK: string | undefined;
    let totalPages = 0;
    let pageNote: string | undefined;

    try {
      const meta = await pdfParse(buffer, { max: 1 });
      totalPages = meta.numpages ?? 0;
    } catch { /* ignore */ }

    try {
      const opts = totalPages > MAX_TEXT_PAGES ? { max: MAX_TEXT_PAGES } : undefined;
      const data = await pdfParse(buffer, opts);
      const text = data.text?.trim() ?? "";
      if (text.length >= SCANNED_THRESHOLD) {
        textForFK = text;
        if (totalPages > MAX_TEXT_PAGES) {
          pageNote = `Note: This PDF has ${totalPages} pages. Analysis covers the first ${MAX_TEXT_PAGES} pages.`;
        }
      }
    } catch { /* image-based PDF — no text to extract */ }

    // Always return the raw buffer so the route can upload via Files API.
    // Claude handles text-based, image-based, and mixed PDFs natively.
    return { type: "pdf_raw", buffer, textForFK, pageNote };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}
