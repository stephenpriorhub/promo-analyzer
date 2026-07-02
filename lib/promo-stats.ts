/**
 * Promo performance lookup — reads a Google Sheet of real-world promo stats and
 * exposes them by promo code.
 *
 * The sheet is the source of truth for ACTUAL performance (revenue, EPC,
 * conversion, etc.). It is NOT used to score copy — Copy Quality stays a pure
 * craft grade. These stats are displayed alongside the craft score and (later)
 * become clean (copy-features, real-outcome) training pairs for ML.
 *
 * Auth: a Google service account. We sign a JWT with the service-account
 * private key (node:crypto, no extra deps), exchange it for an access token,
 * and read the sheet via the Sheets REST API.
 *
 * Required env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — the full service-account JSON key (string)
 *   PERFORMANCE_SHEET_ID         — the spreadsheet ID (from its URL)
 * Optional:
 *   PERFORMANCE_SHEET_RANGE      — A1 range / sheet name (default "Sheet1")
 *   PROMO_STATS_TTL_MS           — cache TTL (default 300000 = 5 min)
 *
 * All failures are soft: if creds are missing or the fetch fails, lookups
 * return null and the analyzer simply shows no performance panel.
 */

import crypto from "crypto";

export interface PromoStats {
  promoCode: string;
  /** All non-key columns from the sheet, header -> cell value (strings as-authored). */
  stats: Record<string, string>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function ttlMs(): number {
  const v = Number(process.env.PROMO_STATS_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : 300_000;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    // Env vars often escape newlines in the PEM — restore them.
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    return sa;
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- access token (cached) --------------------------------------------------
let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri || TOKEN_URI,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claim}`;
  let signature: string;
  try {
    signature = base64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key));
  } catch (e) {
    console.warn("[promo-stats] JWT signing failed:", e);
    return null;
  }
  const assertion = `${signingInput}.${signature}`;

  try {
    const res = await fetch(sa.token_uri || TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) {
      console.warn("[promo-stats] token exchange failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    tokenCache = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
    return json.access_token;
  } catch (e) {
    console.warn("[promo-stats] token exchange error:", e);
    return null;
  }
}

// ---- sheet fetch + parse (cached map) ---------------------------------------
let mapCache: { at: number; map: Map<string, PromoStats> } | null = null;

/** Why the last sheet load produced no data — surfaced to the UI for setup debugging. */
let lastLoadError: string | null = null;
export function getSheetLoadError(): string | null {
  return lastLoadError;
}
/** Failed/empty loads only cache briefly so a fixed setup shows up fast. */
const EMPTY_TTL_MS = 30_000;

/** Normalize a promo code for matching: trim, uppercase, collapse inner whitespace. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function findCodeColumn(headers: string[]): number {
  // Priority order matters: "Creative Code" is the Agora export header.
  for (const wanted of ["creativecode", "promocode", "creative", "code", "promo"]) {
    const idx = headers.findIndex(
      (h) => h.trim().toLowerCase().replace(/[\s_]+/g, "") === wanted
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

async function loadMap(): Promise<Map<string, PromoStats>> {
  const now = Date.now();
  if (mapCache && now - mapCache.at < (mapCache.map.size > 0 ? ttlMs() : EMPTY_TTL_MS)) {
    return mapCache.map;
  }

  const empty = new Map<string, PromoStats>();
  const sa = loadServiceAccount();
  const sheetId = process.env.PERFORMANCE_SHEET_ID;
  if (!sa || !sheetId) {
    lastLoadError = "GOOGLE_SERVICE_ACCOUNT_JSON or PERFORMANCE_SHEET_ID not set/parseable";
    mapCache = { at: now, map: empty };
    return empty;
  }
  const token = await getAccessToken(sa);
  if (!token) {
    lastLoadError = "Google auth failed - the service-account JSON's private key could not mint a token (re-paste the full JSON file contents)";
    mapCache = { at: now, map: empty };
    return empty;
  }

  const range = encodeURIComponent(process.env.PERFORMANCE_SHEET_RANGE || "Sheet1");
  try {
    const res = await fetch(`${SHEETS_API}/${sheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.warn("[promo-stats] sheet fetch failed:", res.status, body);
      lastLoadError =
        res.status === 403
          ? body.includes("has not been used") || body.includes("is disabled")
            ? "The Google Sheets API is not enabled for the service account's project - open https://console.cloud.google.com/apis/library/sheets.googleapis.com (make sure the right project is selected in the top bar), click Enable, wait ~1 minute, then retry"
            : `Google says access denied (403) - share the sheet with ${sa.client_email} (Viewer). Google's reason: ${body}`
          : res.status === 404
            ? "Sheet not found (404) - check PERFORMANCE_SHEET_ID (the long id in the sheet URL)"
            : res.status === 400
              ? `Tab/range not found (400) - set PERFORMANCE_SHEET_RANGE to the exact tab name at the bottom of the sheet`
              : `Sheets API error ${res.status}: ${body}`;
      mapCache = { at: now, map: empty };
      return empty;
    }
    const json = (await res.json()) as { values?: string[][] };
    const rows = json.values ?? [];
    if (rows.length < 2) {
      lastLoadError = "The tab was readable but has fewer than 2 rows - is PERFORMANCE_SHEET_RANGE pointing at the right tab?";
      mapCache = { at: now, map: empty };
      return empty;
    }
    const headers = rows[0].map((h) => (h ?? "").toString());
    const codeIdx = findCodeColumn(headers);
    if (codeIdx === -1) {
      console.warn("[promo-stats] no promo_code/code column found in sheet headers:", headers);
      lastLoadError = `No creative-code column found. Expected a header like "Creative Code" - the tab's headers are: ${headers.join(", ")}`;
      mapCache = { at: now, map: empty };
      return empty;
    }

    const map = new Map<string, PromoStats>();
    for (const row of rows.slice(1)) {
      const rawCode = (row[codeIdx] ?? "").toString();
      if (!rawCode.trim()) continue;
      const stats: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (i === codeIdx) return;
        const val = (row[i] ?? "").toString().trim();
        if (h.trim() && val) stats[h.trim()] = val;
      });
      map.set(normalizeCode(rawCode), { promoCode: rawCode.trim(), stats });
    }
    lastLoadError = null;
    mapCache = { at: now, map };
    return map;
  } catch (e) {
    console.warn("[promo-stats] sheet fetch error:", e);
    lastLoadError = e instanceof Error ? e.message : "network error reaching the Sheets API";
    mapCache = { at: now, map: empty };
    return empty;
  }
}

/** Look up real performance stats for a promo code. Returns null if absent/unconfigured. */
export async function getPromoStats(code: string | null | undefined): Promise<PromoStats | null> {
  if (!code || !code.trim()) return null;
  const map = await loadMap();
  return map.get(normalizeCode(code)) ?? null;
}

/** All rows from the performance sheet (empty when unconfigured). Used by the bulk importer. */
export async function fetchAllSheetStats(): Promise<PromoStats[]> {
  const map = await loadMap();
  return [...map.values()];
}

/** True when the performance sheet integration is configured (creds + sheet id present). */
export function isPromoStatsConfigured(): boolean {
  return !!loadServiceAccount() && !!process.env.PERFORMANCE_SHEET_ID;
}
