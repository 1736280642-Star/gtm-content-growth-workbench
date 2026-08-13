import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertSampleArticleFeedback } from "../src/lib/v5/sample-calibration-contracts";
import { createFormalModelContract, parseFormalProviderOutput, placeFixedExpressions } from "../src/lib/v5/formal-generation-service";
import {
  JOTO_OFFICIAL_POSITIONING,
  compileSampleRevisionDirectives,
  resolveJotoOfficialFixedExpression
} from "../src/lib/v5/formal-production-contract-service";
import { createProductSampleStableId, selectRepresentativeSampleQuestion } from "../src/lib/v5/product-sample-article-service";

test("sample stable IDs always fit governed varchar(64) identifiers", () => {
  for (const prefix of ["sample-prompt", "sample-prompt-v1", "sample-wechat-rule", "product-sample"]) {
    const id = createProductSampleStableId(prefix, { productId: "joto-workbuddy", version: "v1.0.0" });
    assert.ok(id.length <= 64, `${prefix} produced ${id.length} characters`);
    assert.ok(id.startsWith(`${prefix}-`));
  }
});

test("fixed expressions are placed deterministically instead of relying on the model", () => {
  const fixed = "JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商，支持WorkBuddy专项服务。";
  const markdown = placeFixedExpressions(`# 标题\n\n${fixed}\n\n## 正文\n内容。\n\n## 结尾\n总结。`, [{
    text: fixed,
    positions: ["opening", "ending"],
    channel: "wechat"
  }]);
  assert.equal(markdown.split(fixed).length - 1, 2);
  assert.ok(markdown.indexOf(fixed) < markdown.indexOf("\n## 正文"));
  assert.ok(markdown.lastIndexOf(fixed) > markdown.lastIndexOf("\n## 结尾"));
});

test("JOTO official positioning is canonical across every article channel", () => {
  const resolved = resolveJotoOfficialFixedExpression(
    "JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商，支持WorkBuddy专项服务。",
    ["wechat"],
    "csdn"
  );
  assert.equal(resolved.text, JOTO_OFFICIAL_POSITIONING);
  assert.equal(resolved.appliesToChannel, true);
});

test("JOTO official positioning replaces the identity clause and joins the service sentence", () => {
  const markdown = placeFixedExpressions(
    "# 标题\n\nJOTO 团队可在约定项目范围内提供项目实施、交付培训与后续支持。开篇判断。\n\n## 正文\n内容。\n\n## 结尾\nJOTO 团队可在约定项目范围内提供后续支持。如需了解，可继续查看。",
    [{ text: JOTO_OFFICIAL_POSITIONING, positions: ["opening", "ending"], channel: "csdn" }]
  );
  assert.equal(markdown.split(JOTO_OFFICIAL_POSITIONING).length - 1, 2);
  assert.match(markdown, /JOTO 作为腾讯CSP授权合作伙伴，可在约定项目范围内提供项目实施、交付培训与后续支持。开篇判断。/);
  assert.match(markdown, /JOTO 作为腾讯CSP授权合作伙伴，可在约定项目范围内提供后续支持。如需了解/);
  assert.doesNotMatch(markdown, /\n\nJOTO 作为腾讯CSP授权合作伙伴。?(?:\n\n|$)/);
});

test("formal model view keeps enough traceable and boundary evidence while bounding prompt size", () => {
  const evidenceItems = Array.from({ length: 40 }, (_, index) => ({
    evidenceItemId: `e-${index}`,
    claimIds: [`c-${index}`],
    primaryClaimId: `c-${index}`,
    sourceRevisionId: `s-${index}`,
    originalQuote: "原文".repeat(100),
    summary: `事实 ${index}。`,
    allowedUsage: index === 39 ? ["human_boundary"] : [],
    forbiddenUsage: [],
    conditions: index === 39 ? ["需要人工确认"] : [],
    limitations: [],
    lifecycleStatus: "current",
    visibility: "public",
    status: "active"
  }));
  const contract = {
    evidencePack: { evidenceItems, gaps: [], conflicts: [], outdatedEvidence: [], unverifiedClaims: [] },
    productRule: { allowedExpressions: [], conditionalExpressions: [], blockedExpressions: [] },
    allowedExpressions: [], conditionalExpressions: [], promptDirectives: [],
    validatorPolicy: { minTraceableFactCount: 8 }
  };
  const view = createFormalModelContract(contract);
  assert.equal(view.evidencePack.evidenceItems.length, 12);
  assert.equal(view.evidencePack.evidenceItems[0].evidenceItemId, "e-39");
  assert.equal("originalQuote" in view.evidencePack.evidenceItems[0], false);
});

test("provider audit fields are stripped from reader-facing production output", () => {
  const output = parseFormalProviderOutput(JSON.stringify({
    markdown: "# 标题\n\n## 正文\nWorkBuddy 需要保留人工判断边界。",
    factTraces: [{
      sentence: "WorkBuddy 需要保留人工判断边界。",
      evidenceItemId: "evidence-1",
      claimId: "claim-1",
      sourceRevisionId: "source-1",
      originalQuote: "内部原始摘录",
      sourceLocator: { headingPath: ["内部"] }
    }]
  }));
  assert.equal(output.factTraces.length, 1);
  assert.equal("originalQuote" in output.factTraces[0], false);
  assert.equal("sourceLocator" in output.factTraces[0], false);
  assert.doesNotMatch(output.markdown, /内部原始摘录/);
});

test("sample approval requires adequate ratings and blocks unresolved domain issues", () => {
  const base = {
    decision: "approved",
    ratings: { scenarioAuthenticity: 4, boundaryClarity: 5, factualReliability: 5, readability: 4, productFit: 4 },
    strengths: ["边界清楚"],
    issues: [],
    expressionDirectives: ["先讲真实场景，再说明产品能力"],
    reason: "内容质量达到批量校准基线"
  };
  assert.doesNotThrow(() => assertSampleArticleFeedback(base));
  assert.throws(() => assertSampleArticleFeedback({ ...base, ratings: { ...base.ratings, readability: 3 } }), /sample_approval_rating_too_low/);
  const { productFit: _missing, ...incompleteRatings } = base.ratings;
  assert.throws(() => assertSampleArticleFeedback({ ...base, ratings: incompleteRatings }), /sample_ratings_incomplete/);
  assert.throws(() => assertSampleArticleFeedback({ ...base, issues: [{ category: "fact", segment: "第二节", instruction: "事实需核对" }] }), /sample_approval_has_domain_issue/);
});

test("phase 2D schema freezes contracts, feedback and expression calibration", async () => {
  const migration = await readFile("database/migrations/20260810_023_v5_production_contract_and_sample_calibration.sql", "utf8");
  const service = await readFile("src/lib/v5/single-article-production-service.ts", "utf8");
  const compilerService = await readFile("src/lib/v5/formal-production-contract-service.ts", "utf8");
  const generation = await readFile("src/lib/v5/formal-generation-service.ts", "utf8");
  for (const table of ["production_contract_snapshot", "sample_article_feedback", "expression_calibration_version"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(service, /compileFormalProductionContract/);
  assert.match(service, /persistProductionContractSnapshot/);
  assert.match(service, /mode: input\.productionMode \|\| "sample"/);
  assert.match(service, /V5_SAMPLE_ARTICLE_PROVIDER \|\| "qwen"/);
  assert.match(compilerService, /input\.mode === "batch" && String\(row\.strategy_status\) !== "production_ready"/);
  assert.match(compilerService, /input\.mode === "batch" && !row\.calibration_version_id/);
  assert.match(compilerService, /\[taskId, taskId, taskId\]/);
  assert.match(generation, /JSON\.stringify\(modelContract\)/);
  assert.match(generation, /repairRound <= 1/);
  assert.doesNotMatch(generation, /markdown\.includes\(item\.originalQuote\)/);
});

test("product sample is generated through the formal contract without creating a monthly plan", async () => {
  const migration = await readFile("database/migrations/20260812_025_v5_product_sample_article.sql", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const applyRoute = await readFile("src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", "utf8");
  const ragRepository = await readFile("src/lib/v5/rag/rag-repository.ts", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS product_sample_article_task/);
  assert.match(migration, /UNIQUE KEY uq_product_sample_strategy/);
  assert.match(sampleService, /prepareAndGenerateSingleArticle/);
  assert.match(sampleService, /productionMode: "sample"/);
  assert.match(sampleService, /evidenceReadiness'\)\) = 'ready'/);
  assert.doesNotMatch(sampleService, /INSERT INTO monthly_plan/);
  assert.match(applyRoute, /decision === "approve"/);
  assert.match(applyRoute, /generateProductSampleArticle/);
  assert.match(ragRepository, /updated\.affectedRows \+ sampleUpdated\.affectedRows !== 1/);
  assert.equal(selectRepresentativeSampleQuestion({
    suitableQuestions: ["产品是什么？", "采用前需要确认哪些条件和边界？"]
  }, "WorkBuddy"), "WorkBuddy 采用前需要确认哪些条件和边界？");
  assert.match(sampleService, /哪些环节可由 AI 执行、哪些判断仍应由人负责/);
});

test("changes requested are injected into a new sample contract and approval freezes once", async () => {
  const compiler = await readFile("src/lib/v5/formal-production-contract-service.ts", "utf8");
  const repository = await readFile("src/lib/v5/sample-calibration-repository.ts", "utf8");
  const route = await readFile("src/app/api/v5/drafts/[id]/sample-review/route.ts", "utf8");
  const panel = await readFile("src/components/SampleArticleReviewPanel.tsx", "utf8");
  assert.match(compiler, /sample_revision_feedback/);
  assert.match(compiler, /sampleRevisionDirectives/);
  assert.match(repository, /sample_already_approved/);
  assert.match(repository, /strategyUpdated\.affectedRows !== 1/);
  assert.match(repository, /latest_feedback_json/);
  assert.match(route, /sample-revision:\$\{data\.feedbackId\}/);
  assert.match(panel, /提交并生成修订稿/);
  assert.match(panel, /五项均不低于 4 分/);
  assert.deepEqual(compileSampleRevisionDirectives({
    expressionDirectives: ["先讲真实场景", "先讲真实场景"],
    issues: [{ category: "fact", segment: "第二节", instruction: "删除无证据的效率数字" }]
  }), ["先讲真实场景", "修订位置：第二节；要求：删除无证据的效率数字"]);
});
