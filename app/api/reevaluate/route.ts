import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

const PROMPT = `You are a financial promo analyst reconsidering an effectiveness score in light of real-world performance feedback from the publisher.

## Your Original Analysis
{EFFECTIVENESS}

## Publisher Feedback
Promo type: {PROMO_TYPE}
Actual performance (how it did in market): {PERF_SCORE}
Publisher's own assessment: {MY_SCORE}
Publisher notes: {REASONING}
{BEST_PERFORMER_FLAG}

## Instructions

{ADVERSARIAL_INSTRUCTIONS}

Arrive at a reconsidered score through your own analytical judgment, informed by this context. If the original score was right, say so and explain why. If it needs to change, explain specifically what the feedback revealed that changes the picture.

Do NOT mathematically blend the scores. Think like an analyst, not a calculator.

Output format (exactly — no preamble):
Score: X/10

Rationale: [2–3 sentences explaining the reconsidered score and what the feedback revealed]`;

const STANDARD_INSTRUCTIONS = `Use this feedback as additional context. Your job is to think critically about what the real-world data reveals:

- What might your original analysis have missed or incorrectly weighted?
- What does the actual market performance suggest about the copy's real strengths or weaknesses?
- What context does the publisher have that isn't visible in the copy alone — audience fit, timing, competitive landscape, list quality?
- Were you penalizing something that doesn't actually hurt conversion for this audience and format?
- If the performance was significantly lower than predicted: was this a copy failure, or could external factors (list quality, timing, competition, offer mismatch) explain the gap? Distinguish these carefully — a copy that tests to a cold list will perform differently than the same copy to a proven buyer list.`;

const STRONG_SIGNAL_INSTRUCTIONS = `The publisher has marked this feedback as a STRONG SIGNAL. Their direct experience with this audience is authoritative — weight it heavily.

Before adjusting the score:
1. The publisher knows what worked for this audience better than any copywriting framework does. If their context says this performed well (or poorly), treat that as the ground truth and work backwards to understand why.
2. Find what the original analysis got wrong: a credibility element, emotional hook, offer structure, proof stack, or mechanism whose real-world impact you under- or over-weighted.
3. Do NOT nitpick. When the publisher's context strongly supports a direction, do not dock the score for minor copy imperfections — an awkward transition, a missing testimonial, a slightly soft headline, a topic the textbook dislikes. Those are noise when the publisher is telling you how it actually performed.
4. If your original score diverged significantly from what the publisher's context implies, that is a calibration error on YOUR part. Move meaningfully toward their signal and explain specifically what you initially mis-weighted.

The new score does not have to land on an exact number, but it must clearly reflect the publisher's strong context. Explain what the copy did (or failed to do) that the real-world result reveals.`;

export async function POST(req: NextRequest) {
  const { effectiveness, promoType, performanceScore, myScore, reasoning, isBestPerformer } =
    await req.json();

  if (performanceScore === null && myScore === null) {
    return NextResponse.json({ error: "At least one score is required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });

  const isStrongSignal =
    isBestPerformer === true ||
    (performanceScore !== null && performanceScore >= 9);

  const perfText = performanceScore !== null ? `${performanceScore}/10` : "not provided";
  const myText = myScore !== null ? `${myScore}/10` : "not provided";
  const notesText = reasoning?.trim() || "No additional notes.";
  const strongSignalFlag = isStrongSignal
    ? "The publisher has marked this feedback as a STRONG SIGNAL — weight their context heavily and do not nitpick the score downward."
    : "";

  const prompt = PROMPT
    .replace("{EFFECTIVENESS}", effectiveness?.trim() || "No prior effectiveness analysis.")
    .replace("{PROMO_TYPE}", promoType ?? "not specified")
    .replace("{PERF_SCORE}", perfText)
    .replace("{MY_SCORE}", myText)
    .replace("{REASONING}", notesText)
    .replace("{BEST_PERFORMER_FLAG}", strongSignalFlag)
    .replace("{ADVERSARIAL_INSTRUCTIONS}", isStrongSignal ? STRONG_SIGNAL_INSTRUCTIONS : STANDARD_INSTRUCTIONS);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";
  return NextResponse.json({ effectiveness: text });
}
