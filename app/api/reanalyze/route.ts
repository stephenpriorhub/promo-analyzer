import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { extractFile } from "@/lib/extract-text";
import { calculateFKScore, type FKScore } from "@/lib/fk-score";
import { SYSTEM_PROMPT, buildCalibrationBlock, buildModalityBlock } from "@/lib/build-prompt";
import {
  getReviewById,
  updateReviewSections,
  updateReviewInputType,
  getTrainingExamples,
  FILES_DIR,
  type AnalysisSections,
} from "@/lib/reviews-store";
import { getAllLessons, buildLearningBlock } from "@/lib/learning-kb";
import { loadBrainContext, buildBrainContextBlock, loadPublishingDirectory, buildDirectoryBlock, matchDirectoryEntities, buildDirectiveBlock, loadMarketIntelligence, buildIndustrySignalsBlock, detectGuru, detectPublisher } from "@/lib/brain-reader";
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
    promoIntel: extract("PROMO_INTEL"),
  };
}

export async function POST(req: NextRequest) {
  const { reviewId } = await req.json();

  if (!reviewId) {
    return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  }

  const review = getReviewById(reviewId);
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  // Find source file on disk
  const fileDir = path.join(FILES_DIR, reviewId);
  let buffer: Buffer | null = null;
  let originalFilename = review.filename;

  for (const ext of ["pdf", "docx"]) {
    const filePath = path.join(fileDir, `source.${ext}`);
    if (fs.existsSync(filePath)) {
      buffer = fs.readFileSync(filePath);
      originalFilename = review.filename;
      break;
    }
  }

  if (!buffer) {
    return NextResponse.json(
      { error: "Source file not found. Original file must have been uploaded to re-analyze." },
      { status: 404 }
    );
  }

  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });

  // Build calibration block (exclude this review itself to avoid circular feedback)
  const trainingExamples = getTrainingExamples().filter(
    (ex) => (review.displayName ?? review.filename.replace(/\.[^.]+$/, "")) !== ex.name
  );
  let uploadedFileId: string | null = null;

  const extracted = await extractFile(buffer, originalFilename);

  // Inject brain vault context (guru profile + copywriting principles)
  const rawTextForDetection =
    extracted.type === "text"
      ? extracted.content
      : extracted.type === "pdf_raw" && extracted.textForFK
      ? extracted.textForFK
      : "";
  const brainContextBlock = buildBrainContextBlock(await loadBrainContext(rawTextForDetection));
  const directoryText = await loadPublishingDirectory();
  const directoryBlock = buildDirectoryBlock(directoryText);
  const directiveBlock = buildDirectiveBlock(matchDirectoryEntities(rawTextForDetection, directoryText));
  // Industry signals layer (secondary), gated by this review's promo run date
  const industrySignalsBlock = buildIndustrySignalsBlock(review.promoRunStartDate ?? null, await loadMarketIntelligence());

  // Input modality (recomputed from the stored source file)
  const isDocx = originalFilename.toLowerCase().endsWith(".docx");
  const inputType: "visual-pdf" | "docx" | "text" =
    extracted.type === "pdf_raw" ? "visual-pdf" : isDocx ? "docx" : "text";
  const isTextOnly = inputType !== "visual-pdf";

  // Targeted injection: select the most relevant calibration examples + lessons
  // by detected guru/publisher and this review's known promoType.
  const detectedGuru = detectGuru(rawTextForDetection) ?? null;
  const detectedPublisher = detectPublisher(rawTextForDetection) ?? null;
  const selectionCtx = {
    guru: detectedGuru,
    promoType: review.training?.promoType ?? null,
    topics: [detectedPublisher].filter((t): t is string => !!t),
  };
  const calibrationBlock = buildCalibrationBlock(trainingExamples, selectionCtx);
  const learningBlock = buildLearningBlock(getAllLessons(), selectionCtx);

  const systemPrompt = SYSTEM_PROMPT + calibrationBlock + learningBlock + directoryBlock + brainContextBlock + directiveBlock + industrySignalsBlock + buildModalityBlock(isTextOnly);

  let fkScore: FKScore | null = null;
  if (extracted.type === "text") {
    fkScore = calculateFKScore(extracted.content);
  } else if (extracted.type === "pdf_raw" && extracted.textForFK) {
    fkScore = calculateFKScore(extracted.textForFK);
  }

  const isPdf = extracted.type === "pdf_raw";

  if (isPdf) {
    const uploadedFile = await client.beta.files.upload({
      file: new File([Uint8Array.from(buffer)], originalFilename, { type: "application/pdf" }),
    });
    uploadedFileId = uploadedFile.id;
  }

  const preamble = [
    "Analyze this promotional sales letter according to the instructions.",
    extracted.type !== "text" && (extracted as { pageNote?: string }).pageNote
      ? `\n${(extracted as { pageNote?: string }).pageNote}`
      : "",
    extracted.type === "text" && extracted.pageNote ? `\n${extracted.pageNote}` : "",
  ].join("");

  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let anthropicStream;

        if (isPdf && uploadedFileId) {
          anthropicStream = await client.beta.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 16000,
            temperature: 0.2,
            system: systemPrompt,
            betas: ["files-api-2025-04-14"],
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: { type: "file", file_id: uploadedFileId },
                  },
                  { type: "text", text: preamble },
                ],
              },
            ],
          });
        } else {
          const textContent = extracted.type === "text" ? extracted.content : "";
          anthropicStream = await client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 16000,
            temperature: 0.2,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `${preamble}\n\n---\n\n${textContent}`,
                  },
                ],
              },
            ],
          });
        }

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
        updateReviewSections(
          reviewId,
          sections,
          fkScore?.readingEase ?? null,
          fkScore?.gradeLevel ?? null
        );
        updateReviewInputType(reviewId, inputType);

        const meta = JSON.stringify({ __meta: true, reviewId, fkScore });
        controller.enqueue(encoder.encode(`\n[META]${meta}[/META]`));
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
}
