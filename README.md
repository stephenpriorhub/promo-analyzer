# Promo Analyzer

MTA internal tool for analyzing financial newsletter promotional copy.

## What It Does

Upload a `.docx` or `.pdf` sales letter and get a full analysis in ~30–60 seconds:

| Section | Description |
|---|---|
| **Headline Analysis** | Identifies eyebrow, main headline, subheadline. Scores each of the 4 U's (Urgent, Unique, Ultra-specific, Useful). |
| **Promo Outline** | Maps the full promo structure into labeled sections. First section is always "The Lead." Sub-heads are used where present; Claude infers them otherwise. |
| **Evaldo Analysis** | Evaluates how the promo addresses each of the 10 Questions and the Close sequence from Evaldo Albuquerque's 16-Word Sales Letter framework. |
| **CUB Review** | The full promo text with inline color-coded highlights: yellow = Confusing, red = Unbelievable, gray = Boring. Hover any highlight for the reason. |
| **FK Score** | Flesch-Kincaid Reading Ease and Grade Level, calculated programmatically. Target financial copy typically reads at Grade 8–10. |
| **Offer Summary** | Bullet-point breakdown of the product, pricing, bonuses, payment options, guarantee, and urgency elements. |
| **Stock Tease** | If the promo contains a veiled stock pick, the tool identifies the clues and predicts the ticker(s) with a confidence rating. |
| **Effectiveness Score** | 1–10 rating with 2–3 sentence rationale. |

All analyses are auto-saved and accessible from the Past Reviews sidebar. Completed analyses can be exported as a formatted Word document.

## Target Audience Context (baked in)

Conservative males, 50s–70s. Financially literate but not professional traders. Skeptical of hype, responsive to authority and specific numbers, motivated by retirement security and supplemental income.

## Setup

```bash
npm install
# add ANTHROPIC_API_KEY to .env.local
npm run dev   # runs on http://localhost:3002
```

## File Support

- `.docx` — text extracted via mammoth
- `.pdf` — sent directly to Claude's vision (handles text PDFs, scanned PDFs, and rotated pages)

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- TailwindCSS 4
- Anthropic SDK (`claude-sonnet-4-6`)
- mammoth (docx parsing)
- docx (Word export)
- syllable (FK score calculation)
