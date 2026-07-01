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

## Environment Variables

Set locally in `.env.local` (see `.env.example`); set in Railway for deploy.

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude API for analysis. |
| `GITHUB_TOKEN` | recommended | GitHub PAT (repo read+write). Writes per-promo Intel notes via the Contents API **and** reads `Resources/Promo Analysis/Copywriting Principles.md` + guru profiles from the vault on every run (falls back to local `BRAIN_DIR` read when unset). |
| `BRAIN_GITHUB_REPO` | no | Vault repo, `owner/repo`. Defaults to `stephenpriorhub/brain`. |
| `BRAIN_API_URL` | no | Shared Brain API base URL. Defaults to `https://brain.oxfordhub.app` (brain-map). |
| `HUB_API_TOKEN` | for ledger | Shared auth token between apps and brain-map. Required to append Promo Pattern Ledger rows; if unset the ledger write is skipped (analysis still returns). |
| `DATA_DIR` | no | Override for `reviews.json` + uploaded files (e.g. a Railway volume). |

### App-to-Brain Learning Loop

On every successful analysis the analyzer teaches the brain two ways:

1. **Reads** `Copywriting Principles.md` (Brain-Master-curated, read-only for the app) into the scoring prompt, so scoring improves as principles are curated.
2. **Writes** one machine-comparable **Promo Pattern Ledger** row via the shared Brain API (`kind:"promo-ledger-row"`, `POST {BRAIN_API_URL}/api/intelligence`, header `x-hub-token`). The Brain API is the **only** writer of `Resources/Promo Analysis/Promo Pattern Ledger.md` (append-only splice). The analyzer never writes the ledger directly via the Contents API. Ledger failures are logged and never break the response.

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
