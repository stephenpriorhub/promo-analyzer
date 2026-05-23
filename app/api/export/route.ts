import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildExportDocx } from "@/lib/export-docx";
import type { AnalysisSections } from "@/lib/reviews-store";
import type { FKScore } from "@/lib/fk-score";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filename, sections, fkScore } = body as {
      filename: string;
      sections: AnalysisSections;
      fkScore: FKScore | null;
    };

    const bytes = await buildExportDocx(filename, sections, fkScore);

    const safeName = filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_");
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName}_analysis.docx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
