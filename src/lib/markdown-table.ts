export type MarkdownTableAlignment = "left" | "center" | "right";

export interface ParsedMarkdownTable {
  headers: string[];
  alignments: MarkdownTableAlignment[];
  rows: string[][];
  nextIndex: number;
}

function splitMarkdownTableRow(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("|")) return [];
  const source = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function separatorAlignment(value: string): MarkdownTableAlignment | undefined {
  const normalized = value.replace(/\s/g, "");
  if (!/^:?-{3,}:?$/.test(normalized)) return undefined;
  if (normalized.startsWith(":") && normalized.endsWith(":")) return "center";
  if (normalized.endsWith(":")) return "right";
  return "left";
}

export function parseMarkdownTable(lines: string[], startIndex: number): ParsedMarkdownTable | undefined {
  const headers = splitMarkdownTableRow(lines[startIndex] || "");
  const separators = splitMarkdownTableRow(lines[startIndex + 1] || "");
  if (!headers.length || headers.length !== separators.length) return undefined;
  const alignments = separators.map(separatorAlignment);
  if (alignments.some((item) => !item)) return undefined;

  const rows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex].trim();
    if (!line || !line.includes("|")) break;
    const cells = splitMarkdownTableRow(line);
    if (!cells.length) break;
    rows.push(headers.map((_, cellIndex) => cells[cellIndex] || ""));
    nextIndex += 1;
  }
  return {
    headers,
    alignments: alignments as MarkdownTableAlignment[],
    rows,
    nextIndex
  };
}
