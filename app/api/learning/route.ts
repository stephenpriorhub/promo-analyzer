/**
 * GET /api/learning
 *
 * Returns all accumulated lessons from the learning knowledge base.
 * Read-only — used by the Lessons Learned view.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllLessons, clearAllLessons } from "@/lib/learning-kb";
import { getHubUser, isHubAdmin, forbidden } from "@/lib/hub-auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getAllLessons());
  } catch (err) {
    console.error("[learning]", err);
    return NextResponse.json([], { status: 200 });
  }
}

export async function DELETE(req: NextRequest) {
  // Wiping the learning KB is destructive and global — hub admins only.
  if (!isHubAdmin(await getHubUser(req))) return forbidden("Only OxfordHub Admins can clear the learning knowledge base.");
  try {
    clearAllLessons();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[learning] clear", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
