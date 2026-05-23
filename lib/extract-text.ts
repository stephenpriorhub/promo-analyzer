import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export type ExtractedFile =
  | { type: "text"; content: string }
  | { type: "pdf_vision"; base64: string };

const SCANNED_THRESHOLD = 200; // chars — below this, assume scanned/image-only
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
    // Try text extraction first — works for all digital/typed PDFs
    try {
      const data = await pdfParse(buffer);
      const text = data.text?.trim() ?? "";
      if (text.length >= SCANNED_THRESHOLD) {
        return { type: "text", content: text };
      }
    } catch {
      // fall through to vision
    }

    // Scanned/image-only PDF — send as base64 for Claude vision
    const base64 = buffer.toString("base64");
    const sizeMB = base64.length / 1024 / 1024;
    if (sizeMB > MAX_PDF_VISION_MB) {
      throw new Error(
        `This PDF appears to be a scanned image and is too large to process via vision (${sizeMB.toFixed(1)} MB base64). ` +
        `Please try a file under ${MAX_PDF_VISION_MB} MB, or export a text-based PDF.`
      );
    }
    return { type: "pdf_vision", base64 };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}
