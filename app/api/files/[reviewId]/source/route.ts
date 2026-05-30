import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { FILES_DIR, getReviewById } from "@/lib/reviews-store";

export const runtime = "nodejs";

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

  const fileBuffer = fs.readFileSync(filePath);
  const contentType =
    ext === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  // inline for PDF (enables browser preview), attachment for docx
  const disposition =
    ext === "pdf"
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(fileBuffer.length),
    },
  });
}
