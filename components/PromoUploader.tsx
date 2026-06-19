"use client";

import { useCallback, useState } from "react";

interface Props {
  onFile: (file: File, promoRunStartDate: string | null) => void;
  disabled?: boolean;
}

export default function PromoUploader({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [runDate, setRunDate] = useState("");

  const handleFile = useCallback(
    (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "docx" && ext !== "pdf") {
        alert("Please upload a .docx or .pdf file.");
        return;
      }
      onFile(file, runDate || null);
    },
    [onFile, runDate]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="promo-run-date" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#012479" }}>
          Approx. date promo started running <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          id="promo-run-date"
          type="date"
          value={runDate}
          disabled={disabled}
          onChange={(e) => setRunDate(e.target.value)}
          className="w-56 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          style={{ borderColor: "#c8d5f0" }}
        />
        <p className="text-xs text-gray-400">Helps weigh industry-traction signals (older promos aren&apos;t penalized for stale data).</p>
      </div>
    <label
      htmlFor="promo-file-input"
      className={`flex flex-col items-center justify-center gap-3 w-full border-2 border-dashed rounded-xl py-12 px-6 text-center cursor-pointer transition-all
        ${dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={disabled ? undefined : onDrop}
    >
      <div className="text-4xl">📄</div>
      <div>
        <p className="font-semibold text-gray-700">Drop your promo here</p>
        <p className="text-sm text-gray-500 mt-1">or click to browse</p>
        <p className="text-xs text-gray-400 mt-2">.docx or .pdf • scanned PDFs supported</p>
      </div>
      <input
        id="promo-file-input"
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        disabled={disabled}
        onChange={onInputChange}
      />
    </label>
    </div>
  );
}
