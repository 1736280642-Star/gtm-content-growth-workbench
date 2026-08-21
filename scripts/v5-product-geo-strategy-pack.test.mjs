import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contracts = await import("../src/lib/v5/product-strategy-pack-contracts.ts");
const promotionEvidence = await import("../src/lib/v5/promotion-evidence-policy.ts");

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
    governanceBinding: {
      sourceSnapshotId: "source-snapshot-1",
      rulePackageVersionId: "rule-version-1",
      indexSnapshotId: "index-snapshot-1",
      researchRunId: "run-1"
    },
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
          structureModules: [{ key: "真实场景", purpose: "描述问题", required: true }], lengthRange: { min: 1500, max: 2300 },
          knowledgeSupportSummary: "知识库支持场景、能力与边界表述。", knowledgeClaimIds: ["capability-1", "boundary-1"],
          geoOpportunitySummary: "用户正在询问适用场景。", existingTypeComparison: "现有场景解决方案可直接承载，不需要新建类型。",
          expectedMentionRationale: "直接回答场景问题有助于 AI 在选型回答中引用。", retestProbeRefs: ["q1"],
          evidenceReadiness: "ready", proposedMonthlyShare: 0.6
        },
        {
          id: "type-2", origin: "generated", name: "人机判断边界指南", definition: "解释 AI 自动执行与人工确认边界。", channels: ["wechat"],
          suitableQuestions: ["哪些环节需要人？"], unsuitableQuestions: ["纯品牌介绍"], structureModules: ["边界判断", "执行清单"], lengthRange: { min: 1600, max: 2400 },
          knowledgeSupportSummary: "知识库支持人机协作边界。", knowledgeClaimIds: ["boundary-1"],
          geoOpportunitySummary: "调研发现用户缺少边界判断依据。", existingTypeComparison: "现有类型不能完整承载判断清单，因此新建结构。",
          expectedMentionRationale: "结构化边界清单可提高答案引用稳定性。", retestProbeRefs: ["q1"],
          evidenceReadiness: "ready", proposedMonthlyShare: 0.4
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
  assert.deepEqual(plan.articleTypePortfolio[0].knowledgeClaimIds, ["capability-1", "boundary-1"]);
  assert.match(plan.articleTypePortfolio[0].existingTypeComparison, /直接承载/);
  assert.deepEqual(plan.articleTypePortfolio[0].retestProbeRefs, ["q1"]);
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

test("a governed JOTO service-provider relationship always yields a provider-selection opportunity and article type", () => {
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(),
    blueprint: sampleBlueprint(),
    sourceSnapshotId: "source-snapshot-1",
    synthesisModel: "zhipu",
    productName: "WorkBuddy",
    entityRelationship: "WorkBuddy 是腾讯旗下产品；JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商，支持WorkBuddy专项服务。",
    productKnowledgeProfile: sampleKnowledgeProfile()
  });
  const opportunity = plan.geoOpportunities.find((item) => item.intent === "service_provider_selection");
  const articleType = plan.articleTypePortfolio.find((item) => item.portfolioItemId === "service-provider-selection");
  assert.ok(opportunity);
  assert.equal(opportunity.evidenceReadiness, "ready");
  assert.match(opportunity.title, /WorkBuddy 服务商选型/);
  assert.ok(articleType);
  assert.equal(articleType.evidenceReadiness, "ready");
  assert.match(articleType.name, /WorkBuddy 服务商选型与实施伙伴推荐/);
  assert.match(articleType.definition, /公开核验.*服务能力.*适用场景.*角色边界/);
  assert.doesNotMatch(articleType.definition, /交付范围.*验收/);
  assert.match(articleType.unsuitableQuestions.join(" "), /客户 Logo.*已验证成功案例/);
  assert.doesNotThrow(() => contracts.assertProductGeoStrategyContentPlanV2(plan));
});

test("existing website coverage does not remove the governed provider-selection article type", () => {
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(),
    blueprint: sampleBlueprint(),
    sourceSnapshotId: "source-snapshot-1",
    synthesisModel: "zhipu",
    productName: "腾讯云 ADP",
    entityRelationship: "腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商；JOTO 可提供腾讯云 ADP 项目实施、交付培训与后续支持。",
    productKnowledgeProfile: sampleKnowledgeProfile(),
    websiteCoverageProfile: {
      id: "coverage-1",
      productId: "product-1",
      profileVersion: 1,
      knowledgeReadiness: "ready",
      publicGeoReadiness: "ready",
      officialSources: [],
      topicCoverage: [{
        topic: "provider_selection",
        label: "服务商选型",
        status: "sufficient",
        pageUrls: ["https://example.com/provider"],
        sourceIds: ["source-1"],
        claimIds: ["claim-1"],
        evidenceRequired: false,
        reason: "已有官网页面"
      }],
      criticalFindingCodes: [],
      evidenceGaps: [],
      profileHash: "coverage-hash-1",
      generatedAt: "2026-08-17T00:00:00.000Z"
    }
  });
  const articleType = plan.articleTypePortfolio.find((item) => item.portfolioItemId === "service-provider-selection");
  assert.ok(articleType);
  assert.equal(articleType.evidenceReadiness, "ready");
  assert.equal(articleType.websiteCoverageDisposition, "refresh_existing");
});

test("a semantic provider guide is normalized into the governed provider-selection type", () => {
  const blueprint = sampleBlueprint();
  blueprint.contentTypeStrategy.articleTypes[0] = {
    ...blueprint.contentTypeStrategy.articleTypes[0],
    id: "provider-guide",
    origin: "generated",
    name: "服务商实施指南",
    definition: "说明企业如何完成服务商选型和项目实施。",
    evidenceReadiness: "partial"
  };
  const plan = contracts.compileProductGeoStrategyContentPlan({
    project: sampleProject(),
    blueprint,
    sourceSnapshotId: "source-snapshot-1",
    synthesisModel: "zhipu",
    productName: "腾讯云 ADP",
    entityRelationship: "腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商；JOTO 可提供腾讯云 ADP 项目实施、交付培训与后续支持。",
    productKnowledgeProfile: sampleKnowledgeProfile()
  });
  const providerTypes = plan.articleTypePortfolio.filter((item) => item.portfolioItemId === "service-provider-selection");
  assert.equal(providerTypes.length, 1);
  assert.equal(providerTypes[0].name, "腾讯云 ADP 服务商选型与实施伙伴推荐");
  assert.equal(providerTypes[0].evidenceReadiness, "ready");
  assert.match(providerTypes[0].contentGoal, /JOTO.*实施服务提供方/);
  assert.match(JSON.stringify(providerTypes[0]), /对外服务范围|角色边界|合作阶段/);
  assert.doesNotMatch(JSON.stringify(providerTypes[0]), /配置操作文档|交付范围与验收|验收清单/);
});

test("promotion evidence suggestions exclude internal delivery artifacts", () => {
  const shared = {
    definition: "面向客户解释产品与服务。",
    suitableQuestions: [],
    evidencePreferences: ["正式部署前提与环境要求", "系统集成及配置操作文档", "交付范围与验收清单"]
  };
  const items = [
    { ...shared, name: "行业场景解决方案", contentGoal: "把业务问题映射为可执行方案" },
    { ...shared, name: "服务商实施指南", contentGoal: "清晰说明服务范围和实施能力" },
    { ...shared, name: "实施指南", contentGoal: "帮助客户理解采用路径与实施边界" }
  ];

  for (const item of items) {
    const suggestions = promotionEvidence.promotionEvidenceSuggestions(item);
    assert.ok(suggestions.length >= 2);
    assert.doesNotMatch(suggestions.join("；"), /部署前提|环境要求|配置操作|交付范围|验收清单/);
  }
  assert.match(promotionEvidence.promotionEvidenceSuggestions(items[0]).join("；"), /业务问题|产品能力/);
  assert.match(promotionEvidence.promotionEvidenceSuggestions(items[1]).join("；"), /对外公布的服务范围|职责边界/);
  assert.match(promotionEvidence.promotionEvidenceSuggestions(items[2]).join("；"), /公开的产品能力|实施阶段/);
});

test("website topics without governed evidence stay on hold and never enter the monthly mix", () => {
  const profile = {
    id: "coverage-hold", productId: "product-1", profileVersion: 1, knowledgeReadiness: "partial", publicGeoReadiness: "ready",
    officialSources: [], criticalFindingCodes: [], evidenceGaps: [], profileHash: "coverage-hold-hash", generatedAt: "2026-08-17T00:00:00.000Z",
    topicCoverage: [{ topic: "case_practice", label: "案例或实践证据", status: "missing", pageUrls: [], sourceIds: [], claimIds: [], evidenceRequired: true, reason: "缺少 Claim" }]
  };
  const item = {
    portfolioItemId: "case", origin: "generated", articleTypeId: "case-type", articleTypeVersionId: "case-version",
    name: "客户案例与项目实践", definition: "基于客户案例说明结果", suitableQuestions: [], unsuitableQuestions: [], targetAudience: ["企业用户"],
    contentGoal: "说明实践结果", structureModules: [{ key: "answer", purpose: "回答问题", required: true }], emphasisOrder: ["answer"], style: ["客观"],
    lengthRange: { min: 1200, max: 1800 }, evidencePreferences: ["真实案例 Claim"], ctaIntent: "了解详情", channelFit: ["official_website"],
    questionClusterIds: ["case"], recommendationReason: "案例问题", confidence: 0.8, evidenceReadiness: "ready", proposedMonthlyShare: 1, definitionHash: "case-hash", raw: {}
  };
  const normalized = contracts.applyWebsiteCoverageToArticlePortfolio([item], profile);
  assert.equal(normalized[0].websiteCoverageDisposition, "hold");
  assert.deepEqual(contracts.deriveProductStrategyMonthlyTypeQuotas({ articleTypePortfolio: normalized }, 3), []);
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

test("price, case, competitor, and ROI types cannot remain ready without knowledge claim traceability", () => {
  for (const name of ["产品价格说明", "客户案例", "竞品对比", "ROI 投资回报分析"]) {
    const blueprint = sampleBlueprint();
    blueprint.contentTypeStrategy.articleTypes[0] = {
      ...blueprint.contentTypeStrategy.articleTypes[0],
      name,
      knowledgeClaimIds: [],
      evidenceReadiness: "ready"
    };
    const plan = contracts.compileProductGeoStrategyContentPlan({
      project: sampleProject(), blueprint, sourceSnapshotId: "source-snapshot-1", synthesisModel: "zhipu"
    });
    assert.equal(plan.articleTypePortfolio.find((item) => item.portfolioItemId === "type-1")?.evidenceReadiness, "partial");
  }
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
