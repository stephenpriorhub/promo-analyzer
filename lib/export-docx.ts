import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  HighlightColor,
  BorderStyle,
} from "docx";
import type { AnalysisSections } from "./reviews-store";
import type { FKScore } from "./fk-score";

interface CUBSegment {
  text: string;
  type: "clean" | "confusing" | "unbelievable" | "boring";
  reason?: string;
}

function cubHighlightColor(
  type: string
): (typeof HighlightColor)[keyof typeof HighlightColor] | undefined {
  if (type === "confusing") return HighlightColor.YELLOW;
  if (type === "unbelievable") return HighlightColor.RED;
  if (type === "boring") return HighlightColor.LIGHT_GRAY;
  return undefined;
}

function markdownToParagraphs(text: string): Paragraph[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const stripped = line.replace(/^#+\s*/, "").replace(/\*\*/g, "");
      return new Paragraph({
        children: [new TextRun({ text: stripped, size: 22 })],
        spacing: { after: 100 },
      });
    });
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "2563EB" },
    },
  });
}


function buildCUBParagraphs(cubText: string): Paragraph[] {
  let segments: CUBSegment[] = [];
  try {
    const cleaned = cubText.replace(/```(?:json)?/g, "").trim();
    const jsonStart = cleaned.indexOf("[");
    const jsonEnd = cleaned.lastIndexOf("]") + 1;
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd));
      if (Array.isArray(parsed)) segments = parsed;
    }
  } catch {
    return [new Paragraph({ children: [new TextRun({ text: cubText, size: 22 })] })];
  }

  // Only flagged items (no "clean" segments in this format)
  const flagged = segments.filter((s) => s.type !== "clean");

  if (flagged.length === 0) {
    return [
      new Paragraph({
        children: [new TextRun({ text: "✓ No flagged items — copy looks clean.", size: 22, italics: true })],
      }),
    ];
  }

  const paragraphs: Paragraph[] = [];

  const groups: Array<{ type: CUBSegment["type"]; label: string; color: string }> = [
    { type: "confusing",    label: "CONFUSING",    color: "92400E" },
    { type: "unbelievable", label: "UNBELIEVABLE",  color: "7F1D1D" },
    { type: "boring",       label: "BORING",        color: "374151" },
  ];

  for (const { type, label, color } of groups) {
    const items = flagged.filter((s) => s.type === type);
    if (items.length === 0) continue;

    const highlight = cubHighlightColor(type);

    // Group heading
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${label}  (${items.length})`,
            bold: true,
            size: 24,
            color,
            highlight,
          }),
        ],
        spacing: { before: 240, after: 100 },
      })
    );

    // Each flagged item
    for (const item of items) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `"${item.text}"`, size: 22, italics: true }),
          ],
          spacing: { after: 40 },
          indent: { left: 360 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `↳ ${item.reason ?? ""}`, size: 20, color: "555555" }),
          ],
          spacing: { after: 140 },
          indent: { left: 360 },
        })
      );
    }
  }

  return paragraphs;
}

export async function buildExportDocx(
  filename: string,
  sections: AnalysisSections,
  fkScore: FKScore | null
): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      text: "Promo Analysis Report",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `File: ${filename}`,
          italics: true,
          size: 20,
          color: "666666",
        }),
        new TextRun({ text: "   |   ", size: 20, color: "666666" }),
        new TextRun({
          text: `Analyzed: ${new Date().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}`,
          italics: true,
          size: 20,
          color: "666666",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
  ];

  if (fkScore) {
    children.push(
      sectionHeading("Readability & Effectiveness"),
      new Paragraph({
        children: [
          new TextRun({ text: `FK Reading Ease: `, bold: true, size: 22 }),
          new TextRun({ text: `${fkScore.readingEase} (${fkScore.label})   `, size: 22 }),
          new TextRun({ text: `FK Grade Level: `, bold: true, size: 22 }),
          new TextRun({ text: `${fkScore.gradeLevel}`, size: 22 }),
        ],
        spacing: { after: 150 },
      })
    );

    // Fixed: handle decimal scores like 7.5/10
    const effMatch = sections.effectiveness.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    if (effMatch) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Effectiveness Score: `, bold: true, size: 22 }),
            new TextRun({
              text: `${effMatch[1]}/10`,
              size: 22,
              bold: true,
              color: "2563EB",
            }),
          ],
          spacing: { after: 100 },
        })
      );
    }
  }

  const sectionsToRender: Array<{
    title: string;
    key: keyof AnalysisSections;
    isCUB?: boolean;
  }> = [
    { title: "Headline Analysis (4 U's)", key: "headline" },
    { title: "Promo Outline", key: "outline" },
    { title: "16-Word Sales Letter", key: "evaldo" },
    { title: "CUB Review — Full Copy with Annotations", key: "cub", isCUB: true },
    { title: "Offer Summary", key: "offer" },
    { title: "Stock Tease", key: "stockTease" },
    { title: "Effectiveness Score", key: "effectiveness" },
  ];

  for (const { title, key, isCUB } of sectionsToRender) {
    const content = sections[key];
    if (!content || content === "NONE") continue;
    children.push(sectionHeading(title));
    if (isCUB) {
      children.push(...buildCUBParagraphs(content));
    } else {
      children.push(...markdownToParagraphs(content));
    }
  }

  const doc = new Document({
    sections: [{ children }],
    styles: {
      paragraphStyles: [
        {
          id: "Heading2",
          name: "Heading 2",
          run: { color: "1E3A5F", bold: true, size: 26 },
        },
      ],
    },
  });

  return Packer.toBuffer(doc);
}
