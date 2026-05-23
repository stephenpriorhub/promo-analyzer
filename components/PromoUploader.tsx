"use client";

import { useCallback, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function PromoUploader({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "docx" && ext !== "pdf") {
        alert("Please upload a .docx or .pdf file.");
        return;
      }
      onFile(file);
    },
    [onFile]
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
  );
}
