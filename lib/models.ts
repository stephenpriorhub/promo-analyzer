/**
 * Central model configuration — every Claude call in the app imports from here
 * so upgrades happen in one place and each review can be stamped with the
 * model that scored it (mixing scoring models silently corrupts calibration).
 *
 * Upgraded 2026-07-02 (publisher-approved): claude-sonnet-4-6 → claude-sonnet-5
 * for analysis, claude-haiku-4-5 → claude-sonnet-5 for lesson extraction.
 * Sonnet 5 notes: non-default sampling params are rejected (temperature
 * removed), adaptive thinking runs by default when `thinking` is omitted, and
 * the new tokenizer produces ~30% more tokens — max_tokens budgets were raised
 * to compensate.
 */

/** Scores promos: analyze, re-analyze, re-evaluate, CUB, tag suggestions. */
export const ANALYSIS_MODEL = "claude-sonnet-5";

/** Extracts generalizable lessons from training events into the learning KB. */
export const EXTRACTION_MODEL = "claude-sonnet-5";
