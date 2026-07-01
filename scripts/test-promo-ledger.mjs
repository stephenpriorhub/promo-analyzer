/**
 * Unit tests for the Promo Pattern Ledger field mapping (lib/promo-ledger.ts).
 * Pure — no fs / network. Verifies analysis-output → Brain API `row` shaping.
 *
 * Run (Node 22+, type-stripping):
 *   node --experimental-strip-types scripts/test-promo-ledger.mjs
 *
 * lib/promo-ledger.ts imports only `type`s from sibling modules (erasable), so
 * it strips cleanly without pulling in any runtime deps.
 */

import assert from "node:assert/strict";
import {
  buildLedgerRowFromReview,
  parseOfferField,
  parsePredictedTickers,
  deriveLeadType,
  deriveMechanism,
} from "../lib/promo-ledger.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("promo-ledger mapping:");

const OFFER = [
  "- **Big Idea**: The one stock the Fed can't stop.",
  "- **Publisher**: Monument Traders Alliance",
  "- **Product name**: The War Room",
  "- **What it is**: trading service",
  "- **Price(s)**: $1,995/yr",
  "- **Guarantee**: 60-day money-back guarantee",
  "- **Any urgency/scarcity elements**: Closes at midnight Friday",
].join("\n");

const STOCK_TEASE = [
  "The clues point to a small-cap uranium miner.",
  "Best prediction(s): UEC (High confidence), or possibly CCJ.",
].join("\n");

const INTEL = {
  guru: { name: "Bryan Bottarelli" },
  product: {
    name: "The War Room",
    type: "trading service",
    mechanism: "Real-time options trade alerts during market hours",
  },
  strategies: ["day-trading options"],
};

const REVIEW = {
  date: "2026-07-01T14:30:00.000Z",
  displayName: "Fed Panic Promo",
  filename: "fed-panic.pdf",
  product: "The War Room",
  gurus: ["Bryan Bottarelli", "Karim Rahemtulla"],
  effectivenessScore: 8.1,
  subScores: [
    { dimension: "Hook Strength", score: 9, rationale: "" },
    { dimension: "Believability", score: 7, rationale: "" },
    { dimension: "Offer Clarity", score: 6, rationale: "" },
    { dimension: "Audience Fit", score: 8, rationale: "" },
  ],
  fkReadingEase: 62.4,
  fkGradeLevel: 7.8,
  sections: { offer: OFFER, stockTease: STOCK_TEASE },
};

test("parseOfferField pulls the value after a bold bullet label", () => {
  assert.equal(parseOfferField(OFFER, "Guarantee"), "60-day money-back guarantee");
  assert.equal(parseOfferField(OFFER, "Product name"), "The War Room");
});

test("parseOfferField returns '' for missing / placeholder values", () => {
  assert.equal(parseOfferField(OFFER, "Nonexistent"), "");
  assert.equal(parseOfferField("- **Guarantee**: —", "Guarantee"), "");
  assert.equal(parseOfferField("- **Guarantee**: None", "Guarantee"), "");
  assert.equal(parseOfferField(undefined, "Guarantee"), "");
});

test("parsePredictedTickers extracts symbols, drops stop-words, dedupes", () => {
  assert.deepEqual(parsePredictedTickers(STOCK_TEASE), ["UEC", "CCJ"]);
  assert.deepEqual(parsePredictedTickers("NONE"), []);
  assert.deepEqual(parsePredictedTickers(undefined), []);
});

test("deriveLeadType prefers product.type, falls back to first strategy", () => {
  assert.equal(deriveLeadType(INTEL), "trading service");
  assert.equal(deriveLeadType({ strategies: ["post-earnings drift"] }), "post-earnings drift");
  assert.equal(deriveLeadType(null), "");
});

test("deriveMechanism reads product.mechanism", () => {
  assert.equal(deriveMechanism(INTEL), "Real-time options trade alerts during market hours");
  assert.equal(deriveMechanism(null), "");
});

test("buildLedgerRowFromReview maps every field to the Brain API row shape", () => {
  const row = buildLedgerRowFromReview(REVIEW, INTEL);
  assert.equal(row.date, "2026-07-01", "date sliced to YYYY-MM-DD");
  assert.equal(row.promo, "Fed Panic Promo", "promo uses displayName");
  assert.equal(row.product, "The War Room");
  assert.equal(row.guru, "Bryan Bottarelli, Karim Rahemtulla", "gurus joined");
  assert.equal(row.effectiveness, 8.1);
  assert.equal(row.hook, 9);
  assert.equal(row.believability, 7);
  assert.equal(row.offerClarity, 6);
  assert.equal(row.leadType, "trading service");
  assert.equal(row.mechanism, "Real-time options trade alerts during market hours");
  assert.equal(row.guarantee, "60-day money-back guarantee");
  assert.equal(row.urgencyType, "Closes at midnight Friday");
  assert.equal(row.fkEase, 62.4);
  assert.equal(row.fkGrade, 7.8);
  assert.deepEqual(row.predictedTickers, ["UEC", "CCJ"]);
});

test("buildLedgerRowFromReview degrades gracefully with no intel / no scores", () => {
  const row = buildLedgerRowFromReview(
    {
      date: "2026-07-02T00:00:00.000Z",
      filename: "bare.docx",
      effectivenessScore: null,
      fkReadingEase: null,
      fkGradeLevel: null,
      sections: {},
    },
    null
  );
  assert.equal(row.promo, "bare", "falls back to filename sans ext");
  assert.equal(row.product, "");
  assert.equal(row.guru, "");
  assert.equal(row.effectiveness, "");
  assert.equal(row.hook, "");
  assert.equal(row.leadType, "");
  assert.equal(row.fkEase, "");
  assert.deepEqual(row.predictedTickers, []);
});

test("product falls back to intel.product.name when review.product is empty", () => {
  const row = buildLedgerRowFromReview(
    { ...REVIEW, product: null },
    INTEL
  );
  assert.equal(row.product, "The War Room");
});

console.log(`\n${passed} tests passed.`);
