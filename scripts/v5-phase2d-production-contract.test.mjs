import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertSampleArticleFeedback } from "../src/lib/v5/sample-calibration-contracts";
import { createFormalModelContract, ensureRequiredCoreClaimEvidence, parseFormalProviderOutput, placeFixedExpressions, reconcileCoreClaimTraces, reconcileEvidenceFactTraces, removeSyntheticGovernanceSentences, removeUnsupportedFormalPassages, repairFormalOutputLocally } from "../src/lib/v5/formal-generation-service";
import {
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

test("simple duplicate sentences and prompt colons are repaired locally before fixed text placement", () => {
  const sentence = "这是一条足够长并且需要去重的正文判断句。";
  const repaired = repairFormalOutputLocally({
    markdown: `# 标题\n\n## 判断：先看条件\n${sentence}\n${sentence}\n实施建议：先完成权限确认。`,
    factTraces: []
  });
  assert.equal(repaired.markdown.split(sentence).length - 1, 1);
  assert.doesNotMatch(repaired.markdown, /[：:]/);
});

test("incomplete fact traces are removed before final fact validation", () => {
  const sentence = "WorkBuddy 支持任务执行";
  const repaired = removeUnsupportedFormalPassages({
    markdown: `# 标题\n\n${sentence}`,
    factTraces: [{ sentence, evidenceItemId: "e-1", claimId: "c-1", sourceRevisionId: "s-1" }]
  }, [{
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: sentence, normalizedClaim: sentence, summary: sentence, allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  }]);
  assert.equal(repaired.output.factTraces.length, 0);
  assert.doesNotMatch(repaired.output.markdown, /WorkBuddy 支持任务执行/);
});

test("natural product wording is deterministically associated with its core Claim", () => {
  const sentence = "WorkBuddy 可以通过可复用的 Skills 承接企业中的重复任务。";
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "WorkBuddy 支持通过可复用的 Skills 承接企业重复任务。",
    normalizedClaim: "WorkBuddy 支持通过可复用的 Skills 承接企业重复任务。",
    summary: "WorkBuddy 支持通过 Skills 执行重复任务。", allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const reconciled = reconcileCoreClaimTraces({ markdown: `# 标题\n\n${sentence}`, factTraces: [] }, [evidence], ["c-1"]);
  assert.deepEqual(reconciled.factTraces, [{ sentence, evidenceItemId: "e-1", claimId: "c-1", sourceRevisionId: "s-1" }]);
});

test("local wording repairs restore Claim traces for every evidence-backed product fact", () => {
  const sentence = "腾讯云提供 ADP 产品与云能力，JOTO 负责把平台能力接入企业知识、流程与系统。";
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "腾讯云提供 ADP 产品与云能力；JOTO 负责把平台能力接入企业知识、流程与系统。",
    normalizedClaim: "腾讯云提供 ADP 产品与云能力；JOTO 负责把平台能力接入企业知识、流程与系统。",
    summary: "腾讯云提供 ADP，JOTO 负责企业落地。", allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const reconciled = reconcileEvidenceFactTraces({ markdown: `# 标题\n\n${sentence}`, factTraces: [] }, [evidence]);
  assert.deepEqual(reconciled.factTraces, [{ sentence, evidenceItemId: "e-1", claimId: "c-1", sourceRevisionId: "s-1" }]);
});

test("inferred governance fields are never rendered as reader-facing conditions", () => {
  const synthetic = "企业管理人员需要完成岗位梳理、角色分工、专家配置、任务边界设计。这些前置工作决定了后续安排。";
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "WorkBuddy 支持企业任务执行。", normalizedClaim: "WorkBuddy 支持企业任务执行。",
    summary: "WorkBuddy 支持企业任务执行。", allowedUsage: [], forbiddenUsage: [], conditions: ["岗位梳理、角色分工、专家配置、任务边界设计"],
    limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const cleaned = removeSyntheticGovernanceSentences({ markdown: `# 标题\n\n正文。\n\n${synthetic}`, factTraces: [] }, [evidence]);
  assert.equal(cleaned.removedCount, 2);
  assert.doesNotMatch(cleaned.output.markdown, /岗位梳理|这些前置工作/);
});

test("missing core Claim is placed into existing prose without an audit-style fact section", () => {
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "把行业任务整理为可交付、可评测、可复制的企业场景包。",
    normalizedClaim: "把行业任务整理为可交付、可评测、可复制的企业场景包。",
    summary: "把行业任务整理为可交付、可评测、可复制的企业场景包。", allowedUsage: [], forbiddenUsage: [],
    conditions: ["内部治理条件"], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const completed = ensureRequiredCoreClaimEvidence({ markdown: "# 标题\n\nWorkBuddy 的价值要放到真实任务中理解。", factTraces: [] }, [evidence], ["c-1"]);
  assert.match(completed.markdown, /在实际落地中，需要把行业任务整理为可交付、可评测、可复制的企业场景包。/);
  assert.doesNotMatch(completed.markdown, /适用条件|内部治理条件|与当前问题直接相关的事实/);
  assert.equal(completed.factTraces[0].claimId, "c-1");
});

test("fixed expression remains exact and only applies to configured channels", () => {
  const fixed = "JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商，支持WorkBuddy专项服务。";
  const resolved = resolveJotoOfficialFixedExpression(
    fixed,
    ["wechat"],
    "csdn"
  );
  assert.equal(resolved.text, fixed);
  assert.equal(resolved.appliesToChannel, false);
});

test("JOTO official positioning replaces the identity clause and joins the service sentence", () => {
  const legacyPositioning = "JOTO 作为腾讯CSP授权合作伙伴";
  const markdown = placeFixedExpressions(
    "# 标题\n\nJOTO 团队可在约定项目范围内提供项目实施、交付培训与后续支持。开篇判断。\n\n## 正文\n内容。\n\n## 结尾\nJOTO 团队可在约定项目范围内提供后续支持。如需了解，可继续查看。",
    [{ text: legacyPositioning, positions: ["opening", "ending"], channel: "csdn" }]
  );
  assert.equal(markdown.split(legacyPositioning).length - 1, 2);
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
    validatorPolicy: {
      requiredCoreClaimIds: ["c-39"],
      entityIdentity: { productId: "p", canonicalName: "WorkBuddy", displayName: "WorkBuddy", aliases: [] }
    }
  };
  const view = createFormalModelContract(contract);
  assert.equal(view.evidencePack.evidenceItems.length, 8);
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

test("sample review only needs approval or one direct revision instruction", () => {
  assert.doesNotThrow(() => assertSampleArticleFeedback({ decision: "approved" }));
  assert.doesNotThrow(() => assertSampleArticleFeedback({ decision: "changes_requested", revisionInstruction: "开头从真实业务困境切入。" }));
  assert.throws(() => assertSampleArticleFeedback({ decision: "changes_requested" }), /sample_revision_instruction_required/);
  assert.throws(() => assertSampleArticleFeedback({ decision: "changes_requested", revisionInstruction: "修".repeat(1201) }), /sample_revision_instruction_too_long/);
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
  const multiSampleMigration = await readFile("database/migrations/20260816_033_v5_multi_sample_review.sql", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const applyRoute = await readFile("src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", "utf8");
  const ragRepository = await readFile("src/lib/v5/rag/rag-repository.ts", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS product_sample_article_task/);
  assert.match(migration, /UNIQUE KEY uq_product_sample_strategy/);
  assert.match(multiSampleMigration, /uq_product_sample_strategy_type \(product_strategy_pack_id, article_type_version_id\)/);
  assert.match(multiSampleMigration, /review_status/);
  assert.match(sampleService, /prepareAndGenerateSingleArticle/);
  assert.match(sampleService, /productionMode: "sample"/);
  assert.match(sampleService, /evidenceReadiness'\)\) = 'ready'/);
  assert.doesNotMatch(sampleService, /INSERT INTO monthly_plan/);
  assert.match(applyRoute, /decision === "approve"/);
  assert.match(applyRoute, /enqueueProductSampleArticles/);
  assert.doesNotMatch(applyRoute, /generateProductSampleArticle/);
  assert.match(ragRepository, /updated\.affectedRows \+ sampleUpdated\.affectedRows !== 1/);
  assert.equal(selectRepresentativeSampleQuestion({
    suitableQuestions: ["产品是什么？", "采用前需要确认哪些条件和边界？"]
  }, "WorkBuddy"), "WorkBuddy 采用前需要确认哪些条件和边界？");
  assert.match(sampleService, /哪些环节可由 AI 执行、哪些判断仍应由人负责/);
});

test("product sample requests enqueue durable work and recover orphaned operations", async () => {
  const migration = await readFile("database/migrations/20260814_031_v5_async_sample_generation.sql", "utf8");
  const repository = await readFile("src/lib/v5/single-article-production-repository.ts", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const sampleRoute = await readFile("src/app/api/v5/products/[productId]/sample-article/route.ts", "utf8");
  const applyRoute = await readFile("src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", "utf8");
  const worker = await readFile("workers/content-production-worker.mjs", "utf8");
  const listPage = await readFile("src/app/products/[productId]/samples/page.tsx", "utf8");

  assert.match(migration, /progress_stage/);
  assert.match(migration, /recovery_of_operation_id/);
  assert.match(repository, /queueSingleArticleOperation/);
  assert.match(repository, /recoverStaleProductSampleOperations/);
  assert.match(repository, /readQueuedProductSampleOperations/);
  assert.match(repository, /row\.recovery_of_operation_id/);
  assert.match(repository, /singleArticleRequestHash\(String\(row\.task_id\), currentTaskVersion\)/);
  assert.match(sampleService, /enqueueProductSampleArticles/);
  assert.match(sampleService, /for \(const strategy of strategyRows\)/);
  assert.match(sampleRoute, /status: 202/);
  assert.match(applyRoute, /enqueueProductSampleArticles/);
  assert.match(worker, /recoverStaleProductSampleOperations/);
  assert.match(worker, /productionMode: "sample"/);
  for (const stage of ["retrieving_evidence", "provider_preflight", "calling_provider", "local_repair", "quality_validation"]) {
    assert.match(listPage, new RegExp(stage));
  }
});

test("changes requested are injected into a new sample contract and approval freezes once", async () => {
  const compiler = await readFile("src/lib/v5/formal-production-contract-service.ts", "utf8");
  const repository = await readFile("src/lib/v5/sample-calibration-repository.ts", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const route = await readFile("src/app/api/v5/drafts/[id]/sample-review/route.ts", "utf8");
  const panel = await readFile("src/components/SampleArticleReviewPanel.tsx", "utf8");
  assert.match(compiler, /sample_revision_feedback/);
  assert.match(compiler, /sampleRevisionDirectives/);
  assert.match(compiler, /calibration_sample_markdown/);
  assert.match(repository, /sample_already_approved/);
  assert.match(repository, /remaining === 0 \? "production_ready" : "pending_sample_review"/);
  assert.match(repository, /latest_feedback_json/);
  assert.match(sampleService, /sample_revision_requires_fresh_evidence/);
  assert.match(sampleService, /final_evidence_pack_id = NULL/);
  assert.match(sampleService, /status = 'approved', row_version = row_version \+ 1/);
  assert.match(sampleService, /row_version = row_version \+ 1/);
  assert.match(sampleService, /用户本轮修改要求/);
  assert.match(route, /enqueueProductSampleRevision/);
  assert.match(panel, /按要求重新生成/);
  assert.doesNotMatch(panel, /InputNumber|五项均不低于 4 分|值得保留的表达/);
  assert.deepEqual(compileSampleRevisionDirectives({
    revisionInstruction: "先讲真实场景，删除无证据的效率数字"
  }), ["用户对上一版样文的修改要求：先讲真实场景，删除无证据的效率数字"]);
});
