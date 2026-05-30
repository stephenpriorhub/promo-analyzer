import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const BRAIN_DIR = "/Users/stephenprior/Documents/github/brain/Resources/Promo Analysis/Promo Analysis Tool";

export async function POST(req: NextRequest) {
  const { title, content } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }

  // Sanitize filename — strip characters illegal in macOS/NTFS filenames
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, "-").trim();
  if (!safeTitle) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }

  const filepath = path.join(BRAIN_DIR, `${safeTitle}.md`);

  // Validate the resolved path stays inside the brain dir
  if (!filepath.startsWith(BRAIN_DIR + path.sep) && filepath !== BRAIN_DIR) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    fs.writeFileSync(filepath, content, "utf-8");
    return NextResponse.json({ ok: true, path: filepath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
