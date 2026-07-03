/**
 * OxfordHub user identification + authorization (publisher directive 2026-07-03):
 * only Hub Super Admins / Admins may delete or edit promos, EXCEPT the user who
 * uploaded a promo may edit/delete their own.
 *
 * Mechanism: the hub session cookie is domain-scoped to .oxfordhub.app, so the
 * browser sends it with every request to analyzer.oxfordhub.app. We forward it
 * server-side to the hub's /api/me (the same pattern mta-wiki and iSpyEmails
 * use) to resolve {id, email, name, role}. HUB_API_TOKEN is NOT usable here —
 * it's a lookup credential, not a whoami.
 *
 * Fail-closed: if the hub is unreachable or the cookie is invalid, mutations
 * are denied. Reads stay open.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const HUB_ME_URL =
  (process.env.HUB_URL ?? "https://oxfordhub.app") + "/api/me?projectId=promo-analyzer";

export type HubRole = "super_admin" | "exec_admin" | "admin" | "user";

export interface HubUser {
  id: string;
  email: string;
  name: string | null;
  role: HubRole;
}

/**
 * Server-to-server maintenance bypass: scripted pipelines (bulk re-analysis,
 * backfills) send `x-hub-token: HUB_API_TOKEN` instead of a browser cookie.
 * Treated as an admin-equivalent service identity.
 */
function serviceUser(req: NextRequest): HubUser | null {
  const token = req.headers.get("x-hub-token");
  const expected = process.env.HUB_API_TOKEN;
  if (!token || !expected || token !== expected) return null;
  return { id: "service", email: "service@oxfordhub.app", name: "Maintenance Script", role: "admin" };
}

/** Resolve the requesting user by forwarding their hub session cookie. Null = not signed in / hub unreachable. */
export async function getHubUser(req: NextRequest): Promise<HubUser | null> {
  const svc = serviceUser(req);
  if (svc) return svc;
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(HUB_ME_URL, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      authenticated?: boolean;
      authorized?: boolean;
      user?: HubUser;
    };
    return data.authenticated && data.authorized && data.user ? data.user : null;
  } catch {
    return null;
  }
}

/** Hub admin tiers. exec_admin outranks admin in the hub, so it's included. */
export function isHubAdmin(user: HubUser | null): boolean {
  return !!user && (user.role === "super_admin" || user.role === "exec_admin" || user.role === "admin");
}

/**
 * Edit/delete rule: admins always; otherwise only the promo's uploader.
 * Legacy promos with no recorded uploader are admin-only.
 */
export function canModifyReview(
  user: HubUser | null,
  review: { uploadedBy?: { id: string } | null }
): boolean {
  if (isHubAdmin(user)) return true;
  return !!user && !!review.uploadedBy?.id && review.uploadedBy.id === user.id;
}

export function forbidden(message = "Only OxfordHub Admins or the promo's uploader can do this."): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}
