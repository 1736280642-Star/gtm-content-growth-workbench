import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";

const scratch = path.resolve(process.cwd(), ".tmp", `v5-free-production-${process.pid}`);
await mkdir(scratch, { recursive: true });
process.env.WORKBENCH_STATE_PATH = path.join(scratch, "workbench-state.json");
process.env.V5_FREE_CONTENT_TYPE_STATE_PATH = path.join(scratch, "expression-types.json");
process.env.V5_FREE_PRODUCTION_STATE_PATH = path.join(scratch, "production.json");
process.env.V5_MONTHLY_STATE_PATH = path.join(scratch, "monthly.json");

const contracts = await import("../src/lib/v5/free-production-contracts.ts");
const compiler = await import("../src/lib/v5/free-production-compiler.ts");
const expressionPlan = await import("../src/lib/v5/free-production-expression-plan.ts");
const validator = await import("../src/lib/v5/free-production-output-validator.ts");
const expressionRepository = await import("../src/lib/v5/free-content-expression-type-repository.ts");
const expressionService = await import("../src/lib/v5/free-content-expression-type-service.ts");
const productionService = await import("../src/lib/v5/free-production-service.ts");
const productionRepository = await import("../src/lib/v5/free-production-repository.ts");
const jotoWechatLayout = await import("../src/lib/v5/joto-wechat-layout-renderer.ts");
const wechatValidator = await import("../src/lib/v5/wechat-layout-validator.ts");

after(async () => {
  if (!scratch.startsWith(path.resolve(process.cwd(), ".tmp") + path.sep)) throw new Error("Refusing to remove an unexpected test path.");
  await rm(scratch, { recursive: true, force: true });
});

test("five system presets are active, versioned, and isolated from GEO inputs", async () => {
  const state = await expressionRepository.readFreeContentExpressionTypeState();
  const versions = Object.values(state.versions);
  assert.deepEqual(versions.map((item) => item.presetKey).sort(), [...contracts.FREE_EXPRESSION_PRESET_KEYS].sort());
  assert.equal(versions.length, 5);
  for (const version of versions) {
    assert.equal(version.systemManaged, true);
    assert.equal(version.status, "active");
    assert.equal(version.publishPolicy, "automatic_after_confirmation");
    assert.equal(version.outputContractVersion, "content-draft-artifact.v1");
    assert.equal(version.productId, "");
    assert.deepEqual(version.knowledgeSnapshotIds, []);
    const serialized = JSON.stringify(version);
    for (const obsolete of ["goalQuestionVersionId", "distilledTerm", "questionIntent", "geoQuota"]) assert.equal(serialized.includes(obsolete), false);
  }
  assert.equal(versions.find((item) => item.presetKey === "strategic_partnership")?.sourceMode, "facts");
  assert.equal(versions.find((item) => item.presetKey === "event_recap")?.sourceMode, "facts_with_meeting_text");
  assert.equal(versions.find((item) => item.presetKey === "industry_insight")?.sourceMode, "knowledge");
});

test("workspace type inherits a system structure without binding a product", async () => {
  const state = await expressionRepository.readFreeContentExpressionTypeState();
  const base = Object.values(state.versions).find((item) => item.presetKey === "scenario_solution");
  assert.ok(base);
  const payload = {
    expectedVersion: 0,
    auditReason: "验收新类型继承和幂等行为",
    input: {
      name: "客服落地复盘",
      baseTypeId: base.typeId,
      sourceMode: "facts",
      description: "面向一线使用者复盘客服工作流变化",
      visualSuggestionMode: "placeholders"
    }
  };
  const first = await expressionService.createFreeContentExpressionType(payload, "test-expression-idempotency");
  const replay = await expressionService.createFreeContentExpressionType(payload, "test-expression-idempotency");
  assert.equal(replay.typeId, first.typeId);
  assert.deepEqual(replay.activeVersion.structureModules, base.structureModules);
  assert.equal(replay.activeVersion.systemManaged, false);
  assert.equal(replay.activeVersion.sourceMode, "facts");
  assert.equal(replay.activeVersion.productId, "");
  assert.deepEqual(replay.activeVersion.knowledgeSnapshotIds, []);
  await assert.rejects(
    expressionService.createFreeContentExpressionType({ ...payload, input: { ...payload.input, name: "复用键冲突" } }, "test-expression-idempotency"),
    (error) => error?.code === "IDEMPOTENCY_KEY_REUSED"
  );
});

test("free production UI uses typed inputs and a compact source snapshot rail", async () => {
  const [pageSource, inputSource, sourcePanelSource, resultSource, presetListSource, settingsDrawerSource] = await Promise.all([
    readFile(new URL("../src/app/free-production/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/ProductionInputPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/CitationSourcePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/GenerationResultWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/ExpressionPresetList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/ExpressionSettingsDrawer.tsx", import.meta.url), "utf8")
  ]);
  assert.match(pageSource, /新建类型/);
  assert.match(pageSource, /ProductionInputPanel/);
  assert.match(inputSource, /只粘贴纯文本或 Markdown，不上传文件/);
  assert.doesNotMatch(inputSource, /<Upload/);
  assert.doesNotMatch(inputSource, /上线状态|launchStatus/);
  assert.match(sourcePanelSource, /source\.excerpt/);
  assert.match(sourcePanelSource, /sourceMeta\[source\.sourceType\]/);
  assert.match(resultSource, /CitationSourcePanel/);
  assert.doesNotMatch(resultSource, /ContentQualitySummary/);
  assert.match(presetListSource, /查看设置/);
  assert.match(settingsDrawerSource, /用途/);
  assert.match(settingsDrawerSource, /生产规则/);
  assert.match(settingsDrawerSource, /正文结构/);
  assert.match(settingsDrawerSource, /发布设置/);
});

test("knowledge, human facts, and meeting text become traceable source snapshots", () => {
  const sources = productionService.buildFreeProductionSourceExcerpts({
    knowledge: [{ sourceSnapshotId: "kb-product:v2", sourceSnapshotHash: "hash-v2", evidence: [{ evidenceExcerpt: "产品原始资料片段" }] }],
    factItems: [{ time: "2026-07-30", location: "东京", people: "项目团队", event: "完成阶段验收", publicConfirmed: true }],
    meetingText: "# 会议判断\n\n客户确认下一阶段先验证核心场景。"
  });
  assert.deepEqual(sources.map((item) => item.sourceType), ["knowledge", "human_fact", "meeting_text", "meeting_text"]);
  assert.equal(sources[0].excerpt, "产品原始资料片段");
  assert.match(sources[1].excerpt, /完成阶段验收/);
  assert.match(sources[3].excerpt, /核心场景/);
});

test("replaying a production request returns the existing batch without generating again", async () => {
  const expressionState = await expressionRepository.readFreeContentExpressionTypeState();
  const expression = Object.values(expressionState.versions).find((item) => item.presetKey === "product_release" && item.systemManaged);
  assert.ok(expression);
  const request = { expectedVersion: 0, auditReason: "验收生产任务幂等回放", expressionTypeVersionId: expression.freeContentExpressionTypeVersionId };
  const key = "test-production-idempotency";
  const batch = { id: "free-batch-idempotency", status: "published", version: 4 };
  await productionRepository.updateFreeProductionState((state) => {
    state.batches[batch.id] = batch;
    state.idempotency[key] = { requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"), response: batch, createdAt: new Date().toISOString() };
  });
  const replay = await productionService.createFreeProductionFromExpression(request, key);
  assert.equal(replay.id, batch.id);
  assert.equal(replay.status, "published");
  const state = await productionRepository.readFreeProductionState();
  assert.equal(Object.keys(state.batches).length, 1);
});

test("expression plan preserves the preset structure and exposes only missing business facts", async () => {
  const state = await expressionRepository.readFreeContentExpressionTypeState();
  const expression = Object.values(state.versions).find((item) => item.presetKey === "product_release");
  assert.ok(expression);
  const plan = expressionPlan.compileExpressionPlan({ batchId: "batch-test", expression, knowledgeSnapshots: [{ name: "ADP 服务知识" }], supplementalFacts: { launch_status: "pilot" } });
  assert.deepEqual(plan.outline.map((item) => item.sectionKey), expression.structureModules);
  assert.equal(plan.missingClaims.includes("launch_status"), false);
  assert.equal(plan.missingClaims.includes("cta_url"), true);
  assert.equal("goalQuestionVersionId" in plan, false);
});

test("industry insight blocks product mentions before the first 20 percent", async () => {
  const state = await expressionRepository.readFreeContentExpressionTypeState();
  const expression = Object.values(state.versions).find((item) => item.presetKey === "industry_insight");
  assert.ok(expression);
  const sections = expression.structureModules.map((sectionKey, index) => ({
    sectionKey,
    heading: `章节 ${index + 1}`,
    markdown: index === 0 ? `JOTO 腾讯云 ADP 实施服务${"行业工作流正在发生变化。".repeat(25)}` : "企业需要先识别真实任务，再决定如何引入 AI。"
  }));
  const result = validator.validateFreeProductionOutput({ expression, productName: "JOTO 腾讯云 ADP 实施服务", titleCandidates: ["标题一", "标题二", "标题三"], summary: "行业判断摘要", sections });
  assert.equal(result.repairableIssues.some((item) => item.includes("前 20%")), true);
});

test("local regeneration changes only affected sections", () => {
  const current = [
    { sectionKey: "scene", heading: "现场", markdown: "原始现场" },
    { sectionKey: "evidence", heading: "证据", markdown: "原始证据" },
    { sectionKey: "cta", heading: "行动", markdown: "原始行动" }
  ];
  const merged = compiler.mergeRegeneratedSections(current, [{ sectionKey: "evidence", heading: "证据", markdown: "补充后的证据" }, { sectionKey: "scene", heading: "现场", markdown: "不应覆盖" }], ["evidence"]);
  assert.equal(merged[0], current[0]);
  assert.equal(merged[1].markdown, "补充后的证据");
  assert.equal(merged[2], current[2]);
});

test("publish payload removes preview annotations and digest remains stable", () => {
  const articleBody = "# 标题\n\n正文\n\n> 配图建议：工作流对比\n\n[[INTERNAL:check]]\n\n<!-- visual-suggestion: cover -->";
  const artifact = { articleBody };
  const result = validator.assertPublishPayloadSanitized(artifact);
  assert.equal(result.passed, true);
  assert.equal(result.markdown.includes("配图建议"), false);
  assert.equal(result.markdown.includes("INTERNAL"), false);
  assert.equal(compiler.contentDigest(result.markdown), compiler.contentDigest(result.markdown));
});

test("JOTO 官方预览和正式 HTML 使用同一渲染器且正式产物不含配图批注", () => {
  const sections = [{ sectionKey: "workflow", heading: "工作流变化", markdown: "AI 承担重复工作，人保留最终判断。" }];
  const visualSuggestions = [{
    id: "visual-test",
    placementAnchor: "workflow",
    assetType: "workflow_comparison",
    recommendation: "展示前后流程对比",
    captionSuggestion: "工作流变化示意",
    purpose: "解释变化",
    optional: true
  }];
  const previewBody = jotoWechatLayout.renderJotoOfficialWechatBody({ sections, visualSuggestions, includeVisualPlaceholders: true });
  const publishHtml = jotoWechatLayout.renderJotoOfficialWechatBody({ sections, visualSuggestions, includeVisualPlaceholders: false });
  const previewHtml = jotoWechatLayout.renderJotoOfficialWechatPreviewDocument({ title: "正式排版", bodyHtml: previewBody });

  assert.match(previewHtml, /data-wechat-layout="joto-official-v1"/);
  assert.match(previewHtml, /配图建议/);
  assert.doesNotMatch(publishHtml, /data-preview-only|visual-suggestion|配图建议/);
  assert.equal(wechatValidator.validateWechatHtml(publishHtml).passed, true);
});

test("自由内容公众号产物契约和发布服务固定使用正式 wechat_html", async () => {
  const [contractSource, serviceSource, previewSource] = await Promise.all([
    readFile(new URL("../src/lib/v5/free-production-contracts.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/free-production-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/WechatArticlePreview.tsx", import.meta.url), "utf8")
  ]);

  assert.match(contractSource, /wechatPresentation\?:/);
  assert.match(contractSource, /templateId:\s*"joto-official-v1"/);
  assert.match(serviceSource, /contentFormat:\s*isWechat\s*\?\s*"wechat_html"\s*:\s*"markdown"/);
  assert.match(serviceSource, /renderJotoOfficialWechatPreviewDocument/);
  assert.match(serviceSource, /process\.env\.CONTENT_GENERATION_PROVIDER/);
  assert.match(serviceSource, /callAiProvider\(\{ provider,/);
  assert.match(previewSource, /artifact\.wechatPresentation\.previewHtml/);
  assert.equal((previewSource.match(/ConfirmAutoPublishButton/g) || []).length, 0);
});

test("automatic repair is capped at one attempt", () => {
  assert.equal(productionService.MAXIMUM_FREE_PRODUCTION_REPAIR_COUNT, 1);
});
