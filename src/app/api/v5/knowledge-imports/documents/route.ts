import { parseKnowledgeDocumentFile } from "@/lib/knowledge-document-parser";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { readManagedSourceImportActor } from "@/lib/v5/rag/managed-source-import-api";
import { importManagedSources } from "@/lib/v5/rag/managed-source-import-service";
import type { ManagedKnowledgeProductId, ManagedSourceAuthorityLevel } from "@/lib/v5/rag/managed-source-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length || files.length > MAX_FILES) {
      return NextResponse.json({ ok: false, message: `请上传 1-${MAX_FILES} 个文件。` }, { status: 400 });
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      return NextResponse.json({ ok: false, message: "单个上传文件不能超过 20 MB。" }, { status: 413 });
    }
    const parsed = await Promise.all(files.map(async (file) => ({ file, document: await parseKnowledgeDocumentFile(file) })));
    const usable = parsed.filter((item) => item.document.status === "parsed");
    if (!usable.length) {
      return NextResponse.json({ ok: false, message: "上传文档均未解析出可用正文。" }, { status: 400 });
    }
    const data = await importManagedSources({
      knowledgeBaseName: field(formData, "name"),
      productId: field(formData, "productId") as ManagedKnowledgeProductId,
      authorityLevel: field(formData, "authorityLevel") as ManagedSourceAuthorityLevel,
      publicUseConfirmed: field(formData, "publicUseConfirmed") === "true",
      idempotencyKey: field(formData, "idempotencyKey"),
      actor: readManagedSourceImportActor(request),
      sources: await Promise.all(usable.map(async ({ file, document }) => ({
        sourceKey: file.name,
        title: file.name,
        markdown: document.markdown,
        rawContent: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "application/octet-stream",
        originalFileName: file.name
      })))
    });
    const failedFiles = parsed.filter((item) => item.document.status === "failed").map((item) => ({ fileName: item.file.name, reason: item.document.errorMessage }));
    return NextResponse.json({
      ok: true,
      status: data.pipelineStatus,
      message: data.pipelineStatus === "queued"
        ? "文档已托管到 MySQL，治理与索引任务已排队。"
        : "文档已托管到 MySQL；RAG 基础设施配置完成后任务会自动恢复。",
      data: { ...data, failedFiles }
    }, { status: 202 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
