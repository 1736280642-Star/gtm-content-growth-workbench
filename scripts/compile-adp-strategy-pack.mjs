import { getGeoResearchWorkspace } from "../src/lib/v5/geo-research-service.ts";
import { getActiveProduct } from "../src/lib/v5/product-registry-service.ts";
import { compileProductStrategyPack } from "../src/lib/v5/product-strategy-pack-repository.ts";
import { readCurrentProductStrategyPack } from "../src/lib/v5/product-strategy-pack-repository.ts";
import { readLatestProductFixedExpression } from "../src/lib/v5/product-strategy-pack-repository.ts";
import { compileProductGeoStrategyContentPlan } from "../src/lib/v5/product-strategy-pack-contracts.ts";
import { readProductWebsiteCoverageProfile } from "../src/lib/v5/website-coverage-repository.ts";
import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository.ts";

const productId = process.argv[2] || "tencent-adp-joto";

const actor = {
  actorId: "codex-operator",
  actorRole: "product_automation",
  actorType: "system",
  auditReason: "仅针对腾讯云 ADP 从已完成的 GEO 调研蓝图编译策略包。"
};

try {
  const product = await getActiveProduct(productId);
  if (!product) throw new Error(`product_not_found:${productId}`);

  const state = await getGeoResearchWorkspace(productId);
  const blueprint = state.workspace?.currentBlueprint;
  const snapshot = state.readiness.latestSourceSnapshot;
  const governanceBinding = state.workspace?.latestRun?.plan.governanceBinding || {};

  if (!state.workspace || !blueprint || !["pending_review", "approved"].includes(blueprint.status) || snapshot?.quality.status !== "ready") {
    throw new Error(`waiting_for_research_synthesis:${productId}:${blueprint?.status}:${snapshot?.quality.status}`);
  }
  if (!governanceBinding.sourceSnapshotId || !governanceBinding.rulePackageVersionId || !governanceBinding.indexSnapshotId
    || governanceBinding.sourceSnapshotId !== snapshot.snapshotId || state.workspace.latestRun?.runId !== blueprint.runId) {
    throw new Error(`waiting_for_research_synthesis:binding_mismatch:${productId}`);
  }

  const currentStrategy = await readCurrentProductStrategyPack(productId);
  const currentFixedExpression = currentStrategy?.contentPlan
    && "fixedExpression" in currentStrategy.contentPlan
    && currentStrategy.contentPlan.fixedExpression
    && typeof currentStrategy.contentPlan.fixedExpression === "object"
    ? currentStrategy.contentPlan.fixedExpression
    : undefined;
  const inheritedFixedExpression = currentFixedExpression || await readLatestProductFixedExpression(productId);
  const websiteCoverageProfile = await readProductWebsiteCoverageProfile(productId);

  const compiled = await compileProductStrategyPack({
    productId,
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
      websiteCoverageProfile
    }),
    actor
  });

  process.stdout.write(`${JSON.stringify({
    status: compiled.pack.status,
    strategyPackId: compiled.pack.id,
    productId,
    blueprintVersionId: blueprint.blueprintVersionId,
    ruleVersion: `geo-blueprint-v${blueprint.versionNumber}`
  })}\n`);
} finally {
  await getV5GovernancePool().end();
}
