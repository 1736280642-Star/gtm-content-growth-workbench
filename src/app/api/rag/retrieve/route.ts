import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ragErrorResponse, readRagActor, readRagPayload, strings } from "@/lib/v5/rag/rag-api";
import { retrieveRag } from "@/lib/v5/rag/rag-service";
import type { RagNamespace, RagPlatformContentType } from "@/lib/v5/rag/contracts";
import type { V5LifecycleStatus, V5Visibility } from "@/lib/v5/knowledge-governance-contracts";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const p = await readRagPayload(request);
    const data = await retrieveRag({ request: {
      retrievalRequestId: typeof p.retrievalRequestId === "string" ? p.retrievalRequestId : `request-${randomUUID()}`,
      matrixItemId: String(p.matrixItemId || ""), taskId: typeof p.taskId === "string" ? p.taskId : undefined,
      taskVersion: typeof p.taskVersion === "number" ? p.taskVersion : undefined, productId: String(p.productId || ""), productName: String(p.productName || ""),
      namespace: String(p.namespace || "production_public") as RagNamespace, language: String(p.language || "zh-CN"), title: String(p.title || ""),
      channel: String(p.channel || "wechat"), contentType: String(p.contentType || ""), platformContentType: String(p.platformContentType || "") as RagPlatformContentType,
      targetAudience: String(p.targetAudience || ""), sourceProblem: String(p.sourceProblem || ""), distilledTermIds: strings(p.distilledTermIds),
      rulePackageVersionId: String(p.rulePackageVersionId || ""), permissionScope: strings(p.permissionScope) as V5Visibility[], lifecycleStatuses: strings(p.lifecycleStatuses) as V5LifecycleStatus[],
      requestedAt: new Date().toISOString()
    }, indexSnapshotId: String(p.indexSnapshotId || ""), actor: readRagActor(p) });
    return NextResponse.json({ ok: true, data });
  } catch (error) { return ragErrorResponse(error); }
}
