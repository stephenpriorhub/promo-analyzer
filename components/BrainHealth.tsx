"use client";

/**
 * Brain-writes health badge — green when app→vault writes are landing, red the
 * moment one fails or the GitHub token dies. Exists because production writes
 * failed silently for days (2026-07-04) and the brain quietly stopped learning.
 */

import { useEffect, useState } from "react";

interface Health {
  healthy: boolean;
  tokenOk: boolean | null;
  lastSuccess: { at: string; ctx: string } | null;
  lastFailure: { at: string; ctx: string; error: string } | null;
  failureCount: number;
}

export default function BrainHealth() {
  const [h, setH] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/brain/health", { cache: "no-store" });
        if (res.ok && alive) setH(await res.json());
      } catch {
        /* leave last state */
      }
    };
    void poll();
    const id = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!h) return null;

  const title = h.healthy
    ? `Brain writes healthy${h.lastSuccess ? ` — last: ${h.lastSuccess.ctx} @ ${h.lastSuccess.at.slice(0, 16).replace("T", " ")}` : ""}`
    : h.tokenOk === false
      ? "BRAIN WRITES FAILING — the GitHub token is invalid. New analyses/teaches are NOT reaching the vault."
      : `BRAIN WRITE FAILED — ${h.lastFailure?.ctx}: ${h.lastFailure?.error ?? "unknown"} (${h.lastFailure?.at.slice(0, 16).replace("T", " ")})`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border ${
        h.healthy ? "border-green-200 bg-green-50 text-green-700" : "border-red-300 bg-red-50 text-red-700 animate-pulse"
      }`}
      title={title}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${h.healthy ? "bg-green-500" : "bg-red-500"}`} />
      Brain {h.healthy ? "✓" : "write failing"}
    </span>
  );
}
