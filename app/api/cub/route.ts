import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ANALYSIS_MODEL } from "@/lib/models";
import { extractFile } from "@/lib/extract-text";
import { CUB_SYSTEM_PROMPT } from "@/lib/build-prompt";
import { updateReviewCUB } from "@/lib/reviews-store";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  let uploadedFileId: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const reviewId = formData.get("reviewId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const extracted = await extractFile(buffer, file.name);
    const isPdf = extracted.type === "pdf_raw";

    if (isPdf) {
      const uploadedFile = await client.beta.files.upload({
        file: new File([new Uint8Array(extracted.buffer)], file.name, { type: "application/pdf" }),
      });
      uploadedFileId = uploadedFile.id;
    }

    const encoder = new TextEncoder();
    let fullText = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let anthropicStream;

          if (isPdf && uploadedFileId) {
            anthropicStream = await client.beta.messages.stream({
              model: ANALYSIS_MODEL,
              max_tokens: 32000,
              system: CUB_SYSTEM_PROMPT,
              betas: ["files-api-2025-04-14"],
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "document", source: { type: "file", file_id: uploadedFileId } },
                    { type: "text", text: "Perform the CUB review of this promo. Output only the JSON array." },
                  ],
                },
              ],
            });
          } else {
            const textContent = extracted.type === "text" ? extracted.content : "";
            anthropicStream = await client.messages.stream({
              model: ANALYSIS_MODEL,
              max_tokens: 32000,
              system: CUB_SYSTEM_PROMPT,
              messages: [
                {
                  role: "user",
                  content: `Perform the CUB review of this promo. Output only the JSON array.\n\n---\n\n${textContent}`,
                },
              ],
            });
          }

          // Wrap in [CUB]...[/CUB] so page.tsx can parse it with the same regex
          controller.enqueue(encoder.encode("[CUB]\n"));

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

          controller.enqueue(encoder.encode("\n[/CUB]"));

          // Persist CUB to the saved review if we have its ID
          if (reviewId) {
            updateReviewCUB(reviewId, fullText.trim());
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
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
    if (uploadedFileId) {
      client.beta.files.delete(uploadedFileId).catch(() => {});
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "CUB analysis failed." },
      { status: 500 }
    );
  }
}
