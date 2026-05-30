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

## Instructions
Use this feedback as additional context — not as a directive to average numbers. Your job is to think critically about what the real-world data reveals:

- What might your original analysis have missed or incorrectly weighted?
- What does the actual market performance suggest about the copy's real strengths or weaknesses?
- What context does the publisher have that isn't visible in the copy alone — audience fit, timing, competitive landscape, list quality?
- Were you penalizing something that doesn't actually hurt conversion for this audience and format?

Arrive at a reconsidered score through your own analytical judgment, informed by this context. If the original score was right, say so and explain why. If it needs to change, explain specifically what the feedback revealed that changes the picture.

Do NOT mathematically blend the scores. Think like an analyst, not a calculator.

Output format (exactly — no preamble):
Score: X/10

Rationale: [2–3 sentences explaining the reconsidered score and what the feedback revealed]`;

export async function POST(req: NextRequest) {
  const { effectiveness, promoType, performanceScore, myScore, reasoning } = await req.json();

  if (performanceScore === null && myScore === null) {
    return NextResponse.json({ error: "At least one score is required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });

  const perfText = performanceScore !== null ? `${performanceScore}/10` : "not provided";
  const myText = myScore !== null ? `${myScore}/10` : "not provided";
  const notesText = reasoning?.trim() || "No additional notes.";

  const prompt = PROMPT
    .replace("{EFFECTIVENESS}", effectiveness?.trim() || "No prior effectiveness analysis.")
    .replace("{PROMO_TYPE}", promoType ?? "not specified")
    .replace("{PERF_SCORE}", perfText)
    .replace("{MY_SCORE}", myText)
    .replace("{REASONING}", notesText);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";
  return NextResponse.json({ effectiveness: text });
}
