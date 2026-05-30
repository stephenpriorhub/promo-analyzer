import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { FILES_DIR, getReviewById, removeSupplementalFile } from "@/lib/reviews-store";

export const runtime = "nodejs";

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  return "application/octet-stream";
}

/** GET — download a supplemental file */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ reviewId: string; fileId: string }> }
) {
  const { reviewId, fileId } = await params;
  const review = getReviewById(reviewId);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const fileMeta = review.supplementalFiles?.find((f) => f.id === fileId);
  if (!fileMeta) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const origExt = fileMeta.filename.includes(".") ? fileMeta.filename.split(".").pop()! : "bin";
  const storedFilename = `${fileId}.${origExt}`;
  const filePath = path.join(FILES_DIR, reviewId, storedFilename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const mimeType = getMimeType(fileMeta.filename);
  const isPdf = mimeType === "application/pdf";

  return new Response(buffer, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename="${fileMeta.filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

/** DELETE — remove a supplemental file */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ reviewId: string; fileId: string }> }
) {
  const { reviewId, fileId } = await params;
  const removed = removeSupplementalFile(reviewId, fileId);
  if (!removed) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Remove physical file (non-fatal)
  try {
    const origExt = removed.filename.includes(".") ? removed.filename.split(".").pop()! : "bin";
    const filePath = path.join(FILES_DIR, reviewId, `${fileId}.${origExt}`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
