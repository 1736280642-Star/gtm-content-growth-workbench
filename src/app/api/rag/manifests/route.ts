import { NextResponse } from "next/server";
import { ragErrorResponse, readRagActor, readRagPayload, strings } from "@/lib/v5/rag/rag-api";
import { createRagManifest } from "@/lib/v5/rag/rag-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const p = await readRagPayload(request);
    const result = await createRagManifest({
      productId: String(p.productId || ""), knowledgeBaseIds: strings(p.knowledgeBaseIds), activeRulePackageVersionId: String(p.activeRulePackageVersionId || ""),
      approvedSourceRevisionIds: strings(p.approvedSourceRevisionIds), approvedClaimIds: strings(p.approvedClaimIds), blockedClaimIds: strings(p.blockedClaimIds),
      unresolvedConflictIds: strings(p.unresolvedConflictIds), authorityPolicyVersion: String(p.authorityPolicyVersion || ""),
      monthlyProductionReadinessId: String(p.monthlyProductionReadinessId || ""), matrixScopeVersion: String(p.matrixScopeVersion || ""),
      status: String(p.status || "draft") as "draft" | "awaiting_approval" | "approved" | "superseded" | "revoked",
      approvedBy: typeof p.approvedBy === "string" ? p.approvedBy : undefined, approvedAt: typeof p.approvedAt === "string" ? p.approvedAt : undefined,
      actor: readRagActor(p)
    });
    return NextResponse.json({ ok: true, data: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return ragErrorResponse(error); }
}
