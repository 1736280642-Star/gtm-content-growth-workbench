import type { V5GovernanceActor } from "./knowledge-governance-repository";
import { getGeoResearchWorkspace } from "./geo-research-service";
import { listProductsWithGeoOverview } from "./product-registry-service";
import { compileProductStrategyPack } from "./product-strategy-pack-repository";
import { compileProductGeoStrategyContentPlan } from "./product-strategy-pack-contracts";

export async function reconcilePromotedProductAutomation(input: { actor: V5GovernanceActor }) {
  const registry = await listProductsWithGeoOverview();
  const results: Array<{ productId: string; status: string; strategyPackId?: string; captureTasks?: number; detail?: string }> = [];
  for (const product of registry.products) {
    const overview = registry.overviews.find((item) => item.productId === product.productId);
    if (!overview?.isPromoting) continue;
    const state = await getGeoResearchWorkspace(product.productId);
    const blueprint = state.workspace?.currentBlueprint;
    const snapshot = state.readiness.latestSourceSnapshot;
    if (!state.workspace || !blueprint || !["pending_review", "approved"].includes(blueprint.status) || snapshot?.quality.status !== "ready") {
      results.push({ productId: product.productId, status: "waiting_for_research_synthesis", detail: "等待 GEO 调研综合稿和正式资料快照" });
      continue;
    }
    const compiled = await compileProductStrategyPack({
      productId: product.productId,
      geoBlueprintId: blueprint.blueprintVersionId,
      sourceSnapshotId: snapshot.snapshotId,
      ruleVersion: `geo-blueprint-v${blueprint.versionNumber}`,
      contentPlan: compileProductGeoStrategyContentPlan({
        project: state.workspace.project,
        blueprint,
        sourceSnapshotId: snapshot.snapshotId,
        synthesisModel: "zhipu",
        productKnowledgeProfile: state.productProfile,
        productName: product.displayName,
        entityRelationship: product.entityRelationship
      }),
      actor: input.actor
    });
    // Shadow orchestration is deliberately best-effort and non-authoritative.
    // It gets a fresh strategy-scoped checkpoint, while strategy compilation
    // remains successful even when Graph is unavailable.
    try {
      const { startProductGeoDomainShadowWorkflow } = await import("./graph/product-geo-workflow-service");
      await startProductGeoDomainShadowWorkflow({
        productId: product.productId,
        researchPolicyVersion: "geo-research.v2+domain-shadow.v3",
        idempotencyKey: `strategy-shadow:${compiled.pack.id}`,
        actor: { ...input.actor, auditReason: "策略编译完成后建立只读 Graph Shadow，不写入人工审批" }
      });
    } catch {
      // Graph cannot become a dependency of the formal strategy path.
    }
    results.push({
      productId: product.productId,
      status: compiled.pack.status === "pending_strategy_review" ? "pending_strategy_review" : compiled.pack.status,
      strategyPackId: compiled.pack.id,
      captureTasks: 0,
      detail: compiled.pack.status === "pending_strategy_review" ? "产品 GEO 策略包已生成，等待用户确认" : undefined
    });
  }
  return {
    products: results,
    readyCount: results.filter((item) => ["strategy_approved", "pending_sample_review", "production_ready", "active"].includes(item.status)).length,
    reviewRequiredCount: results.filter((item) => item.status === "pending_strategy_review").length
  };
}
