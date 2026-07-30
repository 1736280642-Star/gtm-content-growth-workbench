import { readRequestPayload, readString } from "@/lib/api-utils";
import { parseKnowledgeSourcesForPreview } from "@/lib/workbench-store";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { readManagedSourceImportActor } from "@/lib/v5/rag/managed-source-import-api";
import { importManagedSources } from "@/lib/v5/rag/managed-source-import-service";
import type { ManagedKnowledgeProductId, ManagedSourceAuthorityLevel } from "@/lib/v5/rag/managed-source-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readRequestPayload(request);
    const preview = await parseKnowledgeSourcesForPreview({
      name: readString(payload.name),
      title: readString(payload.name),
      urlsText: readString(payload.urlsText)
    });
    const sources = preview.data?.sources || [];
    const usable = sources.filter((source) => source.status === "parsed" && source.markdown.trim());
    if (!usable.length) {
      return NextResponse.json({ ok: false, message: "URL 均未解析出可用正文。", details: sources.map((source) => ({ url: source.url, reason: source.errorMessage })) }, { status: 400 });
    }
    const data = await importManagedSources({
      knowledgeBaseName: readString(payload.name) || "",
      productId: readString(payload.productId) as ManagedKnowledgeProductId,
      authorityLevel: readString(payload.authorityLevel) as ManagedSourceAuthorityLevel,
      publicUseConfirmed: payload.publicUseConfirmed === true,
      idempotencyKey: readString(payload.idempotencyKey) || "",
      actor: readManagedSourceImportActor(request),
      sources: usable.map((source) => ({
        sourceKey: source.url || source.id,
        title: source.title,
        markdown: source.markdown,
        canonicalUrl: source.url,
        rawContent: Buffer.from(source.extractedText, "utf8"),
        mimeType: "text/markdown",
        originalFileName: source.url
      }))
    });
    const failedSources = sources.filter((source) => source.status === "failed").map((source) => ({ url: source.url, reason: source.errorMessage }));
    return NextResponse.json({
      ok: true,
      status: data.pipelineStatus,
      message: data.pipelineStatus === "queued"
        ? "URL 正文已托管到 MySQL，治理与索引任务已排队。"
        : "URL 正文已托管到 MySQL；RAG 基础设施配置完成后任务会自动恢复。",
      data: { ...data, failedSources }
    }, { status: 202 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
