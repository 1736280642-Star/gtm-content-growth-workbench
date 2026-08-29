import type { V5GovernanceActor } from "./knowledge-governance-repository";
import { getGeoResearchWorkspace } from "./geo-research-service";
import { listProductsWithGeoOverview } from "./product-registry-service";
import { compileProductStrategyPack } from "./product-strategy-pack-repository";
import { readCurrentProductStrategyPack } from "./product-strategy-pack-repository";
import { readLatestProductFixedExpression } from "./product-strategy-pack-repository";
import {
  compileProductGeoStrategyContentPlan,
  type ProductArticleSampleStandard,
  type ProductCoreExpressionRule,
  type ProductFixedExpressionRule
} from "./product-strategy-pack-contracts";
import { readProductWebsiteCoverageProfile } from "./website-coverage-repository";

export async function reconcilePromotedProductAutomation(input: { actor: V5GovernanceActor }) {
  const registry = await listProductsWithGeoOverview();
  const results: Array<{ productId: string; status: string; strategyPackId?: string; captureTasks?: number; detail?: string }> = [];
  for (const product of registry.products) {
    const overview = registry.overviews.find((item) => item.productId === product.productId);
    if (!overview?.isPromoting) continue;
    const state = await getGeoResearchWorkspace(product.productId);
    const blueprint = state.workspace?.currentBlueprint;
    const snapshot = state.readiness.latestSourceSnapshot;
    const governanceBinding = state.workspace?.latestRun?.plan.governanceBinding as {
      sourceSnapshotId?: string;
      rulePackageVersionId?: string;
      indexSnapshotId?: string;
    } | undefined;
    if (!state.workspace || !blueprint || !["pending_review", "approved"].includes(blueprint.status) || snapshot?.quality.status !== "ready") {
      results.push({ productId: product.productId, status: "waiting_for_research_synthesis", detail: "等待 GEO 调研综合稿和正式资料快照" });
      continue;
    }
    if (!governanceBinding?.sourceSnapshotId || !governanceBinding.rulePackageVersionId || !governanceBinding.indexSnapshotId
      || governanceBinding.sourceSnapshotId !== snapshot.snapshotId || state.workspace.latestRun?.runId !== blueprint.runId) {
      results.push({ productId: product.productId, status: "waiting_for_research_synthesis", detail: "当前调研结果未绑定最新规则包与索引" });
      continue;
    }
    const currentStrategy = await readCurrentProductStrategyPack(product.productId);
    const currentFixedExpression = currentStrategy?.contentPlan
      && "fixedExpression" in currentStrategy.contentPlan
      && currentStrategy.contentPlan.fixedExpression
      && typeof currentStrategy.contentPlan.fixedExpression === "object"
      ? currentStrategy.contentPlan.fixedExpression as ProductFixedExpressionRule
      : undefined;
    const currentCoreExpressions = currentStrategy?.contentPlan
      && "coreExpressions" in currentStrategy.contentPlan
      && currentStrategy.contentPlan.coreExpressions
      && typeof currentStrategy.contentPlan.coreExpressions === "object"
      ? currentStrategy.contentPlan.coreExpressions as ProductCoreExpressionRule
      : undefined;
    const inheritedFixedExpression = currentFixedExpression || await readLatestProductFixedExpression(product.productId);
    const legacyParts = inheritedFixedExpression?.text.split(/[；\n]/).map((item) => item.trim()).filter(Boolean) || [];
    const inferredRelationship = product.entityRelationship || legacyParts.slice(1).join("；") || inheritedFixedExpression?.text || "";
    const inheritedCoreExpressions = currentCoreExpressions || (inferredRelationship ? {
      productIdentity: legacyParts[0] || product.displayName,
      entityRelationship: inferredRelationship,
      fixedExpression: "",
      ctaLabel: "",
      ctaUrl: "",
      channels: state.workspace.project.targetChannels
    } : undefined);
    const inheritedSampleStandards = currentStrategy?.contentPlan
      && "articleTypePortfolio" in currentStrategy.contentPlan
      && Array.isArray(currentStrategy.contentPlan.articleTypePortfolio)
      ? Object.fromEntries(currentStrategy.contentPlan.articleTypePortfolio.flatMap((item) => (
          item.sampleStandard
            ? [[item.name, item.sampleStandard as ProductArticleSampleStandard]]
            : []
        )))
      : undefined;
    const websiteCoverageProfile = await readProductWebsiteCoverageProfile(product.productId);
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
        entityRelationship: product.entityRelationship,
        governanceBinding: {
          sourceSnapshotId: governanceBinding.sourceSnapshotId,
          rulePackageVersionId: governanceBinding.rulePackageVersionId,
          indexSnapshotId: governanceBinding.indexSnapshotId,
          researchRunId: blueprint.runId
        },
        fixedExpression: inheritedFixedExpression,
        coreExpressions: inheritedCoreExpressions,
        sampleStandards: inheritedSampleStandards,
        websiteCoverageProfile
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
