"use client";

import { useEffect, useRef, useState } from "react";
import type { SupplementalFile } from "@/lib/reviews-store";

const NAVY = "#012479";
const NAVY_BG = "#f0f4fc";
const NAVY_BORDER = "#c8d5f0";

const CATEGORIES = [
  "Order Form",
  "Landing Page",
  "Upsell Page",
  "Exit Popup (VSL)",
  "Exit Popup (Order Form)",
  "Sign Up Page",
] as const;

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
  const [sourceAvailable, setSourceAvailable] = useState<boolean | null>(null);

  // Supplemental files
  const [supplementalFiles, setSupplementalFiles] = useState<SupplementalFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  // Upload state
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
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

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !reviewId) return;
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      const res = await fetch(`/api/files/${reviewId}/supplemental`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setSupplementalFiles((prev) => [...prev, json.file]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
              <button
                onClick={() => setPreviewOpen((p) => !p)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={{ borderColor: NAVY_BORDER, color: NAVY, background: "white" }}
              >
                {previewOpen ? "Hide Preview" : "Preview"}
              </button>
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
            ) : sourceAvailable === false ? (
              <span className="text-xs text-gray-400 italic">
                {reviewId ? "File not stored (pre-feature upload)" : "Analysis in progress…"}
              </span>
            ) : (
              <span className="text-xs text-gray-400">Checking…</span>
            )}
          </div>
        </div>

        {/* PDF inline preview */}
        {previewOpen && reviewId && isPdf && (
          <div className="rounded-lg overflow-hidden border" style={{ borderColor: NAVY_BORDER }}>
            <iframe
              src={`/api/files/${reviewId}/source`}
              className="w-full"
              style={{ height: "700px" }}
              title={`Preview: ${filename}`}
            />
          </div>
        )}
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

        {/* Upload row */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: NAVY_BORDER }}
            disabled={!reviewId || uploading}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <label
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer transition-opacity ${
              !reviewId || uploading ? "opacity-40 cursor-not-allowed" : "hover:opacity-80"
            }`}
            style={{ background: NAVY }}
          >
            {uploading ? "Uploading…" : "＋ Upload File"}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleUpload}
              disabled={!reviewId || uploading}
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp,.html,.htm"
            />
          </label>

          {!reviewId && (
            <span className="text-xs text-amber-600">Complete analysis first</span>
          )}
          {uploadError && (
            <span className="text-xs text-red-500">{uploadError}</span>
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
