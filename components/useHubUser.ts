"use client";

/**
 * Client-side hub identity — mirrors lib/hub-auth.ts (which is the real gate,
 * server-side). Used only to hide edit/delete affordances the server would
 * reject anyway. The hub session cookie is domain-scoped to .oxfordhub.app and
 * /api/me is CORS-open to *.oxfordhub.app with credentials.
 */

import { useEffect, useState } from "react";

export interface HubUser {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "exec_admin" | "admin" | "user";
}

export function isHubAdmin(user: HubUser | null): boolean {
  return !!user && (user.role === "super_admin" || user.role === "exec_admin" || user.role === "admin");
}

/** Admins always; otherwise only the promo's uploader. Legacy (no uploader) = admin-only. */
export function canModifyReview(
  user: HubUser | null,
  review: { uploadedBy?: { id: string } | null }
): boolean {
  if (isHubAdmin(user)) return true;
  return !!user && !!review.uploadedBy?.id && review.uploadedBy.id === user.id;
}

export function useHubUser(): HubUser | null {
  const [user, setUser] = useState<HubUser | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("https://oxfordhub.app/api/me?projectId=promo-analyzer", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const d = (await res.json()) as { authenticated?: boolean; authorized?: boolean; user?: HubUser };
        if (d.authenticated && d.authorized && d.user) setUser(d.user);
      } catch {
        // hub unreachable — leave null; the server still enforces
      }
    })();
  }, []);
  return user;
}
