import mammoth from "mammoth";

export type ExtractedFile =
  | { type: "text"; content: string }
  | { type: "pdf"; base64: string };

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
    const base64 = buffer.toString("base64");
    return { type: "pdf", base64 };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}
