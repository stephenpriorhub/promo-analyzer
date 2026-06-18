import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const BRAIN_DIR = process.env.BRAIN_DIR
  ?? "/Users/stephenprior/github/brain/Resources/Promo Analysis/Promo Analysis Tool";

// Base of the vault repo (strip the Promo Analysis Tool suffix) for writing to other areas
const BRAIN_VAULT_ROOT = BRAIN_DIR.replace(/\/Resources\/.*$/, "");

const BRAIN_GITHUB_REPO = process.env.BRAIN_GITHUB_REPO ?? "stephenpriorhub/brain";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Known relative subfolders within the vault (validated allowlist — no arbitrary paths)
const SUBFOLDER_MAP: Record<string, string> = {
  "promo-analysis-tool": "Resources/Promo Analysis/Promo Analysis Tool",
  "promo-intelligence": "Resources/Promo Analysis/Promo Intelligence",
};

function resolveRelPath(subfolder: string | undefined, safeTitle: string): string {
  const rel = SUBFOLDER_MAP[subfolder ?? "promo-analysis-tool"]
    ?? SUBFOLDER_MAP["promo-analysis-tool"];
  return `${rel}/${safeTitle}.md`;
}

/** Write via GitHub Contents API — works on Railway without a local vault mount */
async function writeViaGitHub(safeTitle: string, content: string, subfolder?: string) {
  const filePath = resolveRelPath(subfolder, safeTitle);
  const apiBase = `https://api.github.com/repos/${BRAIN_GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "promo-analyzer",
    Accept: "application/vnd.github+json",
  };

  // Check if file already exists (need its SHA to update)
  let sha: string | undefined;
  const check = await fetch(apiBase, { headers });
  if (check.ok) sha = (await check.json()).sha;

  const body: Record<string, string> = {
    message: `Add promo analysis: ${safeTitle}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiBase, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "GitHub write failed");
  }

  return `github:${BRAIN_GITHUB_REPO}/${filePath}`;
}

/** Write directly to local filesystem */
function writeLocally(safeTitle: string, content: string, subfolder?: string): string {
  const relPath = resolveRelPath(subfolder, safeTitle);
  const filepath = path.join(BRAIN_VAULT_ROOT, relPath);
  const targetDir = path.dirname(filepath);
  // Confine writes to the vault root
  if (!filepath.startsWith(BRAIN_VAULT_ROOT + path.sep)) throw new Error("Invalid path");
  if (!fs.existsSync(BRAIN_VAULT_ROOT)) {
    throw new Error("Brain vault not available. Set BRAIN_DIR env var or configure GITHUB_TOKEN.");
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(filepath, content, "utf-8");
  return filepath;
}

export async function POST(req: NextRequest) {
  const { title, content, subfolder } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }

  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, "-").trim();
  if (!safeTitle) return NextResponse.json({ error: "Invalid title" }, { status: 400 });

  try {
    // Prefer GitHub API mode when token is available (works on Railway + locally)
    const savedPath = GITHUB_TOKEN
      ? await writeViaGitHub(safeTitle, content, subfolder)
      : writeLocally(safeTitle, content, subfolder);

    return NextResponse.json({ ok: true, path: savedPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
