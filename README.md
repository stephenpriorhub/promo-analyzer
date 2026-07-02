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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | for sheet sync | Full service-account JSON key. Enables "Sync Google Sheet" on the Performance tab (share the sheet with the service-account email, viewer access). CSV import works without it. |
| `PERFORMANCE_SHEET_ID` | for sheet sync | Spreadsheet ID of the promo performance sheet (from its URL). |
| `PERFORMANCE_SHEET_RANGE` | no | A1 range / tab name for the performance sheet. Defaults to `Sheet1`. |

### App-to-Brain Learning Loop

On every successful analysis the analyzer teaches the brain two ways:

1. **Reads** `Copywriting Principles.md` (Brain-Master-curated, read-only for the app) into the scoring prompt, so scoring improves as principles are curated.
2. **Writes** one machine-comparable **Promo Pattern Ledger** row via the shared Brain API (`kind:"promo-ledger-row"`, `POST {BRAIN_API_URL}/api/intelligence`, header `x-hub-token`). The Brain API is the **only** writer of `Resources/Promo Analysis/Promo Pattern Ledger.md` (append-only splice). The analyzer never writes the ledger directly via the Contents API. Ledger failures are logged and never break the response.

## Performance Learning Layer

The **Performance** tab closes the loop between copy analysis and real-world results:

1. **Ingest** — import a CSV export of the Agora performance sheet (needs a "Creative Code" / "Promo Code" column; all other columns are kept verbatim), or sync the whole Google Sheet when configured.
2. **Enrich** — attach the Agora publication and guru to each creative code (dropdowns are fed by the brain's Financial Publishing Directory). Link each code to its analyzed promo. Re-imports refresh raw stats but never touch enrichment.
3. **Tier** — each record is percentile-ranked against records sharing the same metric (conversion %, EPC, rev-per-name rank ahead of absolute dollars; revenue only ranks within a publication). Cohort ladder: n≥20 → 5 tiers, 8–19 → 3 tiers, <8 → no tier claim. Every tier is shown with its cohort — a tier is a statistic, not a grade, and re-ranks as data arrives.
4. **Teach the Brain** — for every matched code+promo pair: the real result merges into the promo's training data (the publisher's own notes are never overwritten), Claude extracts generalizable copy lessons into the learning KB, and a row is appended to the vault's `Resources/Promo Analysis/Performance/Performance Ledger.md` (idempotent per creative code).
5. **Similar-Promo Outcomes (Experimental)** — a panel on each analysis showing what actually happened to the most comparable past promos (k-NN over the 8 sub-scores + guru/publication/promo-type matches). A predicted outcome band only appears once there are ≥30 real training pairs AND the model's leave-one-out accuracy beats the naive base rate; agreement is reported as a count ("4 of 5 comparables"), never a fabricated confidence percentage. Deliberately separate from the Copy Quality Score, which stays a pure craft grade (decision of record 2026-06-26).

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
