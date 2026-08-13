import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getActiveProduct } from "@/lib/v5/product-registry-service";
import { readTrustedServerActor } from "@/lib/v5/knowledge-governance-api";
import { runAutomaticKnowledgeRefresh } from "@/lib/v5/rag/knowledge-refresh-service";
import { runAutomaticGeoResearchOrchestration } from "@/lib/v5/geo-research-service";
import { reconcilePromotedProductAutomation } from "@/lib/v5/product-automation-service";
import { extractManagedClaimsForProduct } from "@/lib/v5/rag/managed-claim-extraction-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Trigger source snapshot rebuild
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const product = await getActiveProduct(routeParams.productId);
    const actor = readTrustedServerActor("product_owner") || {
      actorId: "local-workbench-user",
      actorRole: "product_owner",
      actorType: "human" as const,
      auditReason: "用户触发产品资料快照与检索索引重建"
    };
    const automationActor = { ...actor, actorType: "system" as const, actorRole: "product_automation", auditReason: "资料更新后自动推进 GEO 调研与产品策略" };
    const knowledgeActor = {
      ...automationActor,
      actorRole: "knowledge_production_worker",
      auditReason: "资料导入后抽取产品事实并重建受治理的资料快照"
    };
    const extraction = await extractManagedClaimsForProduct(product.productId, knowledgeActor);
    const result = await runAutomaticKnowledgeRefresh({ productId: product.productId, actor: knowledgeActor });
    const research = await runAutomaticGeoResearchOrchestration({ actor: automationActor });
    const automation = await reconcilePromotedProductAutomation({ actor: automationActor });
    return NextResponse.json({
      ok: true,
      productId: product.productId,
      message: "资料快照已重建，检索索引构建任务已创建",
      snapshotId: result.context.sourceSnapshotId,
      sourceSnapshotHash: result.context.sourceSnapshotHash,
      indexSnapshotId: result.index.snapshot.indexSnapshotId,
      extraction,
      research,
      automation
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
