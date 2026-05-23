import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractFile } from "@/lib/extract-text";
import { calculateFKScore, type FKScore } from "@/lib/fk-score";
import { SYSTEM_PROMPT } from "@/lib/build-prompt";
import { saveReview, type AnalysisSections } from "@/lib/reviews-store";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 180;

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
  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  let uploadedFileId: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const extracted = await extractFile(buffer, file.name);

    // FK score: calculate from text if available
    let fkScore: FKScore | null = null;
    if (extracted.type === "text") {
      fkScore = calculateFKScore(extracted.content);
    } else if (extracted.type === "pdf_raw" && extracted.textForFK) {
      fkScore = calculateFKScore(extracted.textForFK);
    }

    // Build the message content
    let userContent: Anthropic.MessageParam["content"];

    if (extracted.type === "pdf_raw") {
      // Upload PDF via Files API — works for text-based, image-based, scanned, jsPDF, any PDF
      const uploadedFile = await client.beta.files.upload({
        file: new File([extracted.buffer], file.name, { type: "application/pdf" }),
      });
      uploadedFileId = uploadedFile.id;

      const preamble = [
        "Analyze this promotional sales letter according to the instructions.",
        extracted.pageNote ? `\n${extracted.pageNote}` : "",
      ].join("");

      userContent = [
        {
          type: "document",
          source: { type: "file", file_id: uploadedFileId },
        } as Anthropic.DocumentBlockParam,
        { type: "text", text: preamble },
      ];
    } else {
      // .docx — use extracted text directly
      userContent = [
        {
          type: "text",
          text: [
            "Analyze this promotional sales letter according to the instructions.",
            extracted.pageNote ? `\n${extracted.pageNote}` : "",
            "\n\n---\n\n",
            extracted.content,
          ].join(""),
        },
      ];
    }

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

          const meta = JSON.stringify({ __meta: true, reviewId: saved.id, fkScore });
          controller.enqueue(encoder.encode(`\n[META]${meta}[/META]`));
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          // Clean up uploaded file from Anthropic's storage
          if (uploadedFileId) {
            client.beta.files.delete(uploadedFileId).catch(() => {});
          }
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
    // Clean up uploaded file on error
    if (uploadedFileId) {
      client.beta.files.delete(uploadedFileId).catch(() => {});
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed. Check server logs." },
      { status: 500 }
    );
  }
}
