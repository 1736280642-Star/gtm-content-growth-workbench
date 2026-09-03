import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const [productId, strategyPackId, idempotencyKey] = process.argv.slice(2);
if (!productId || !strategyPackId || !idempotencyKey) {
  throw new Error("Usage: node scripts/run-authorized-product-sample-generation.mjs <productId> <strategyPackId> <idempotencyKey>");
}

const [{ enqueueProductSampleArticles }, { getV5GovernancePool }] = await Promise.all([
  import("../src/lib/v5/product-sample-article-service.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);

const actorId = String(process.env.V5_SINGLE_ARTICLE_ACTOR_ID || "").trim();
const actorRole = String(process.env.V5_SINGLE_ARTICLE_ACTOR_ROLE || "").trim();
if (!actorId || !["workbench_operator", "developer_admin"].includes(actorRole)) {
  throw new Error("trusted_single_article_actor_missing");
}

try {
  const queued = await enqueueProductSampleArticles({
    productId,
    strategyPackId,
    idempotencyKey,
    actor: {
      actorId,
      actorRole,
      actorType: "human",
      auditReason: "用户在当前任务中明确授权策略确认后自动推进增强版代表样文生成"
    }
  });
  process.stdout.write(`${JSON.stringify({
    status: "queued",
    productId,
    strategyPackId,
    samples: queued.map((item) => ({
      taskId: item.taskId,
      operationId: item.operation.operationId,
      title: item.title,
      status: item.operation.status,
      progressStage: item.operation.progressStage
    }))
  })}\n`);
} finally {
  await getV5GovernancePool().end().catch(() => undefined);
}
