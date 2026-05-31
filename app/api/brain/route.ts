import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// Override via BRAIN_DIR env var for different environments.
// If not set, defaults to the local Obsidian vault path.
// On Railway or other servers this feature will be unavailable unless BRAIN_DIR is configured.
const BRAIN_DIR = process.env.BRAIN_DIR
  ?? "/Users/stephenprior/Documents/github/brain/Resources/Promo Analysis/Promo Analysis Tool";

export async function POST(req: NextRequest) {
  const { title, content } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }

  // Check if brain dir is accessible on this host
  if (!fs.existsSync(BRAIN_DIR)) {
    return NextResponse.json(
      { error: "Brain vault not available on this server. Set BRAIN_DIR env var to enable." },
      { status: 503 }
    );
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
