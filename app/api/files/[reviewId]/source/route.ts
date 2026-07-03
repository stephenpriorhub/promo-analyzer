import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { FILES_DIR, getReviewById, updateSourceFileMeta } from "@/lib/reviews-store";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB — Railway proxy limit

/** POST — upload/replace the source file for an existing review */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;
  const review = getReviewById(reviewId);
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is 100MB.` },
      { status: 413 }
    );
  }

  const ext = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
  const fileDir = path.join(FILES_DIR, reviewId);
  fs.mkdirSync(fileDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  fs.writeFileSync(path.join(fileDir, `source.${ext}`), buffer);
  updateSourceFileMeta(reviewId, file.name, buffer.length);

  return NextResponse.json({ ok: true, filename: file.name, size: buffer.length });
}

/** GET — serve source file, streaming to avoid loading large files into RAM */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;
  const review = getReviewById(reviewId);
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const fileDir = path.join(FILES_DIR, reviewId);
  const filename = review.sourceFile?.filename ?? review.filename;
  const ext = filename.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
  const filePath = path.join(fileDir, `source.${ext}`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Source file not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const contentType =
    ext === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const disposition =
    ext === "pdf" ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`;

  // Stream the file rather than loading it all into RAM
  const fileStream = fs.createReadStream(filePath);
  const readable = new ReadableStream({
    start(controller) {
      fileStream.on("data", (chunk) => controller.enqueue(chunk));
      fileStream.on("end", () => controller.close());
      fileStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      fileStream.destroy();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
