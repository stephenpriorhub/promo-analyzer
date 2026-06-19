import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { extractFile } from "@/lib/extract-text";
import { calculateFKScore, type FKScore } from "@/lib/fk-score";
import { SYSTEM_PROMPT, buildCalibrationBlock } from "@/lib/build-prompt";
import { saveReview, getTrainingExamples, updateSourceFileMeta, FILES_DIR, type AnalysisSections } from "@/lib/reviews-store";
import { getAllLessons, buildLearningBlock } from "@/lib/learning-kb";
import { loadBrainContext, buildBrainContextBlock, loadPublishingDirectory, buildDirectoryBlock, matchDirectoryEntities, buildDirectiveBlock, loadMarketIntelligence, buildIndustrySignalsBlock, detectGuru, detectPublisher } from "@/lib/brain-reader";
import { parsePromoIntel, buildIntelNote, intelNoteTitle } from "@/lib/promo-intel";
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
  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  let uploadedFileId: string | null = null;

  // Build calibration block from past reviews with training data (tiered: gold vs. standard)
  const trainingExamples = getTrainingExamples();
  const calibrationBlock = buildCalibrationBlock(trainingExamples);

  // Build learning KB block (generalizable lessons that survive delete/re-upload)
  const lessons = getAllLessons();
  const learningBlock = buildLearningBlock(lessons);

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    // Approx date the promo started running (optional) — captured at upload
    const promoRunStartDate = (formData.get("promoRunStartDate") as string | null)?.trim() || null;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const extracted = await extractFile(buffer, file.name);

    // FK score from text when available
    let fkScore: FKScore | null = null;
    if (extracted.type === "text") {
      fkScore = calculateFKScore(extracted.content);
    } else if (extracted.type === "pdf_raw" && extracted.textForFK) {
      fkScore = calculateFKScore(extracted.textForFK);
    }

    // Detect guru/publisher from raw text before analysis so we can inject
    // brain vault context into the system prompt
    const rawTextForDetection =
      extracted.type === "text"
        ? extracted.content
        : extracted.type === "pdf_raw" && extracted.textForFK
        ? extracted.textForFK
        : "";
    const brainCtx = await loadBrainContext(rawTextForDetection);
    const brainContextBlock = buildBrainContextBlock(brainCtx);
    const directoryText = await loadPublishingDirectory();
    const directoryBlock = buildDirectoryBlock(directoryText);
    // Deterministic match: code finds the guru/publication in the copy and forces attribution
    const directiveBlock = buildDirectiveBlock(matchDirectoryEntities(rawTextForDetection, directoryText));
    // Industry signals layer (secondary) — affiliate traction + topic frequency, gated by run date
    const industrySignalsBlock = buildIndustrySignalsBlock(promoRunStartDate, await loadMarketIntelligence());
    const systemPrompt = SYSTEM_PROMPT + calibrationBlock + learningBlock + directoryBlock + brainContextBlock + directiveBlock + industrySignalsBlock;

    const isPdf = extracted.type === "pdf_raw";

    if (isPdf) {
      // Upload via Files API
      const uploadedFile = await client.beta.files.upload({
        file: new File([Uint8Array.from(buffer)], file.name, { type: "application/pdf" }),
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
            // PDF path: use beta.messages with files-api beta enabled
            anthropicStream = await client.beta.messages.stream({
              model: "claude-sonnet-4-6",
              max_tokens: 16000,
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
            // Text path (.docx or text-extracted PDF)
            const textContent =
              extracted.type === "text" ? extracted.content : "";
            anthropicStream = await client.messages.stream({
              model: "claude-sonnet-4-6",
              max_tokens: 16000,
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

          console.log("RAW PREVIEW:", JSON.stringify(fullText.slice(0, 300)));

          const sections = parseSections(fullText);
          const saved = saveReview(
            file.name,
            sections,
            fkScore?.readingEase ?? null,
            fkScore?.gradeLevel ?? null,
            promoRunStartDate
          );

          // Save original source file to disk
          try {
            const fileDir = path.join(FILES_DIR, saved.id);
            fs.mkdirSync(fileDir, { recursive: true });
            const ext = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
            fs.writeFileSync(path.join(fileDir, `source.${ext}`), buffer);
            updateSourceFileMeta(saved.id, file.name, buffer.length);
          } catch {
            // non-fatal — analysis proceeds even if file save fails
          }

          const meta = JSON.stringify({ __meta: true, reviewId: saved.id, fkScore });
          controller.enqueue(encoder.encode(`\n[META]${meta}[/META]`));
          controller.close();

          // Fire-and-forget: auto-save to brain vault after every successful analysis
          (() => {
            const baseUrl =
              process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
              `http://${req.headers.get("host") ?? "localhost:3000"}`;
            const promoTitle = saved.displayName ?? saved.filename.replace(/\.[^.]+$/, "");
            const fkLine = fkScore
              ? `- **FK Reading Ease:** ${fkScore.readingEase.toFixed(1)} | **FK Grade Level:** ${fkScore.gradeLevel.toFixed(1)}`
              : "";
            const brainContent = [
              `# ${promoTitle}`,
              "",
              `- **Analyzed:** ${saved.date}`,
              `- **Review ID:** ${saved.id}`,
              saved.effectivenessScore != null
                ? `- **Effectiveness Score:** ${saved.effectivenessScore}/10`
                : "",
              fkLine,
              "",
              "## Headline Analysis",
              saved.sections.headline,
              "",
              "## Outline",
              saved.sections.outline,
              "",
              "## Evaldo Score",
              saved.sections.evaldo,
              "",
              "## CUB Score",
              saved.sections.cub,
              "",
              "## Offer Analysis",
              saved.sections.offer,
              "",
              "## Stock Tease",
              saved.sections.stockTease,
              "",
              "## Effectiveness",
              saved.sections.effectiveness,
            ]
              .filter((l) => l !== undefined)
              .join("\n");

            fetch(`${baseUrl}/api/brain`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: promoTitle,
                content: brainContent,
                subfolder: "promo-analysis-tool",
              }),
            })
              .then((r) => {
                if (r.ok) {
                  console.log(`[brain] Auto-saved review ${saved.id} to brain vault`);
                } else {
                  r.json()
                    .catch(() => ({}))
                    .then((e) =>
                      console.warn(`[brain] Auto-save failed for ${saved.id}:`, e)
                    );
                }
              })
              .catch((e) => console.warn(`[brain] Auto-save error for ${saved.id}:`, e));

            // Fire-and-forget: write structured promo intelligence to the vault's
            // Promo Intelligence inbox for the Brain Agent to review and merge.
            const intel = parsePromoIntel(saved.sections.promoIntel);
            if (intel) {
              const intelContent = buildIntelNote(
                intel,
                promoTitle,
                saved.date,
                saved.id,
                saved.effectivenessScore
              );
              fetch(`${baseUrl}/api/brain`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: intelNoteTitle(promoTitle),
                  content: intelContent,
                  subfolder: "promo-intelligence",
                }),
              })
                .then((r) => {
                  if (r.ok) console.log(`[brain] Saved promo intel for ${saved.id}`);
                })
                .catch((e) => console.warn(`[brain] Intel save error for ${saved.id}:`, e));
            }
          })();
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
      { error: err instanceof Error ? err.message : "Analysis failed." },
      { status: 500 }
    );
  }
}
