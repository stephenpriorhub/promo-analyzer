/**
 * POST /api/learning/extract
 *
 * Called after a training event is saved. Sends the promo analysis +
 * publisher feedback to Claude and extracts 1-3 generalizable lessons
 * that get stored in the learning KB.
 *
 * These lessons survive delete/re-upload and accumulate into a growing
 * model of what works and fails for this specific audience.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";
import { addLessons, type Lesson, type LessonCategory, type PerformanceTier } from "@/lib/learning-kb";

export const runtime = "nodejs";

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

For each lesson, determine:
- category: one of hook | mechanism | offer | audience | structure | proof | credibility | guru | scoring_calibration
- isGoldStandard: true ONLY if performanceScore is 9 or 10, OR the publisher explicitly described this as a top/all-time performer
- performanceTier: gold_standard (9-10) | strong (7-8) | average (5-6) | weak (3-4) | failed (1-2)

Output a JSON array of lesson objects. No preamble, no markdown fences. Start with [.

Schema for each object:
{
  "lesson": "string — the generalizable insight, written as a principle",
  "category": "hook | mechanism | offer | audience | structure | proof | credibility | guru | scoring_calibration",
  "isGoldStandard": boolean,
  "performanceTier": "gold_standard | strong | average | weak | failed"
}

Example output:
[
  {
    "lesson": "Bryan Bottarelli promos that pivot from options mechanics to macro themes (nuclear, geopolitics) in the bonus section consistently underperform their predicted score — the topic shift breaks the reader's emotional concentration built around the core mechanism.",
    "category": "structure",
    "isGoldStandard": false,
    "performanceTier": "weak"
  }
]`;

interface ExtractedLesson {
  lesson: string;
  category: LessonCategory;
  isGoldStandard: boolean;
  performanceTier: PerformanceTier;
}

export async function POST(req: NextRequest) {
  try {
    const {
      promoName,
      publisher,
      guru,
      promoType,
      effectiveness,
      performanceScore,
      myScore,
      reasoning,
    } = await req.json();

    if (!effectiveness || (performanceScore === null && myScore === null)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });

    const prompt = EXTRACT_PROMPT
      .replace("{PROMO_NAME}", promoName ?? "Unknown")
      .replace("{PUBLISHER}", publisher ?? "Unknown")
      .replace("{GURU}", guru ?? "Unknown")
      .replace("{PROMO_TYPE}", promoType ?? "Unknown")
      .replace("{EFFECTIVENESS}", effectiveness?.trim() ?? "Not available")
      .replace("{PERF_SCORE}", performanceScore !== null ? String(performanceScore) : "not provided")
      .replace("{MY_SCORE}", myScore !== null ? String(myScore) : "not provided")
      .replace("{REASONING}", reasoning?.trim() || "No additional notes.");

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : "[]";

    let extracted: ExtractedLesson[] = [];
    try {
      extracted = JSON.parse(text);
      if (!Array.isArray(extracted)) extracted = [];
    } catch {
      extracted = [];
    }

    if (extracted.length === 0) {
      return NextResponse.json({ ok: true, lessonsAdded: 0 });
    }

    const lessonsToAdd: Omit<Lesson, "id" | "createdAt" | "updatedAt">[] = extracted.map((l) => ({
      lesson: l.lesson,
      guru: guru ?? null,
      publication: publisher ?? null,
      promoType: promoType ?? null,
      category: l.category,
      evidenceCount: 1,
      supportingPromos: promoName ? [promoName] : [],
      predictedScore: null, // will be filled from effectiveness if parseable
      actualPerformance: performanceScore ?? null,
      performanceTier: l.performanceTier,
      isGoldStandard: l.isGoldStandard || (performanceScore !== null && performanceScore >= 9),
      publisherReasoning: reasoning?.trim() || "",
    }));

    addLessons(lessonsToAdd);

    return NextResponse.json({ ok: true, lessonsAdded: lessonsToAdd.length });
  } catch (err) {
    console.error("[learning/extract]", err);
    // Non-fatal — training was already saved, this is best-effort
    return NextResponse.json({ ok: true, skipped: true });
  }
}
