import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mammoth from "mammoth";

export interface ParsedKnowledgeDocument {
  fileName: string;
  status: "parsed" | "failed";
  markdown: string;
  errorMessage?: string;
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textToMarkdown(fileName: string, text: string) {
  const normalized = normalizeExtractedText(text);

  if (!normalized) {
    return `## ${fileName}\n\n> 未提取到可用正文。`;
  }

  return `## ${fileName}\n\n${normalized}`;
}

async function parsePdf(fileName: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "joto-kb-pdf-"));
  const tempFilePath = path.join(tempDir, "source.pdf");

  try {
    await writeFile(tempFilePath, buffer);
    const text = normalizeExtractedText(await extractPdfText(tempFilePath));
    if (!text) {
      return {
        fileName,
        status: "failed",
        markdown: `## ${fileName}\n\n> PDF 已读取，但未提取到可用正文。`,
        errorMessage: "PDF 未提取到可用正文，可能是扫描件或加密文件。"
      };
    }

    return {
      fileName,
      status: "parsed",
      markdown: textToMarkdown(fileName, text)
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extractPdfText(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(process.execPath, [path.join(process.cwd(), "scripts", "parse-pdf-text.mjs"), filePath], { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
      let payload: { ok?: boolean; text?: string; message?: string } | undefined;

      try {
        payload = JSON.parse(stdout || "{}") as { ok?: boolean; text?: string; message?: string };
      } catch {
        payload = undefined;
      }

      if (error || !payload?.ok) {
        reject(new Error(payload?.message || error?.message || "PDF parse failed."));
        return;
      }

      resolve(payload.text || "");
    });
  });
}

async function parseDocx(fileName: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  const result = await mammoth.extractRawText({ buffer });
  const warningText = result.messages?.length ? `\n\n> 解析提示：${result.messages.map((item) => item.message).join("；")}` : "";

  return {
    fileName,
    status: "parsed",
    markdown: `${textToMarkdown(fileName, result.value || "")}${warningText}`
  };
}

async function parsePlainText(fileName: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  return {
    fileName,
    status: "parsed",
    markdown: textToMarkdown(fileName, buffer.toString("utf-8"))
  };
}

export async function parseKnowledgeDocumentFile(file: File): Promise<ParsedKnowledgeDocument> {
  const fileName = file.name || "未命名文档";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (/\.(md|markdown|txt)$/i.test(fileName)) {
      return await parsePlainText(fileName, buffer);
    }

    if (/\.pdf$/i.test(fileName)) {
      return await parsePdf(fileName, buffer);
    }

    if (/\.docx$/i.test(fileName)) {
      return await parseDocx(fileName, buffer);
    }

    if (/\.doc$/i.test(fileName)) {
      return {
        fileName,
        status: "failed",
        markdown: `## ${fileName}\n\n> 旧版 .doc 二进制格式暂不支持直接解析，请先转换为 .docx 后重新上传。`,
        errorMessage: "旧版 .doc 暂不支持直接解析。"
      };
    }

    return {
      fileName,
      status: "failed",
      markdown: `## ${fileName}\n\n> 不支持的文件格式。`,
      errorMessage: "不支持的文件格式。"
    };
  } catch (error) {
    return {
      fileName,
      status: "failed",
      markdown: `## ${fileName}\n\n> 文档解析失败：${error instanceof Error ? error.message : "未知错误"}`,
      errorMessage: error instanceof Error ? error.message : "文档解析失败。"
    };
  }
}

export async function parseKnowledgeDocumentsFromFormData(formData: FormData) {
  const entries = formData.getAll("files");
  const files = entries.filter((entry): entry is File => typeof entry === "object" && "arrayBuffer" in entry && "name" in entry);
  const documents = await Promise.all(files.map((file) => parseKnowledgeDocumentFile(file)));
  const contentPreview = documents.map((document) => document.markdown).join("\n\n---\n\n");
  const failedCount = documents.filter((document) => document.status === "failed").length;

  return {
    documents,
    contentPreview,
    failedCount
  };
}
