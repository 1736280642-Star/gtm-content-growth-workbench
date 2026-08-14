import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseAihotV1Items } from "../src/lib/v5/aihot-trend-service.ts";
import { buildHotspotIntegrationPrompt, buildHotspotRepairPrompt, collectHotspotRegressionIssues, parseHotspotModelOutput, validateHotspotModelOutput } from "../src/lib/v5/hotspot-integration.ts";

const expression = {
  freeContentExpressionTypeVersionId: "type-v1",
  typeId: "type",
  version: 1,
  presetKey: "industry_insight",
  name: "行业洞察",
  description: "结合行业变化形成判断",
  scenario: "行业变化",
  contentGoal: "形成可信判断",
  defaultAudience: "企业决策者",
  sourceMode: "knowledge",
  productId: "product-1",
  productRuleResolutionPolicy: "active_product_rule",
  knowledgeSelectionPolicy: "selected_product_snapshots",
  knowledgeSnapshotIds: ["source-1"],
  applicableChannels: ["wechat_official_account"],
  channelBinding: { channel: "wechat_official_account", channelRuleVersionId: "wechat-v1", ctaType: "learn_more", requiredPublishAssetKeys: [] },
  publishPolicy: "automatic_after_confirmation",
  visualSuggestionMode: "off",
  structureModules: ["opening", "industry_judgement", "human_ai_boundary"],
  optionalStructureModules: [],
  requiredInputSchema: [],
  recommendedLength: { min: 600, max: 1600 },
  allowedTitleStrategyKeys: ["industry_question"],
  defaultTitleStrategyKey: "industry_question",
  audienceLensPolicy: "executive",
  expressionConfig: {},
  promotionConfig: {},
  evidenceRequirements: {},
  qualityGateConfig: { requireHumanAiBoundary: true, maximumRepairCount: 1 },
  outputContractVersion: "content-draft-artifact.v1",
  sourceRuleDocumentId: "rule",
  sourceRuleVersion: "1",
  sourceRuleDigest: "digest",
  systemManaged: true,
  defaultExpressionFocus: [],
  positiveExamples: [],
  negativeExamples: [],
  additionalWritingRequirements: "先判断，再连接真实工作流",
  status: "active",
  snapshotHash: "hash",
  createdBy: "test",
  createdAt: "2026-08-14T00:00:00.000Z"
};

const artifact = {
  id: "artifact-1",
  selectedTitle: "AI 进入工作流之后，管理者真正要判断什么",
  summary: "从行业变化回到真实工作流。",
  sections: expression.structureModules.map((sectionKey) => ({ sectionKey, heading: sectionKey, markdown: `${sectionKey} 正文` }))
};

const candidate = {
  id: "trend-1",
  title: "智能体开始承担日常维护任务",
  summary: "团队把重复维护工作交给智能体，并保留人工审核。",
  category: "tip",
  sourceName: "官方来源",
  originalUrl: "https://example.com/original",
  aihotUrl: "https://aihot.virxact.com/items/trend-1",
  publishedAt: "2026-08-14T00:00:00.000Z"
};

test("AIHOT v1 fields are normalized into traceable trend candidates", () => {
  const items = parseAihotV1Items({ items: [{
    id: candidate.id,
    title: candidate.title,
    summary: candidate.summary,
    category: candidate.category,
    source: { name: candidate.sourceName },
    links: { original: candidate.originalUrl, aihot: candidate.aihotUrl },
    publishedAt: candidate.publishedAt,
    score: 78,
    selected: true
  }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceName, candidate.sourceName);
  assert.equal(items[0].originalUrl, candidate.originalUrl);
  assert.equal(items[0].aihotUrl, candidate.aihotUrl);
});

test("hotspot prompt sends the complete content type rules to the model", () => {
  const prompt = buildHotspotIntegrationPrompt({ expression, artifact, productName: "JOTO", productKnowledge: [{ fact: "公开事实" }], brandBaseline: {}, candidates: [candidate], excludedHotspotIds: [] });
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.currentContentTypeAndRules.freeContentExpressionTypeVersionId, expression.freeContentExpressionTypeVersionId);
  assert.deepEqual(payload.currentContentTypeAndRules.structureModules, expression.structureModules);
  assert.equal(payload.currentContentTypeAndRules.additionalWritingRequirements, expression.additionalWritingRequirements);
  assert.equal(payload.currentArticle.title, artifact.selectedTitle);
});

test("model output must select a real candidate and declare valid affected sections", () => {
  const output = parseHotspotModelOutput(JSON.stringify({
    decision: "integrate",
    hotspotId: candidate.id,
    relevanceScore: 86,
    selectionReason: "热点与文章讨论的真实工作流直接相关。",
    writingAngle: "从自动执行扩展到人机责任边界。",
    affectedSectionKeys: ["opening", "industry_judgement"],
    riskNotes: ["数字需回原文核对"],
    titleCandidates: ["标题一", "标题二", "标题三"],
    summary: "结合最新行业信号重新审视真实工作流。",
    sections: [
      { sectionKey: "opening", heading: "变化已经发生", markdown: "开头正文" },
      { sectionKey: "industry_judgement", heading: "真正需要判断的事", markdown: "判断正文" }
    ]
  }));
  assert.deepEqual(validateHotspotModelOutput({ output, expression, candidates: [candidate] }), []);
  assert.equal(output.hotspotId, candidate.id);
});

test("hotspot repair receives the failed draft, exact issues and locked hotspot", () => {
  const previousOutput = parseHotspotModelOutput(JSON.stringify({
    decision: "integrate",
    hotspotId: candidate.id,
    relevanceScore: 86,
    selectionReason: "直接相关",
    writingAngle: "回到工作流",
    affectedSectionKeys: ["opening"],
    riskNotes: [],
    titleCandidates: ["标题一", "标题二", "标题三"],
    summary: "这是一个超过规则后需要被精准修订的摘要。",
    sections: [{ sectionKey: "opening", heading: "开头", markdown: "正文" }]
  }));
  const repair = JSON.parse(buildHotspotRepairPrompt({
    originalUserPrompt: buildHotspotIntegrationPrompt({ expression, artifact, productName: "JOTO", productKnowledge: [], brandBaseline: {}, candidates: [candidate], excludedHotspotIds: [] }).userPrompt,
    previousOutput,
    issues: ["摘要必须为 1 到 80 个字符。"],
    lockedHotspotId: candidate.id
  }));
  assert.equal(repair.lockedHotspotId, candidate.id);
  assert.equal(repair.previousOutput.hotspotId, candidate.id);
  assert.deepEqual(repair.issuesToFix, ["摘要必须为 1 到 80 个字符。"]);
});

test("hotspot validation only blocks newly introduced issues", () => {
  assert.deepEqual(collectHotspotRegressionIssues({
    contractIssues: [],
    baselineBlockingIssues: [],
    baselineRepairableIssues: ["正文使用了提示性冒号。"],
    nextBlockingIssues: [],
    nextRepairableIssues: ["正文使用了提示性冒号。", "摘要必须为 1 到 80 个字符。"]
  }), ["摘要必须为 1 到 80 个字符。"]);
});

test("3027 evidence rail exposes hotspot actions without occupying the article preview", async () => {
  const [preview, sidebar, citations, page, hotspotRoute, restoreRoute] = await Promise.all([
    readFile(new URL("../src/components/free-production/WechatArticlePreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/HotspotSidebarPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/free-production/CitationSourcePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/free-production/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/free-production/batches/[id]/hotspot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/free-production/batches/[id]/restore-version/route.ts", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(preview, /加入热点|更换热点|返回上一版本|热点未能融入正文/);
  assert.match(sidebar, /加入热点/);
  assert.match(sidebar, /更换热点/);
  assert.match(sidebar, /返回上一版本/);
  assert.match(sidebar, /热点未能融入正文/);
  assert.match(citations, /hotspotPanel/);
  assert.match(page, /restore-version/);
  assert.match(hotspotRoute, /integrateFreeProductionHotspot/);
  assert.match(restoreRoute, /restorePreviousFreeProductionVersion/);
});

test("previous-version restore moves the current pointer without deleting later attempts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "v5-aihot-restore-"));
  process.env.V5_FREE_PRODUCTION_STATE_PATH = path.join(directory, "state.json");
  const repository = await import("../src/lib/v5/free-production-repository.ts");
  const service = await import("../src/lib/v5/free-production-service.ts");
  const previous = { id: "artifact-base", selectedTitle: "原始正文", contentDigest: "digest-base", sourceExcerpts: [], version: 1 };
  const current = { id: "artifact-hotspot", previousArtifactId: previous.id, selectedTitle: "热点正文", contentDigest: "digest-hotspot", sourceExcerpts: [], version: 2 };
  await repository.updateFreeProductionState((state) => {
    state.batches["batch-1"] = {
      id: "batch-1",
      status: "ready_for_confirmation",
      version: 3,
      currentDraftArtifactId: current.id,
      draftArtifacts: [previous, current],
      sourceExcerpts: [],
      risks: [],
      channelConfig: { channel: "wechat_official_account" }
    };
    state.tasks["free-task-batch-1"] = { id: "free-task-batch-1", batchId: "batch-1" };
  });
  const result = await service.restorePreviousFreeProductionVersion("batch-1", { expectedVersion: 3, auditReason: "测试恢复热点前版本", artifactId: current.id }, "restore-test-key");
  assert.equal(result.currentDraftArtifactId, previous.id);
  assert.equal(result.draftArtifacts.length, 2);
  assert.equal(result.draftArtifacts.some((item) => item.id === current.id), true);
  await rm(directory, { recursive: true, force: true });
});
