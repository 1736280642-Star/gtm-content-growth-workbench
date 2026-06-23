import { extractXlsxTables } from "./xlsx-lite";

export interface ChannelMetricImportTable {
  fileName: string;
  sheetName?: string;
  csv: string;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && "arrayBuffer" in value && "name" in value;
}

function decodeText(buffer: Buffer) {
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

export async function readChannelMetricTablesFromFormData(formData: FormData): Promise<ChannelMetricImportTable[]> {
  const tables: ChannelMetricImportTable[] = [];

  for (const value of formData.getAll("files")) {
    if (!isUploadFile(value)) {
      continue;
    }

    const fileName = value.name;
    const buffer = Buffer.from(await value.arrayBuffer());
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith(".xlsx")) {
      tables.push(
        ...extractXlsxTables(buffer).map((table) => ({
          fileName,
          sheetName: table.sheetName,
          csv: table.csv
        }))
      );
      continue;
    }

    if (lowerName.endsWith(".xls") && buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) {
      throw new Error(`${fileName} 是旧版二进制 .xls，请先在 Excel/WPS 中另存为 .xlsx 或 CSV 后再导入。`);
    }

    tables.push({
      fileName,
      csv: decodeText(buffer)
    });
  }

  const csv = formData.get("csv");
  if (typeof csv === "string" && csv.trim()) {
    tables.push({
      fileName: "粘贴文本",
      csv
    });
  }

  return tables;
}
