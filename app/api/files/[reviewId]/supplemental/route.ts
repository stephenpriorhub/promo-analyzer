import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { FILES_DIR, getReviewById, addSupplementalFile } from "@/lib/reviews-store";

export const runtime = "nodejs";

/** GET — list supplemental files for a review */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;
  const review = getReviewById(reviewId);
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  return NextResponse.json({ files: review.supplementalFiles ?? [] });
}

/** POST — upload a supplemental file */
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
  const category = (formData.get("category") as string) ?? "Other";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const fileId = uuidv4();
  const origExt = file.name.includes(".") ? file.name.split(".").pop()! : "bin";
  const storedFilename = `${fileId}.${origExt}`;
  const fileDir = path.join(FILES_DIR, reviewId);
  fs.mkdirSync(fileDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  fs.writeFileSync(path.join(fileDir, storedFilename), buffer);

  const meta = {
    id: fileId,
    filename: file.name,
    category,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
  };

  addSupplementalFile(reviewId, meta);

  return NextResponse.json({ file: meta });
}
