import { inflateRawSync } from "node:zlib";

export interface XlsxTable {
  sheetName: string;
  csv: string;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === signature) {
      return offset;
    }
  }

  throw new Error("无法读取 xlsx 文件目录。");
}

function readZipEntries(buffer: Buffer) {
  const entries = new Map<string, Buffer>();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16);
  const centralDirectorySize = readUInt32(buffer, eocdOffset + 12);
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      break;
    }

    const entry: ZipEntry = {
      name: buffer.toString("utf8", offset + 46, offset + 46 + readUInt16(buffer, offset + 28)),
      method: readUInt16(buffer, offset + 10),
      compressedSize: readUInt32(buffer, offset + 20),
      localHeaderOffset: readUInt32(buffer, offset + 42)
    };
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localFileNameLength = readUInt16(buffer, entry.localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) {
      entries.set(entry.name, compressed);
    } else if (entry.method === 8) {
      entries.set(entry.name, inflateRawSync(compressed));
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function readSharedStrings(xml?: string) {
  if (!xml) {
    return [];
  }

  return Array.from(xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)).map((match) =>
    Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((textMatch) => decodeXml(textMatch[1]))
      .join("")
  );
}

function readWorkbookSheets(workbookXml: string, relsXml: string) {
  const relationships = new Map<string, string>();

  for (const match of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    const target = match[2].startsWith("/") ? match[2].slice(1) : `xl/${match[2].replace(/^\.\.\//, "")}`;
    relationships.set(match[1], target);
  }

  return Array.from(workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*(?:r:id|id)="([^"]+)"/g)).map((match) => ({
    name: decodeXml(match[1]),
    path: relationships.get(match[2])
  }));
}

function columnIndex(cellRef: string) {
  const letters = cellRef.match(/[A-Z]+/)?.[0] || "A";
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return index - 1;
}

function readCellValue(cellXml: string, sharedStrings: string[]) {
  const type = cellXml.match(/\st="([^"]+)"/)?.[1];
  const inlineText = cellXml.match(/<is[^>]*>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
  const value = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || "";

  if (type === "inlineStr") {
    return decodeXml(inlineText || "");
  }

  if (type === "s") {
    return sharedStrings[Number(value)] || "";
  }

  return decodeXml(value);
}

function csvEscape(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

function sheetToCsv(sheetXml: string, sharedStrings: string[]) {
  const rows: string[][] = [];

  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c[^>]*r="([^"]+)"[^>]*>([\s\S]*?)<\/c>/g)) {
      cells[columnIndex(cellMatch[1])] = readCellValue(cellMatch[0], sharedStrings);
    }

    rows.push(cells.map((cell) => cell || ""));
  }

  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => csvEscape(row[index] || "")).join(",")).join("\n");
}

export function extractXlsxTables(buffer: Buffer): XlsxTable[] {
  const entries = readZipEntries(buffer);
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");

  if (!workbookXml || !relsXml) {
    throw new Error("xlsx 文件缺少 workbook 元数据。");
  }

  const sharedStrings = readSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  return readWorkbookSheets(workbookXml, relsXml)
    .map((sheet) => {
      const sheetXml = sheet.path ? entries.get(sheet.path)?.toString("utf8") : undefined;
      return sheetXml ? { sheetName: sheet.name, csv: sheetToCsv(sheetXml, sharedStrings) } : undefined;
    })
    .filter((item): item is XlsxTable => Boolean(item));
}
