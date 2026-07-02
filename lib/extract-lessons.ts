/**
 * Lesson extraction — shared logic.
 *
 * Called directly in-process from the training-save handler (no fragile
 * self-HTTP-fetch) and from the /api/learning/extract route. Sends the promo
 * analysis + publisher feedback to Claude and stores 1-3 generalizable lessons
 * in the learning KB. These survive delete/re-upload.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";
import { EXTRACTION_MODEL } from "@/lib/models";
import { addLessons, type Lesson, type LessonCategory, type PerformanceTier } from "@/lib/learning-kb";

const EXTRACT_PROMPT = `You are a financial copywriting analyst extracting generalizable lessons from a promo performance training event.

## What You Are Analyzing
A promo was analyzed by this tool, scored, then the publisher provided real-world performance feedback. Your job is to extract 1-3 GENERALIZABLE lessons — principles that will help score FUTURE promos more accurately.

## Promo Details
Name: {PROMO_NAME}
Publisher: {PUBLISHER}
Guru/Editor: {GURU}
Promo Type: {PROMO_TYPE}

## Tool's Original Effectiveness Analysis
{EFFECTIVENESS}

## Publisher Feedback
Actual market performance: {PERF_SCORE}/10
Publisher's assessment: {MY_SCORE}/10
Publisher notes: {REASONING}

## Instructions
Extract 1-3 lessons that meet ALL of these criteria:
1. **Generalizable** — applies to future promos, not just this one. Write "Promos that [X]..." not "This promo..."
2. **Specific** — names the pattern, mechanism, hook type, or structural element. No vague observations.
3. **Actionable** — tells a future scorer what to weight higher or lower, and why.
4. **Evidence-grounded** — explains what the gap between predicted and actual score reveals.

If the tool's score was accurate (predicted ≈ actual), still extract a lesson about WHY this type of promo scores where it does — that calibration is valuable.

ALWAYS return at least one lesson. You are never allowed to return an empty array.

For each lesson, determine:
- category: one of hook | mechanism | offer | audience | structure | proof | credibility | guru | scoring_calibration
- isGoldStandard: true ONLY if performanceScore is 9 or 10, OR the publisher explicitly described this as a top/all-time performer
- performanceTier: gold_standard (9-10) | strong (7-8) | average (5-6) | weak (3-4) | failed (1-2)`;

const LESSON_TOOL: Anthropic.Tool = {
  name: "record_lessons",
  description: "Record the generalizable lessons extracted from this promo training event.",
  // strict guarantees the input validates against the schema exactly — without
  // it the model occasionally emitted `lessons` as a non-array and broke parsing.
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      lessons: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            lesson: { type: "string", description: "The generalizable insight, written as a principle" },
            category: {
              type: "string",
              enum: ["hook", "mechanism", "offer", "audience", "structure", "proof", "credibility", "guru", "scoring_calibration"],
            },
            isGoldStandard: { type: "boolean" },
            performanceTier: {
              type: "string",
              enum: ["gold_standard", "strong", "average", "weak", "failed"],
            },
          },
          required: ["lesson", "category", "isGoldStandard", "performanceTier"],
        },
      },
    },
    required: ["lessons"],
  },
};

interface ExtractedLesson {
  lesson: string;
  category: LessonCategory;
  isGoldStandard: boolean;
  performanceTier: PerformanceTier;
}

export interface ExtractLessonParams {
  promoName?: string | null;
  publisher?: string | null;
  guru?: string | null;
  promoType?: string | null;
  effectiveness?: string | null;
  performanceScore?: number | null;
  myScore?: number | null;
  reasoning?: string | null;
}

export interface ExtractResult {
  ok: boolean;
  lessonsAdded: number;
  skipped?: boolean;
  error?: string;
}

/**
 * Extract lessons via Claude and store them. Uses forced tool-use so the
 * model MUST return structured data — no brittle JSON-in-text parsing.
 */
export async function extractAndStoreLessons(params: ExtractLessonParams): Promise<ExtractResult> {
  const { promoName, publisher, guru, promoType, effectiveness, performanceScore, myScore, reasoning } = params;

  // Need an effectiveness analysis and at least one score to learn from
  if (!effectiveness || (performanceScore == null && myScore == null)) {
    return { ok: true, lessonsAdded: 0, skipped: true };
  }

  try {
    const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });

    const prompt = EXTRACT_PROMPT
      .replace("{PROMO_NAME}", promoName ?? "Unknown")
      .replace("{PUBLISHER}", publisher ?? "Unknown")
      .replace("{GURU}", guru ?? "Unknown")
      .replace("{PROMO_TYPE}", promoType ?? "Unknown")
      .replace("{EFFECTIVENESS}", effectiveness?.trim() || "Not available")
      .replace("{PERF_SCORE}", performanceScore != null ? String(performanceScore) : "not provided")
      .replace("{MY_SCORE}", myScore != null ? String(myScore) : "not provided")
      .replace("{REASONING}", reasoning?.trim() || "No additional notes.");

    const message = await client.messages.create({
      model: EXTRACTION_MODEL,
      // Structured summarization — low effort keeps Sonnet 5 fast here, so a
      // multi-promo teach pass stays well inside the route's time budget.
      output_config: { effort: "low" },
      max_tokens: 1024,
      tools: [LESSON_TOOL],
      tool_choice: { type: "tool", name: "record_lessons" },
      messages: [{ role: "user", content: prompt }],
    });

    // With forced tool_choice the model returns a tool_use block — read it directly
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    // Belt-and-suspenders alongside strict: never trust the shape blindly.
    const rawLessons = (toolUse?.input as { lessons?: unknown })?.lessons;
    const extracted: ExtractedLesson[] = Array.isArray(rawLessons)
      ? (rawLessons as ExtractedLesson[])
      : [];

    if (extracted.length === 0) {
      return { ok: true, lessonsAdded: 0 };
    }

    const lessonsToAdd: Omit<Lesson, "id" | "createdAt" | "updatedAt">[] = extracted.map((l) => ({
      lesson: l.lesson,
      guru: guru ?? null,
      publication: publisher ?? null,
      promoType: promoType ?? null,
      category: l.category,
      evidenceCount: 1,
      supportingPromos: promoName ? [promoName] : [],
      predictedScore: null,
      actualPerformance: performanceScore ?? null,
      performanceTier: l.performanceTier,
      isGoldStandard: l.isGoldStandard || (performanceScore != null && performanceScore >= 9),
      publisherReasoning: reasoning?.trim() || "",
    }));

    addLessons(lessonsToAdd);

    return { ok: true, lessonsAdded: lessonsToAdd.length };
  } catch (err) {
    console.error("[extract-lessons]", err);
    return { ok: false, lessonsAdded: 0, error: err instanceof Error ? err.message : "extraction failed" };
  }
}
