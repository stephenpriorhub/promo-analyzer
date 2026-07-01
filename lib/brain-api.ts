/**
 * Shared Brain API client ("the librarian" — write side).
 *
 * All structured app→brain writes go through the shared Brain API hosted in
 * brain-map at `POST {BRAIN_API_URL}/api/intelligence` (authenticated with
 * `x-hub-token: {HUB_API_TOKEN}`). This is the long-term path — NOT one-off
 * direct git/Contents-API commits. See REGISTRY.md "Brain API — the shared
 * librarian" and Areas/MTA/App-to-Brain Learning Loop.md §2.
 *
 * Requirement: teaching the brain must NEVER break the product. Every function
 * here is graceful — it logs and returns a result object; it never throws.
 */

import { getEnv } from "./env";
import type { PromoLedgerRow } from "./promo-ledger";

/** brain-map live URL (from REGISTRY.md). Overridable via BRAIN_API_URL. */
const DEFAULT_BRAIN_API_URL = "https://brain.oxfordhub.app";

function brainApiUrl(): string {
  return (getEnv("BRAIN_API_URL") ?? DEFAULT_BRAIN_API_URL).replace(/\/$/, "");
}

export interface BrainApiResult {
  ok: boolean;
  status?: number;
  written?: string[];
  error?: string;
}

/**
 * Append one Promo Pattern Ledger row via the Brain API (`kind:"promo-ledger-row"`).
 * The Brain API is the ONLY writer of the ledger file (append-only splice inside
 * the `<!-- promo-analyzer:start/end -->` markers). It returns 409 if the seed
 * file/markers are missing (Brain Master owns the seed).
 *
 * Never throws — on any failure (missing token, network, non-2xx, 409) it logs a
 * warning and returns { ok:false, ... } so the caller can continue serving the
 * analysis to the user.
 */
export async function postLedgerRow(row: PromoLedgerRow): Promise<BrainApiResult> {
  const token = getEnv("HUB_API_TOKEN");
  if (!token) {
    console.warn("[brain-api] HUB_API_TOKEN not set — skipping ledger row write");
    return { ok: false, error: "HUB_API_TOKEN not set" };
  }

  const url = `${brainApiUrl()}/api/intelligence`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-token": token,
      },
      body: JSON.stringify({ kind: "promo-ledger-row", row }),
    });

    let json: { ok?: boolean; written?: string[]; error?: string } = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON body — leave json empty */
    }

    if (!res.ok || json.ok === false) {
      const error = json.error ?? `Brain API returned ${res.status}`;
      console.warn(`[brain-api] ledger row write failed (${res.status}): ${error}`);
      return { ok: false, status: res.status, error };
    }

    console.log(`[brain-api] appended ledger row for "${row.promo}"`, json.written ?? []);
    return { ok: true, status: res.status, written: json.written };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[brain-api] ledger row write error: ${error}`);
    return { ok: false, error };
  }
}
