import { gunzipSync } from "node:zlib";

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && "arrayBuffer" in value && "name" in value;
}

function decodeLogBuffer(fileName: string, buffer: Buffer) {
  if (fileName.toLowerCase().endsWith(".gz")) {
    return gunzipSync(buffer).toString("utf8").replace(/^\uFEFF/, "");
  }

  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

export async function readLogImportPayloadFromFormData(formData: FormData): Promise<Record<string, unknown>> {
  const sourceType = typeof formData.get("sourceType") === "string" ? String(formData.get("sourceType")) : "cdn_log";
  const texts: string[] = [];
  const fileNames: string[] = [];

  for (const value of formData.getAll("files")) {
    if (!isUploadFile(value)) {
      continue;
    }

    const fileName = value.name;
    const buffer = Buffer.from(await value.arrayBuffer());
    texts.push(decodeLogBuffer(fileName, buffer));
    fileNames.push(fileName);
  }

  const pastedText = formData.get("text") || formData.get("csv") || formData.get("rawLog");
  if (typeof pastedText === "string" && pastedText.trim()) {
    texts.push(pastedText);
  }

  return {
    sourceType,
    rawLog: texts.join("\n"),
    fileName: fileNames.join(", ")
  };
}
