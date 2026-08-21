import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const [productId, previousRunId = ""] = process.argv.slice(2);
if (!productId) {
  throw new Error("Usage: node scripts/start-scoped-product-geo-refresh.mjs <productId> [previousRunId]");
}

const [
  { extractManagedClaimsForProduct },
  { runAutomaticKnowledgeRefresh },
  { getGeoResearchWorkspace, runAutomaticGeoResearchOrchestration },
  { reconcilePromotedProductAutomation },
  { getV5GovernancePool }
] = await Promise.all([
  import("../src/lib/v5/rag/managed-claim-extraction-service.ts"),
  import("../src/lib/v5/rag/knowledge-refresh-service.ts"),
  import("../src/lib/v5/geo-research-service.ts"),
  import("../src/lib/v5/product-automation-service.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);

const actor = {
  actorId: `scoped-adp-refresh-${process.pid}-${randomUUID()}`,
  actorRole: "knowledge_production_worker",
  actorType: "system",
  auditReason: "用户要求只针对指定产品重读资料并重新启动 GEO 调研与策略生成"
};

try {
  const extraction = await extractManagedClaimsForProduct(productId, actor);
  const refresh = await runAutomaticKnowledgeRefresh({ productId, actor });
  const orchestration = await runAutomaticGeoResearchOrchestration({
    actor: { ...actor, actorRole: "product_automation", auditReason: "指定产品资料刷新后启动新的 GEO 调研" },
    productIds: [productId]
  });
  const state = await getGeoResearchWorkspace(productId);
  const latestRunId = state.workspace?.latestRun?.runId || "";
  if (!latestRunId || latestRunId === previousRunId) {
    throw new Error(`scoped_geo_refresh_did_not_create_new_run:${latestRunId || "missing"}`);
  }
  const automation = await reconcilePromotedProductAutomation({
    actor: { ...actor, actorRole: "product_automation", auditReason: "指定产品 GEO 运行启动后的策略状态对齐" }
  });
  console.log(JSON.stringify({
    status: "queued",
    productId,
    extraction: {
      sourceCount: extraction.sourceCount,
      supportedClaimCount: extraction.supportedClaimCount,
      conditionalClaimCount: extraction.conditionalClaimCount,
      blockedClaimCount: extraction.blockedClaimCount
    },
    knowledge: {
      sourceSnapshotId: refresh.context.sourceSnapshotId,
      approvedClaimCount: refresh.context.approvedClaimIds.length,
      indexSnapshotId: refresh.index.snapshot.indexSnapshotId
    },
    orchestration,
    run: {
      runId: latestRunId,
      status: state.workspace?.latestRun?.status,
      runVersion: state.workspace?.latestRun?.runVersion,
      taskCount: state.workspace?.latestTasks?.length
    },
    automation: automation.products.find((item) => item.productId === productId)
  }));
} finally {
  await getV5GovernancePool().end().catch(() => undefined);
}
