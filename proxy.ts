/**
 * API-wide authentication (publisher-approved 2026-07-03): every /api/* request
 * must come from a signed-in, authorized OxfordHub user (session cookie,
 * verified against the hub) or a maintenance script (x-hub-token). Unauthenticated
 * callers get 401 — uploader emails and promo data are not publicly readable.
 *
 * Role rules (admin-or-uploader, admin-only) stay in the individual routes;
 * this is just the outer "must be one of us" wall.
 */

import { NextRequest, NextResponse } from "next/server";

const HUB_ME_URL =
  (process.env.HUB_URL ?? "https://oxfordhub.app") + "/api/me?projectId=promo-analyzer";

export const config = {
  matcher: "/api/:path*",
};

export default async function proxy(req: NextRequest) {
  // Maintenance scripts authenticate with the service token.
  const token = req.headers.get("x-hub-token");
  if (token && process.env.HUB_API_TOKEN && token === process.env.HUB_API_TOKEN) {
    return NextResponse.next();
  }

  const cookie = req.headers.get("cookie");
  if (cookie) {
    try {
      const res = await fetch(HUB_ME_URL, {
        headers: { cookie },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const d = (await res.json()) as { authenticated?: boolean; authorized?: boolean };
        if (d.authenticated && d.authorized) return NextResponse.next();
      }
    } catch {
      // hub unreachable → fall through to 401 (fail closed)
    }
  }

  return NextResponse.json(
    { error: "Sign in to OxfordHub to use the Promo Analyzer." },
    { status: 401 }
  );
}
