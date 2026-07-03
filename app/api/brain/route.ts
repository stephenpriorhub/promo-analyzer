import { NextRequest, NextResponse } from "next/server";
import { writeBrainNote } from "@/lib/brain-writer";
import { getHubUser, forbidden } from "@/lib/hub-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Brain-teaching is open to every signed-in hub user, but never anonymous —
  // this endpoint writes named notes into the vault.
  if (!(await getHubUser(req))) return forbidden("Sign in to OxfordHub to write to the brain.");
  const { title, content, subfolder } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }

  const result = await writeBrainNote(title, content, subfolder);
  if (!result.ok) {
    const status = result.error === "Invalid title" ? 400 : 500;
    return NextResponse.json({ error: result.error ?? "Write failed" }, { status });
  }
  return NextResponse.json({ ok: true, path: result.path });
}
