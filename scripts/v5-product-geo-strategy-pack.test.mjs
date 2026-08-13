import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contracts = await import("../src/lib/v5/product-strategy-pack-contracts.ts");

function sampleProject() {
  return {
    projectId: "geo-project-1",
    productId: "product-1",
    status: "active",
    researchMarkets: ["CN"],
    languages: ["zh-CN"],
    targetChannels: ["wechat"],
    expressionFocus: "围绕真实用户场景解释产品价值和人工判断边界。",
    forbiddenFocus: ["不得编造客户案例"],
    rowVersion: 1,
    createdBy: "test",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z"
  };
}

function sampleBlueprint() {
  return {
    blueprintVersionId: "blueprint-1",
    projectId: "geo-project-1",
    runId: "run-1",
    versionNumber: 2,
    status: "pending_review",
    questionStrategy: {
      questionClusters: [{ id: "q1", title: "如何划分 AI 与人工边界", priority: "high", evidenceReadiness: "ready", questions: ["哪些环节必须人工确认？"] }]
    },
    competitorLandscape: { competitors: [] },
    citationStrategy: { policy: "official_first" },
    contentTypeStrategy: {
      articleTypes: [
        {
          id: "type-1", origin: "matched", articleTypeId: "system-template-scenario-solution", articleTypeVersionId: "system-template-scenario-solution-v1",
          name: "场景解决方案", definition: "从真实业务阻塞展开。", channels: ["wechat"], suitableQuestions: ["适合什么场景？"], unsuitableQuestions: ["纯技术排错"],
          structureModules: [{ key: "真实场景", purpose: "描述问题", required: true }], lengthRange: { min: 1500, max: 2300 }, evidenceReadiness: "ready", proposedMonthlyShare: 0.6
        },
        {
          id: "type-2", origin: "generated", name: "人机判断边界指南", definition: "解释 AI 自动执行与人工确认边界。", channels: ["wechat"],
          suitableQuestions: ["哪些环节需要人？"], unsuitableQuestions: ["纯品牌介绍"], structureModules: ["边界判断", "执行清单"], lengthRange: { min: 1600, max: 2400 }, evidenceReadiness: "ready", proposedMonthlyShare: 0.4
        }
      ]
    },
    evidenceRequirements: { requiredRoles: ["product_fact"], gaps: ["缺少公开案例"] },
    monthlyStrategyInput: { targetShare: 0.5 },
    retestBaseline: { questions: ["哪些环节必须人工确认？"] },
    researchSnapshotHash: "snapshot-hash",
    rowVersion: 1,
    createdBy: "test",
    createdAt: "2026-08-10T00:00:00.000Z"
  };
}

function sampleKnowledgeProfile() {
  const fact = (claimId, text) => ({ claimId, text, sourceId: "official-source", sourceRevisionId: "official-revision" });
  return {
    status: "ready",
    factCount: 4,
    positioning: [fact("positioning-1", "产品基于正式资料提供任务执行能力。")],
    audiences: [fact("audience-1", "面向企业业务和项目团队。")],
    capabilities: [fact("capability-1", "支持通过自然语言调度工具完成任务。")],
    scenarios: [fact("scenario-1", "适用于企业知识工作。")],
    boundaries: [fact("boundary-1", "采用前需要确认权限和数据边界。")]
  };
}

test("compiles the internal research synthesis into the user-facing strategy V2 contract", () => {
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(),
    blueprint: sampleBlueprint(),
    sourceSnapshotId: "source-snapshot-1",
    synthesisModel: "zhipu"
  });
  assert.equal(plan.contractVersion, "product-geo-strategy.v2");
  assert.equal(plan.sourceSnapshotId, "source-snapshot-1");
  assert.equal(plan.geoOpportunities[0].title, "如何划分 AI 与人工边界");
  assert.equal(plan.articleTypePortfolio[0].name, "场景解决方案");
  assert.equal(plan.articleTypePortfolio[0].origin, "matched");
  assert.equal(plan.articleTypePortfolio[1].origin, "generated");
  assert.equal(plan.articleTypePortfolio[1].structureModules[0].key, "边界判断");
  assert.equal(plan.articleTypePortfolio.length, 2);
  assert.deepEqual(plan.productPositioning.prohibitedClaims, ["不得编造客户案例"]);
  assert.equal(plan.productPositioning.promotionPurpose, plan.productPositioning.expressionFocus);
  assert.deepEqual(plan.productPositioning.positioning, []);
  assert.equal(plan.synthesis.blueprintVersionId, "blueprint-1");
});

test("maps the live blueprint field names without losing opportunities, evidence gaps, or expression direction", () => {
  const blueprint = sampleBlueprint();
  blueprint.questionStrategy = {
    priorityClusters: ["选型决策", "实施验收"],
    recommendedQuestions: ["企业如何判断是否适用？"]
  };
  blueprint.evidenceRequirements = {
    requiredClaims: ["产品能力需要正式资料支持"],
    sourceGaps: ["缺少公开实施案例"]
  };
  blueprint.monthlyStrategyInput = {
    objectives: ["回答真实选型问题", "解释实施边界"]
  };
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(), blueprint, sourceSnapshotId: "source-snapshot-1", synthesisModel: "zhipu"
  });
  assert.equal(plan.geoOpportunities.length, 2);
  assert.deepEqual(plan.geoOpportunities[0].representativeQuestions, ["企业如何判断是否适用？"]);
  assert.deepEqual(plan.evidencePolicy.knowledgeGaps, ["缺少公开实施案例"]);
  assert.deepEqual(plan.evidencePolicy.requiredRoles, ["product_fact", "public_source"]);
  assert.deepEqual(plan.expressionDirection.emphasisOrder, ["回答真实选型问题", "解释实施边界"]);
  assert.deepEqual(plan.expressionDirection.tone, ["客观", "具体", "证据优先"]);
});

test("strategy compilation removes weak competitor guesses and turns unsupported claims into blocked evidence work", () => {
  const blueprint = sampleBlueprint();
  blueprint.questionStrategy = {
    priorityClusters: ["功能价值", "企业选型", "竞品对比"],
    recommendedQuestions: [
      "产品能解决什么问题？",
      "企业如何评估是否适合？",
      "与其他方案相比有什么差异？"
    ]
  };
  blueprint.competitorLandscape = {
    competitors: [
      { name: "真实竞品", reason: "调研证据中被直接比较" },
      { name: "同名产品", reason: "名称相似，可能提供类似服务" }
    ]
  };
  blueprint.evidenceRequirements = {
    requiredClaims: ["产品比竞品更安全"],
    blockedClaims: ["未经授权的客户案例"],
    sourceGaps: ["缺少竞品正式资料"]
  };
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(), blueprint, sourceSnapshotId: "source-snapshot-1", synthesisModel: "zhipu"
  });
  const assignedQuestions = plan.geoOpportunities.flatMap((item) => item.representativeQuestions);
  assert.equal(assignedQuestions.length, new Set(assignedQuestions).size);
  assert.equal(plan.researchSynthesis.competitorLandscape.competitors.length, 1);
  assert.equal(plan.researchSynthesis.competitorLandscape.competitors[0].name, "真实竞品");
  assert.deepEqual(plan.evidencePolicy.evidenceRequirements.claimsRequiringEvidence, ["产品比竞品更安全"]);
  assert.deepEqual(plan.evidencePolicy.evidenceRequirements.blockedClaims, ["未经授权的客户案例", "产品比竞品更安全"]);
  assert.equal("requiredClaims" in plan.evidencePolicy.evidenceRequirements, false);
  assert.ok(plan.productPositioning.prohibitedClaims.includes("产品比竞品更安全"));
  assert.match(plan.evidencePolicy.citationStrategy.productClaimPolicy, /A1\/A2/);
});

test("only a human in an allowed role can make the product strategy decision", () => {
  assert.doesNotThrow(() => contracts.assertHumanProductStrategyDecision({ actorType: "human", actorRole: "product_owner" }));
  assert.throws(
    () => contracts.assertHumanProductStrategyDecision({ actorType: "system", actorRole: "product_automation" }),
    /human_strategy_approval_required/
  );
  assert.throws(
    () => contracts.assertHumanProductStrategyDecision({ actorType: "human", actorRole: "viewer" }),
    /product_strategy_role_forbidden/
  );
});

test("article type portfolio is bounded, versioned, and rejects invalid generated rules", () => {
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(), blueprint: sampleBlueprint(), sourceSnapshotId: "source-snapshot-1", synthesisModel: "zhipu"
  });
  assert.doesNotThrow(() => contracts.assertProductGeoStrategyContentPlanV2(plan));
  assert.throws(
    () => contracts.assertProductGeoStrategyContentPlanV2({ ...plan, articleTypePortfolio: [plan.articleTypePortfolio[0]] }),
    /product_strategy_article_type_portfolio_invalid/
  );
  assert.throws(
    () => contracts.assertProductGeoStrategyContentPlanV2({
      ...plan,
      articleTypePortfolio: plan.articleTypePortfolio.map((item, index) => index === 1 ? { ...item, structureModules: [] } : item)
    }),
    /product_strategy_article_type_structure_invalid/
  );
});

test("a pending pack can only become strategy-approved or rejected", () => {
  assert.equal(contracts.resolveProductStrategyDecisionStatus("pending_strategy_review", "approve"), "strategy_approved");
  assert.equal(contracts.resolveProductStrategyDecisionStatus("pending_strategy_review", "reject"), "rejected");
  assert.throws(() => contracts.resolveProductStrategyDecisionStatus("strategy_approved", "approve"), /product_strategy_not_reviewable/);
  assert.throws(() => contracts.resolveProductStrategyDecisionStatus("active", "reject"), /product_strategy_not_reviewable/);
});

test("approved strategy can deterministically derive monthly type quotas without a new planning cycle", () => {
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(), blueprint: sampleBlueprint(), sourceSnapshotId: "source-snapshot-1", synthesisModel: "zhipu"
  });
  const quotas = contracts.deriveProductStrategyMonthlyTypeQuotas(plan, 7);
  assert.equal(quotas.reduce((sum, item) => sum + item.count, 0), 7);
  assert.deepEqual(quotas.map((item) => item.count), [4, 3]);
  assert.ok(quotas.every((item) => item.articleTypeVersionId));
});

test("monthly production quotas exclude partial evidence article types", () => {
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(), blueprint: sampleBlueprint(), sourceSnapshotId: "source-snapshot-1", synthesisModel: "zhipu"
  });
  plan.articleTypePortfolio[1].evidenceReadiness = "partial";
  const quotas = contracts.deriveProductStrategyMonthlyTypeQuotas(plan, 5);
  assert.deepEqual(quotas.map((item) => item.portfolioItemId), [plan.articleTypePortfolio[0].portfolioItemId]);
  assert.equal(quotas[0].count, 5);
});

test("governed knowledge adds one safe sample type when research types all need more evidence", () => {
  const blueprint = sampleBlueprint();
  blueprint.evidenceRequirements = {
    requiredClaims: ["竞品差异仍需双边正式资料"],
    sourceGaps: ["缺少竞品正式资料"]
  };
  blueprint.contentTypeStrategy.articleTypes = blueprint.contentTypeStrategy.articleTypes.map((item, index) => ({
    ...item,
    name: index === 0 ? "选型与比较" : item.name,
    definition: index === 0 ? "比较产品与其他方案的差异。" : item.definition,
    evidenceReadiness: index === 0 ? "ready" : "partial"
  }));
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(),
    blueprint,
    sourceSnapshotId: "source-snapshot-1",
    synthesisModel: "zhipu",
    productKnowledgeProfile: sampleKnowledgeProfile()
  });
  const ready = plan.articleTypePortfolio.filter((item) => item.evidenceReadiness === "ready");
  assert.deepEqual(ready.map((item) => item.name), ["产品能力与适用边界"]);
  assert.equal(plan.articleTypePortfolio.find((item) => item.portfolioItemId === "type-1")?.evidenceReadiness, "partial");
  assert.equal(plan.articleTypePortfolio.reduce((sum, item) => sum + item.proposedMonthlyShare, 0), 1);
  assert.equal(plan.geoOpportunities[0].opportunityId, "产品能力与适用边界");
  assert.equal(plan.geoOpportunities[0].priority, "high");
  assert.equal(plan.geoOpportunities[0].evidenceReadiness, "ready");
  assert.ok(plan.geoOpportunities[0].representativeQuestions.some((question) => question.includes("哪些判断仍应由人负责")));
  assert.deepEqual(
    contracts.deriveProductStrategyMonthlyTypeQuotas(plan, 3).map((item) => item.portfolioItemId),
    ["governed-product-capability-boundary"]
  );
});

test("compilation cannot activate the pack and automatic research cannot approve the internal synthesis", async () => {
  const repositorySource = await readFile("src/lib/v5/product-strategy-pack-repository.ts", "utf8");
  const compileSection = repositorySource.slice(
    repositorySource.indexOf("export async function compileProductStrategyPack"),
    repositorySource.indexOf("export async function applyProductStrategyPack")
  );
  assert.match(compileSection, /pending_strategy_review/);
  assert.doesNotMatch(compileSection, /UPDATE product_entity SET strategy_pack_id/);

  const geoServiceSource = await readFile("src/lib/v5/geo-research-service.ts", "utf8");
  const blueprintApprovalSection = geoServiceSource.slice(
    geoServiceSource.indexOf("export async function approveGeoBlueprint"),
    geoServiceSource.indexOf("export async function runAutomaticGeoResearchOrchestration")
  );
  assert.doesNotMatch(blueprintApprovalSection, /approvalMode|system_policy/);
  assert.doesNotMatch(geoServiceSource, /auto-blueprint-policy/);

  const researchWorkspaceSource = await readFile("src/components/ProductGeoResearchWorkspace.tsx", "utf8");
  assert.doesNotMatch(researchWorkspaceSource, /批准蓝图|退回 GEO 蓝图|GEO 铺设蓝图/);
  assert.match(researchWorkspaceSource, /查看产品 GEO 策略/);
  const handoffSource = await readFile("src/components/geo/GeoMonthlyStrategyHandoff.tsx", "utf8");
  const railSource = await readFile("src/components/geo/GeoResearchRail.tsx", "utf8");
  assert.doesNotMatch(`${handoffSource}\n${railSource}`, /GEO 蓝图|蓝图草案|批准蓝图/);
  assert.match(handoffSource, /currentStrategyPack/);
});
