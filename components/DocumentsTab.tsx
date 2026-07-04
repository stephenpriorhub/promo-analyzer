"use client";

import { useEffect, useRef, useState } from "react";
import type { SupplementalFile } from "@/lib/reviews-store";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

const CATEGORIES = [
  // Funnel pages
  "Order Form",
  "Landing Page",
  "Upsell Page",
  "Sign Up Page",
  "Lifetime / Unlimited Upsell",
  // Exit popups
  "Exit Popup (VSL)",
  "Exit Popup (Order Form)",
  // VSL / ads
  "VSL Lift Notes",
  "Space Ads",
  "Short Text Ads",
  "Facebook Video Ad Copy",
  "YouTube Video Ad Copy",
  "Facebook Text Ad Copy",
  // Emails
  "Cart Abandon Emails",
  // Editorial
  "Editorial Guide",
  // Hotlist
  "Hotlist Lift Notes",
  "Hotlist Space Ads",
  "Hotlist Warm-Up Emails",
  "Hotlist Text Ads",
  "Hotlist Reminder Emails",
] as const;

/** Best-guess a category from a filename; falls back to the first category. */
function guessCategory(filename: string): string {
  const n = filename.toLowerCase();
  const has = (...terms: string[]) => terms.every((t) => n.includes(t));
  const any = (...terms: string[]) => terms.some((t) => n.includes(t));

  // Hotlist variants first (more specific)
  if (n.includes("hotlist")) {
    if (any("lift")) return "Hotlist Lift Notes";
    if (any("space")) return "Hotlist Space Ads";
    if (any("warm")) return "Hotlist Warm-Up Emails";
    if (any("reminder")) return "Hotlist Reminder Emails";
    if (any("text")) return "Hotlist Text Ads";
  }
  if (has("facebook", "video")) return "Facebook Video Ad Copy";
  if (has("youtube", "video") || (n.includes("yt") && n.includes("video"))) return "YouTube Video Ad Copy";
  if (has("facebook", "text") || (n.includes("fb") && n.includes("text"))) return "Facebook Text Ad Copy";
  if (any("cart abandon", "cart-abandon", "cartabandon", "abandon")) return "Cart Abandon Emails";
  if (any("lift note", "lift-note", "liftnotes", "lift notes")) return "VSL Lift Notes";
  if (any("space ad", "space-ad", "spacead")) return "Space Ads";
  if (any("short text", "short-text")) return "Short Text Ads";
  if (any("lifetime", "unlimited")) return "Lifetime / Unlimited Upsell";
  if (any("editorial")) return "Editorial Guide";
  if (any("order form", "order-form", "orderform")) return "Order Form";
  if (any("landing")) return "Landing Page";
  if (any("sign up", "sign-up", "signup")) return "Sign Up Page";
  if (any("upsell")) return "Upsell Page";
  if (any("exit") && any("order")) return "Exit Popup (Order Form)";
  if (any("exit")) return "Exit Popup (VSL)";
  return CATEGORIES[0];
}

interface Props {
  reviewId: string | null;
  filename: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "📄";
  if (ext === "docx" || ext === "doc") return "📝";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "🖼️";
  return "📎";
}

export default function DocumentsTab({ reviewId, filename }: Props) {
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [sourceAvailable, setSourceAvailable] = useState<boolean | null>(null);

  // Supplemental files
  const [supplementalFiles, setSupplementalFiles] = useState<SupplementalFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  // Upload state — stage one or more files, each with its own category, then
  // "Upload all" POSTs each file individually to the existing supplemental route.
  interface StagedFile {
    key: string;
    file: File;
    category: string;
  }
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check source file + load supplemental files
  useEffect(() => {
    if (!reviewId) {
      setSourceAvailable(false);
      setLoadingFiles(false);
      return;
    }

    // Check source file availability (HEAD-like via small fetch)
    fetch(`/api/files/${reviewId}/source`, { method: "GET", cache: "no-store" })
      .then((r) => setSourceAvailable(r.ok))
      .catch(() => setSourceAvailable(false));

    // Load supplemental files
    fetch(`/api/files/${reviewId}/supplemental`)
      .then((r) => r.json())
      .then((data) => setSupplementalFiles(data.files ?? []))
      .catch(() => {})
      .finally(() => setLoadingFiles(false));
  }, [reviewId]);

  function handleSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadError("");
    setStaged((prev) => [
      ...prev,
      ...files.map((file) => ({
        key: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        category: guessCategory(file.name),
      })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function setStagedCategory(key: string, cat: string) {
    setStaged((prev) => prev.map((s) => (s.key === key ? { ...s, category: cat } : s)));
  }

  function removeStaged(key: string) {
    setStaged((prev) => prev.filter((s) => s.key !== key));
  }

  async function handleUploadAll() {
    if (!reviewId || staged.length === 0) return;
    setUploading(true);
    setUploadError("");
    const remaining: StagedFile[] = [];
    const errors: string[] = [];
    for (const item of staged) {
      try {
        const fd = new FormData();
        fd.append("file", item.file);
        fd.append("category", item.category);
        const res = await fetch(`/api/files/${reviewId}/supplemental`, {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed");
        setSupplementalFiles((prev) => [...prev, json.file]);
      } catch (err) {
        remaining.push(item);
        errors.push(`${item.file.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    setStaged(remaining);
    if (errors.length) setUploadError(errors.join("; "));
    setUploading(false);
  }

  async function handleDelete(fileId: string) {
    if (!reviewId) return;
    setSupplementalFiles((prev) => prev.filter((f) => f.id !== fileId));
    await fetch(`/api/files/${reviewId}/supplemental/${fileId}`, { method: "DELETE" });
  }

  // Group supplemental files by category
  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    files: supplementalFiles.filter((f) => f.category === cat),
  })).filter((g) => g.files.length > 0);

  const uncategorized = supplementalFiles.filter(
    (f) => !(CATEGORIES as readonly string[]).includes(f.category)
  );

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── Source Promo ─────────────────────────────── */}
      <div
        className="rounded-xl border p-5 space-y-4"
        style={{ background: NAVY_BG, borderColor: NAVY_BORDER }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: NAVY }}>
              Source Promo
            </p>
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              {fileIcon(filename)} {filename}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isPdf && sourceAvailable && (
              <>
                <a
                  href={`/api/files/${reviewId}/source`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                  style={{ borderColor: NAVY_BORDER, color: NAVY, background: "white" }}
                >
                  👁 Preview
                </a>
              </>
            )}
            {sourceAvailable && reviewId ? (
              <a
                href={`/api/files/${reviewId}/source`}
                download={filename}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: NAVY }}
              >
                ⬇ Download
              </a>
            ) : sourceAvailable === false && reviewId ? (
              <label
                className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors"
                style={{ borderColor: NAVY_BORDER, color: NAVY, background: NAVY_BG }}
              >
                ＋ Upload Source File
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !reviewId) return;
                    const fd = new FormData();
                    fd.append("file", file);
                    const res = await fetch(`/api/files/${reviewId}/source`, { method: "POST", body: fd });
                    if (res.ok) setSourceAvailable(true);
                  }}
                />
              </label>
            ) : sourceAvailable === null ? (
              <span className="text-xs text-gray-400">Checking…</span>
            ) : (
              <span className="text-xs text-gray-400 italic">Analysis in progress…</span>
            )}
          </div>
        </div>

      </div>

      {/* ── Supplemental Files ───────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold" style={{ color: NAVY }}>
              Supplemental Files
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Order forms, landing pages, upsells, and other funnel assets
            </p>
          </div>
        </div>

        {/* Upload row — select one or more files, set a category per file, then upload all */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label
              className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer border transition-colors ${
                !reviewId || uploading ? "opacity-40 cursor-not-allowed" : "hover:opacity-80"
              }`}
              style={{ borderColor: NAVY_BORDER, color: NAVY, background: NAVY_BG }}
            >
              ＋ Add Files
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleSelectFiles}
                disabled={!reviewId || uploading}
                accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp,.html,.htm"
              />
            </label>

            {staged.length > 0 && (
              <button
                onClick={handleUploadAll}
                disabled={!reviewId || uploading}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity ${
                  !reviewId || uploading ? "opacity-40 cursor-not-allowed" : "hover:opacity-80"
                }`}
                style={{ background: NAVY }}
              >
                {uploading ? "Uploading…" : `Upload all (${staged.length})`}
              </button>
            )}

            {!reviewId && (
              <span className="text-xs text-amber-600">Complete analysis first</span>
            )}
            {uploadError && (
              <span className="text-xs text-red-500">{uploadError}</span>
            )}
          </div>

          {/* Staged files — one row per file with its own category dropdown */}
          {staged.length > 0 && (
            <div className="space-y-2">
              {staged.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-white"
                  style={{ borderColor: NAVY_BORDER }}
                >
                  <span className="text-base shrink-0">{fileIcon(item.file.name)}</span>
                  <p className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">
                    {item.file.name}
                    <span className="text-xs text-gray-400 ml-2">{formatBytes(item.file.size)}</span>
                  </p>
                  <select
                    value={item.category}
                    onChange={(e) => setStagedCategory(item.key, e.target.value)}
                    className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none shrink-0"
                    style={{ borderColor: NAVY_BORDER }}
                    disabled={uploading}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeStaged(item.key)}
                    disabled={uploading}
                    className="text-gray-400 hover:text-red-500 text-xs transition-colors shrink-0"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* File list grouped by category */}
        {loadingFiles ? (
          <p className="text-xs text-gray-400">Loading files…</p>
        ) : supplementalFiles.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No supplemental files uploaded yet.</p>
        ) : (
          <div className="space-y-4">
            {[...grouped, ...(uncategorized.length > 0 ? [{ category: "Other", files: uncategorized }] : [])].map(
              ({ category: cat, files }) => (
                <div key={cat}>
                  <p
                    className="text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: NAVY }}
                  >
                    {cat}
                  </p>
                  <div className="space-y-1.5">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border bg-white"
                        style={{ borderColor: NAVY_BORDER }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{fileIcon(f.filename)}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {f.filename}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatBytes(f.size)} ·{" "}
                              {new Date(f.uploadedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={`/api/files/${reviewId}/supplemental/${f.id}`}
                            download={f.filename}
                            className="text-xs font-medium hover:underline"
                            style={{ color: NAVY }}
                          >
                            ⬇
                          </a>
                          <button
                            onClick={() => handleDelete(f.id)}
                            className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                            title="Delete"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
