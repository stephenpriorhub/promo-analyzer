/**
 * POST /api/learning/extract
 *
 * Thin wrapper over lib/extract-lessons.ts. Kept for compatibility; the
 * training-save handler now calls extractAndStoreLessons() directly in-process.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAndStoreLessons } from "@/lib/extract-lessons";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const result = await extractAndStoreLessons(body);
  return NextResponse.json(result);
}
