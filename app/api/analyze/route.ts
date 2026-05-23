import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractFile } from "@/lib/extract-text";
import { calculateFKScore } from "@/lib/fk-score";
import { SYSTEM_PROMPT } from "@/lib/build-prompt";
import { saveReview, type AnalysisSections } from "@/lib/reviews-store";

export const runtime = "nodejs";
export const maxDuration = 120;

const client = new Anthropic();

function parseSections(fullText: string): AnalysisSections {
  function extract(tag: string): string {
    const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
    const match = fullText.match(re);
    return match ? match[1].trim() : "";
  }
  return {
    headline: extract("HEADLINE"),
    outline: extract("OUTLINE"),
    evaldo: extract("EVALDO"),
    cub: extract("CUB"),
    offer: extract("OFFER"),
    stockTease: extract("STOCK_TEASE"),
    effectiveness: extract("EFFECTIVENESS"),
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const extracted = await extractFile(buffer, file.name);

    const fkScore =
      extracted.type === "text" ? calculateFKScore(extracted.content) : null;

    const userContent: Anthropic.MessageParam["content"] =
      extracted.type === "pdf"
        ? [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: extracted.base64,
              },
            } as Anthropic.DocumentBlockParam,
            {
              type: "text",
              text: "Analyze this promotional sales letter according to the instructions.",
            },
          ]
        : [
            {
              type: "text",
              text: `Analyze this promotional sales letter according to the instructions.\n\n---\n\n${extracted.content}`,
            },
          ];

    const encoder = new TextEncoder();
    let fullText = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const anthropicStream = await client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 8000,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent }],
          });

          for await (const chunk of anthropicStream) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta"
            ) {
              const text = chunk.delta.text;
              fullText += text;
              controller.enqueue(encoder.encode(text));
            }
          }

          const sections = parseSections(fullText);
          const saved = saveReview(
            file.name,
            sections,
            fkScore?.readingEase ?? null,
            fkScore?.gradeLevel ?? null
          );

          const meta = JSON.stringify({
            __meta: true,
            reviewId: saved.id,
            fkScore,
          });
          controller.enqueue(encoder.encode(`\n[META]${meta}[/META]`));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Analysis failed. Check server logs." },
      { status: 500 }
    );
  }
}
