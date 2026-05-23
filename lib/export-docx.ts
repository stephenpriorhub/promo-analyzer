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

function cubHighlightColor(type: string): typeof HighlightColor[keyof typeof HighlightColor] | undefined {
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
    const jsonStart = cubText.indexOf("[");
    const jsonEnd = cubText.lastIndexOf("]") + 1;
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      segments = JSON.parse(cubText.slice(jsonStart, jsonEnd));
    }
  } catch {
    return [new Paragraph({ children: [new TextRun({ text: cubText })] })];
  }

  const runs = segments.map((seg) => {
    const highlight = cubHighlightColor(seg.type);
    const run = new TextRun({
      text: seg.text + " ",
      highlight,
      size: 22,
    });
    return run;
  });

  const paragraphs: Paragraph[] = [];
  let chunk: TextRun[] = [];
  for (const run of runs) {
    chunk.push(run);
    if (chunk.length >= 5) {
      paragraphs.push(new Paragraph({ children: [...chunk], spacing: { after: 80 } }));
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    paragraphs.push(new Paragraph({ children: chunk, spacing: { after: 80 } }));
  }

  const legend: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ text: "Legend: ", bold: true, size: 20 }),
        new TextRun({ text: "■ Confusing  ", highlight: HighlightColor.YELLOW, size: 20 }),
        new TextRun({ text: "■ Unbelievable  ", highlight: HighlightColor.RED, size: 20 }),
        new TextRun({ text: "■ Boring  ", highlight: HighlightColor.LIGHT_GRAY, size: 20 }),
      ],
      spacing: { after: 200 },
    }),
  ];

  return [...legend, ...paragraphs];
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
        new TextRun({ text: `File: ${filename}`, italics: true, size: 20, color: "666666" }),
        new TextRun({ text: "   |   ", size: 20, color: "666666" }),
        new TextRun({
          text: `Analyzed: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
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

    const effMatch = sections.effectiveness.match(/(\d+)\s*\/\s*10/);
    if (effMatch) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Effectiveness Score: `, bold: true, size: 22 }),
            new TextRun({ text: `${effMatch[1]}/10`, size: 22, bold: true, color: "2563EB" }),
          ],
          spacing: { after: 100 },
        })
      );
    }
  }

  const sectionsToRender: Array<{ title: string; key: keyof AnalysisSections; isCUB?: boolean }> = [
    { title: "Headline Analysis (4 U's)", key: "headline" },
    { title: "Promo Outline", key: "outline" },
    { title: "Evaldo Framework Analysis", key: "evaldo" },
    { title: "CUB Review", key: "cub", isCUB: true },
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
