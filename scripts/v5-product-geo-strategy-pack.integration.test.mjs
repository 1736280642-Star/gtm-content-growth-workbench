import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const { getV5GovernancePool } = await import("../src/lib/v5/knowledge-governance-repository.ts");
const { compileProductStrategyPack } = await import("../src/lib/v5/product-strategy-pack-repository.ts");
const { amendApprovedProductStrategyFixedExpression, decideProductGeoStrategyPack, getProductGeoStrategyPackView } = await import("../src/lib/v5/product-strategy-pack-service.ts");
const { productGeoStrategyContractVersion } = await import("../src/lib/v5/product-strategy-pack-contracts.ts");

const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const productId = `strategy-it-product-${suffix}`;
const productName = `strategy-it-${suffix}`;
const packIds = [];
const pool = getV5GovernancePool();

const systemActor = {
  actorId: "strategy-integration-system",
  actorRole: "product_automation",
  actorType: "system",
  auditReason: "集成测试：自动编译产品 GEO 策略"
};

const humanActor = {
  actorId: "strategy-integration-human",
  actorRole: "product_owner",
  actorType: "human",
  auditReason: "集成测试：用户确认产品 GEO 策略"
};

function contentPlan(revision) {
  const portfolio = [
    {
      portfolioItemId: `portfolio-${revision}-matched`, origin: "matched", articleTypeId: "system-template-scenario-solution", articleTypeVersionId: "system-template-scenario-solution-v1",
      name: "场景解决方案", definition: "围绕真实业务场景解释问题与边界。", suitableQuestions: ["适合什么场景？"], unsuitableQuestions: ["纯技术排错"], targetAudience: ["业务负责人"], contentGoal: "支持场景判断",
      structureModules: [{ key: "场景现状", purpose: "建立真实语境", required: true }], emphasisOrder: ["场景", "边界"], style: ["务实"], lengthRange: { min: 1200, max: 2200 }, evidencePreferences: ["产品文档"], ctaIntent: "评估适用条件", channelFit: ["wechat"], questionClusterIds: ["cluster-1"], recommendationReason: "适配场景问题", confidence: 0.9, evidenceReadiness: "ready", proposedMonthlyShare: 0.5, definitionHash: `matched-hash-${revision}`, raw: {}
    },
    {
      portfolioItemId: `portfolio-${revision}-generated`, origin: "generated", articleTypeId: `product-type-${revision}`, articleTypeVersionId: `strategy-generated-${revision}-${suffix}`,
      name: "人机协作边界指南", definition: "解释自动执行与人工判断的分工。", suitableQuestions: ["哪些步骤必须人工确认？"], unsuitableQuestions: ["没有流程背景的问题"], targetAudience: ["项目负责人"], contentGoal: "建立人机边界",
      structureModules: [{ key: "判断边界", purpose: "明确责任", required: true }], emphasisOrder: ["人工判断", "自动执行"], style: ["克制"], lengthRange: { min: 1400, max: 2400 }, evidencePreferences: ["治理规则"], ctaIntent: "梳理当前流程", channelFit: ["wechat"], questionClusterIds: ["cluster-2"], recommendationReason: "现有模板不能完整覆盖", confidence: 0.86, evidenceReadiness: "ready", proposedMonthlyShare: 0.3, definitionHash: `generated-hash-${revision}`, raw: {}
    },
    {
      portfolioItemId: `portfolio-${revision}-adapted`, origin: "adapted", articleTypeId: "system-template-implementation-guide", articleTypeVersionId: `strategy-adapted-${revision}-${suffix}`, baseArticleTypeId: "system-template-implementation-guide", baseArticleTypeVersionId: "system-template-implementation-guide-v1",
      name: "WorkBuddy 实施指南", definition: "按 WorkBuddy 场景改造的实施路径。", suitableQuestions: ["如何落地？"], unsuitableQuestions: ["品牌认知问题"], targetAudience: ["实施负责人"], contentGoal: "指导实施",
      structureModules: [{ key: "前置条件", purpose: "校验准备度", required: true }], emphasisOrder: ["条件", "步骤"], style: ["具体"], lengthRange: { min: 1600, max: 2600 }, evidencePreferences: ["实施文档"], ctaIntent: "评估实施条件", channelFit: ["wechat"], questionClusterIds: ["cluster-3"], recommendationReason: "需要产品化改造", confidence: 0.8, evidenceReadiness: "partial", proposedMonthlyShare: 0.2, definitionHash: `adapted-hash-${revision}`, raw: {}
    }
  ];
  return {
    contractVersion: productGeoStrategyContractVersion,
    sourceSnapshotId: `source-snapshot-${suffix}-${revision}`,
    researchSnapshotHash: `research-hash-${revision}`,
    productPositioning: {
      expressionFocus: `策略版本 ${revision}`,
      targetAudience: ["项目负责人"], jobs: ["划分人机协作边界"], differentiators: [], applicableScenarios: [], excludedScenarios: [],
      prohibitedClaims: ["不得编造事实"],
      targetMarkets: ["CN"],
      languages: ["zh-CN"]
    },
    geoOpportunities: [{
      opportunityId: `opportunity-${revision}`,
      title: "产品能力与适用边界",
      intent: "adoption_evaluation",
      priority: "high",
      productFit: "由正式产品资料支持",
      evidenceReadiness: "ready",
      representativeQuestions: ["产品适合哪些场景？"],
      sourceIds: [],
      raw: {}
    }],
    articleTypePortfolio: portfolio,
    evidencePolicy: { requiredRoles: [], knowledgeGaps: [], citationStrategy: {}, evidenceRequirements: {} },
    expressionDirection: { keyMessages: [`策略版本 ${revision}`], emphasisOrder: ["产品能力", "适用边界"], prohibitedPatterns: [], tone: ["客观"] },
    channelPriorities: ["wechat"],
    recommendedMonthlyMix: {},
    retestBaseline: {},
    synthesis: { model: "zhipu", blueprintVersionId: `blueprint-${revision}`, blueprintVersionNumber: revision, runId: `run-${revision}` },
    researchSynthesis: { questionStrategy: {}, competitorLandscape: {}, contentTypeStrategy: {} }
  };
}

test.before(async () => {
  await pool.query(
    `INSERT INTO product_entity
     (id, canonical_name, display_name, aliases, status, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, '[]', 'active', 'strategy-integration-human', NOW())`,
    [productId, productName, productName]
  );
});

test.after(async () => {
  await pool.query("DELETE FROM governance_audit_event WHERE correlation_id = ? OR object_id IN (?)", [productId, packIds.length ? packIds : ["none"]]);
  await pool.query("DELETE FROM product_strategy_article_type_versions WHERE product_id = ?", [productId]);
  await pool.query("DELETE FROM product_strategy_packs WHERE product_id = ?", [productId]);
  await pool.query("DELETE FROM product_entity WHERE id = ?", [productId]);
  await pool.end();
});

test("compile is pending, human approval is required, replay is idempotent and rejection preserves current strategy", async () => {
  const first = await compileProductStrategyPack({
    productId,
    geoBlueprintId: "blueprint-1",
    sourceSnapshotId: `source-snapshot-${suffix}-1`,
    ruleVersion: "geo-blueprint-v1",
    contentPlan: contentPlan(1),
    actor: systemActor
  });
  packIds.push(first.pack.id);
  assert.equal(first.pack.status, "pending_strategy_review");
  assert.equal(first.pack.rowVersion, 1);

  let view = await getProductGeoStrategyPackView(productId);
  assert.equal(view.latestStrategyPack?.id, first.pack.id);
  assert.equal(view.currentStrategyPack, undefined);

  await assert.rejects(
    () => decideProductGeoStrategyPack({
      productId,
      strategyPackId: first.pack.id,
      decision: "approve",
      expectedVersion: 1,
      idempotencyKey: `system-approval-${suffix}`,
      actor: systemActor
    }),
    (error) => error?.code === "human_strategy_approval_required"
  );

  const approvalKey = `human-approval-${suffix}`;
  const selectedPortfolioItemIds = [`portfolio-1-matched`, `portfolio-1-generated`];
  const approved = await decideProductGeoStrategyPack({
    productId,
    strategyPackId: first.pack.id,
    decision: "approve",
    expectedVersion: 1,
    idempotencyKey: approvalKey,
    selectedPortfolioItemIds,
    actor: humanActor
  });
  assert.equal(approved.status, "strategy_approved");
  assert.equal(approved.rowVersion, 2);
  assert.equal(approved.replayed, false);

  const replay = await decideProductGeoStrategyPack({
    productId,
    strategyPackId: first.pack.id,
    decision: "approve",
    expectedVersion: 1,
    idempotencyKey: approvalKey,
    selectedPortfolioItemIds,
    actor: humanActor
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.rowVersion, 2);

  await assert.rejects(
    () => decideProductGeoStrategyPack({
      productId,
      strategyPackId: first.pack.id,
      decision: "approve",
      expectedVersion: 1,
      idempotencyKey: approvalKey,
      selectedPortfolioItemIds: [`portfolio-1-generated`, `portfolio-1-adapted`],
      actor: humanActor
    }),
    (error) => error?.code === "idempotency_key_reused"
  );

  const [typeRows] = await pool.query(
    "SELECT portfolio_item_id, status FROM product_strategy_article_type_versions WHERE strategy_pack_id = ? ORDER BY portfolio_item_id",
    [first.pack.id]
  );
  assert.deepEqual(Object.fromEntries(typeRows.map((row) => [row.portfolio_item_id, row.status])), {
    "portfolio-1-adapted": "rejected",
    "portfolio-1-generated": "active",
    "portfolio-1-matched": "frozen"
  });

  view = await getProductGeoStrategyPackView(productId);
  assert.equal(view.currentStrategyPack?.id, first.pack.id);
  assert.equal(view.currentStrategyPack?.status, "strategy_approved");

  const fixedExpression = {
    text: "JOTO是腾讯云ADP CSP授权服务商。",
    positions: ["opening", "ending"],
    channels: ["wechat"]
  };
  const amendmentKey = `fixed-expression-${suffix}`;
  const amended = await amendApprovedProductStrategyFixedExpression({
    productId,
    strategyPackId: first.pack.id,
    expectedVersion: 2,
    idempotencyKey: amendmentKey,
    fixedExpression,
    actor: { ...humanActor, auditReason: "集成测试：样稿生成前补录固定表达" }
  });
  assert.equal(amended.pack.rowVersion, 3);
  assert.deepEqual(amended.pack.contentPlan.fixedExpression, fixedExpression);
  const amendmentReplay = await amendApprovedProductStrategyFixedExpression({
    productId,
    strategyPackId: first.pack.id,
    expectedVersion: 2,
    idempotencyKey: amendmentKey,
    fixedExpression,
    actor: { ...humanActor, auditReason: "集成测试：样稿生成前补录固定表达" }
  });
  assert.equal(amendmentReplay.replayed, true);
  assert.equal(amendmentReplay.pack.rowVersion, 3);

  const second = await compileProductStrategyPack({
    productId,
    geoBlueprintId: "blueprint-2",
    sourceSnapshotId: `source-snapshot-${suffix}-2`,
    ruleVersion: "geo-blueprint-v2",
    contentPlan: contentPlan(2),
    actor: systemActor
  });
  packIds.push(second.pack.id);
  assert.equal(second.pack.status, "pending_strategy_review");

  view = await getProductGeoStrategyPackView(productId);
  assert.equal(view.latestStrategyPack?.id, second.pack.id);
  assert.equal(view.currentStrategyPack?.id, first.pack.id);

  const rejected = await decideProductGeoStrategyPack({
    productId,
    strategyPackId: second.pack.id,
    decision: "reject",
    expectedVersion: 1,
    idempotencyKey: `human-reject-${suffix}`,
    actor: { ...humanActor, auditReason: "集成测试：拒绝新策略并保留旧策略" }
  });
  assert.equal(rejected.status, "rejected");

  view = await getProductGeoStrategyPackView(productId);
  assert.equal(view.latestStrategyPack?.status, "rejected");
  assert.equal(view.currentStrategyPack?.id, first.pack.id);
});
