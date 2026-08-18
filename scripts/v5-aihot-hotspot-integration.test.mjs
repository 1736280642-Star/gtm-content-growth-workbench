import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseAihotV1Items } from "../src/lib/v5/aihot-trend-service.ts";
import { buildHotspotEvidenceExtractionPrompt, buildHotspotIntegrationPrompt, buildHotspotRepairPrompt, buildHotspotSelectionPrompt, collectHotspotRegressionIssues, parseHotspotEvidenceOutput, parseHotspotModelOutput, parseHotspotSelectionOutput, validateHotspotEvidenceOutput, validateHotspotModelOutput, validateHotspotSelectionOutput } from "../src/lib/v5/hotspot-integration.ts";
import { buildHotspotSourceEvidence } from "../src/lib/v5/hotspot-source-evidence.ts";

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

const sourceEvidence = buildHotspotSourceEvidence({
  hotspot: candidate,
  document: {
    title: "智能体进入应用维护流程",
    text: [
      "开发者把智能体接入应用的日常维护流程，让它持续处理崩溃测试和死代码清理。每次任务都有明确输入和可检查的代码改动，系统会记录任务从创建到提交的状态。维护人员不必在聊天窗口里反复描述同一个问题，可以直接查看改动范围和测试结果。",
      "智能体生成的代码不会直接合并。自动检查先运行测试和静态分析，开发者随后审核改动，确认符合要求以后才进入主分支。检查失败的任务会保留原因，后续任务根据反馈缩小范围。人工审核仍然负责判断改动是否符合产品要求和风险边界。",
      "这套流程把原本零散的对话变成持续运行的任务链。团队可以看到每次改动、检查结果和人工决定，也能在失败后调整下一轮任务。衡量效果时，开发者查看完成的维护任务和成功合并的改动，不再只统计向模型发出了多少次提问。负责人还能追溯某次修改为何通过审核，出了问题以后由谁决定回退，维护流程因此有了明确责任。"
    ].join("\n\n"),
    provider: "local_fetch",
    fetchedAt: "2026-08-16T00:00:00.000Z",
    contentHash: "source-hash"
  }
});

const selection = { hotspotId: candidate.id, relevanceScore: 86, readerTension: "AI 使用很多，业务结果仍然不清楚。", hookAngle: "从可验收的维护任务引出组织工作流。" };
const verifiedDetails = [
  { evidenceId: sourceEvidence.fragments[0].id, exactQuote: "开发者把智能体接入应用的日常维护流程", relevance: "具体动作可以直接作为开场。" },
  { evidenceId: sourceEvidence.fragments[1].id, exactQuote: "自动检查先运行测试和静态分析", relevance: "体现任务有验收环节。" }
];

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

test("hotspot selection ranks candidates before any article rewrite", () => {
  const prompt = buildHotspotSelectionPrompt({ expression, artifact, candidates: [candidate], excludedHotspotIds: [] });
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.currentContentTypeAndRules.freeContentExpressionTypeVersionId, expression.freeContentExpressionTypeVersionId);
  assert.deepEqual(payload.currentContentTypeAndRules.structureModules, expression.structureModules);
  assert.equal(payload.currentContentTypeAndRules.additionalWritingRequirements, expression.additionalWritingRequirements);
  assert.equal(payload.currentArticle.title, artifact.selectedTitle);
  const output = parseHotspotSelectionOutput(JSON.stringify({ decision: "integrate", selectionReason: "有直接的任务流程连接。", rankedCandidates: [selection] }));
  assert.deepEqual(validateHotspotSelectionOutput({ output, candidates: [candidate] }), []);
});

test("hotspot writing prompt receives original-source evidence and human-writing rules", () => {
  const evidencePrompt = buildHotspotEvidenceExtractionPrompt({ expression, artifact, hotspot: candidate, sourceEvidence, selection });
  const evidenceOutput = parseHotspotEvidenceOutput(JSON.stringify({ usable: true, reason: "细节足够", details: verifiedDetails }));
  assert.deepEqual(validateHotspotEvidenceOutput({ output: evidenceOutput, sourceEvidence }), []);
  assert.match(evidencePrompt.systemPrompt, /exactQuote 必须逐字复制/);
  const prompt = buildHotspotIntegrationPrompt({ expression, artifact, productName: "JOTO", productKnowledge: [{ fact: "公开事实" }], brandBaseline: {}, hotspot: candidate, sourceEvidence, selection, verifiedDetails });
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.sourceEvidence.contentHash, "source-hash");
  assert.equal(payload.sourceEvidence.fragments.length, 3);
  assert.equal(payload.articleEditorialAnchor.openingSectionKey, "opening");
  assert.match(prompt.systemPrompt, /热点不是需要单独介绍的新闻/);
  assert.match(prompt.systemPrompt, /human-writing|具体业务问题|自然白话/i);
});

test("model output must select a real candidate and declare valid affected sections", () => {
  const output = parseHotspotModelOutput(JSON.stringify({
    decision: "integrate",
    hotspotId: candidate.id,
    relevanceScore: 86,
    selectionReason: "热点与文章讨论的真实工作流直接相关。",
    writingAngle: "从自动执行扩展到人机责任边界。",
    hookPlan: { hookType: "contrast", factAnchor: "智能体持续处理应用维护任务", readerTension: "个人试用和组织结果之间存在落差", bridgeQuestion: "为什么同样使用 AI，组织结果差异很大", titleUse: "optional" },
    usedEvidenceIds: [sourceEvidence.fragments[0].id],
    affectedSectionKeys: ["opening"],
    riskNotes: ["数字需回原文核对"],
    titleCandidates: ["标题一", "标题二", "标题三"],
    summary: "结合最新行业信号重新审视真实工作流。",
    sections: [
      { sectionKey: "opening", heading: "变化已经发生", markdown: "智能体持续处理应用维护任务，改动经过检查后才合并。", citations: [{ claimText: "智能体持续处理应用维护任务", sourceIds: [sourceEvidence.fragments[0].id] }] }
    ]
  }));
  assert.deepEqual(validateHotspotModelOutput({ output, expression, hotspot: candidate, sourceEvidence, verifiedDetails }), []);
  assert.equal(output.hotspotId, candidate.id);
});

test("newly rewritten hotspot sections must pass the Chinese prose gate on their own", () => {
  const output = parseHotspotModelOutput(JSON.stringify({
    decision: "integrate",
    hotspotId: candidate.id,
    relevanceScore: 86,
    selectionReason: "热点与文章讨论的真实工作流直接相关。",
    writingAngle: "从自动执行扩展到人机责任边界。",
    hookPlan: { hookType: "contrast", factAnchor: "智能体持续处理应用维护任务", readerTension: "个人试用和组织结果之间存在落差", bridgeQuestion: "为什么同样使用 AI，组织结果差异很大", titleUse: "optional" },
    usedEvidenceIds: [sourceEvidence.fragments[0].id],
    affectedSectionKeys: ["opening"],
    riskNotes: [],
    titleCandidates: ["标题一", "标题二", "标题三"],
    summary: "结合最新行业信号重新审视真实工作流。",
    sections: [{
      sectionKey: "opening",
      heading: "变化已经发生",
      markdown: "一项实验给出两组结果：前者发现 21 个漏洞，后者发现 266 个。差距不在模型，而在组织方式。",
      citations: [{ claimText: "实验结果存在明显差异", sourceIds: [sourceEvidence.fragments[0].id] }]
    }]
  }));
  const issues = validateHotspotModelOutput({ output, expression, hotspot: candidate, sourceEvidence, verifiedDetails });
  assert.ok(issues.some((issue) => issue.includes("提示性冒号")));
  assert.ok(issues.some((issue) => issue.includes("翻案腔")));
});

test("hotspot repair receives the failed draft, exact issues and locked hotspot", () => {
  const previousOutput = parseHotspotModelOutput(JSON.stringify({
    decision: "integrate",
    hotspotId: candidate.id,
    relevanceScore: 86,
    selectionReason: "直接相关",
    writingAngle: "回到工作流",
    hookPlan: { hookType: "question", factAnchor: "维护任务", readerTension: "结果不可见", bridgeQuestion: "AI 如何进入业务流程", titleUse: "optional" },
    usedEvidenceIds: [sourceEvidence.fragments[0].id],
    affectedSectionKeys: ["opening"],
    riskNotes: [],
    titleCandidates: ["标题一", "标题二", "标题三"],
    summary: "这是一个超过规则后需要被精准修订的摘要。",
    sections: [{ sectionKey: "opening", heading: "开头", markdown: "正文", citations: [{ claimText: "维护任务", sourceIds: [sourceEvidence.fragments[0].id] }] }]
  }));
  const repair = JSON.parse(buildHotspotRepairPrompt({
    originalUserPrompt: buildHotspotIntegrationPrompt({ expression, artifact, productName: "JOTO", productKnowledge: [], brandBaseline: {}, hotspot: candidate, sourceEvidence, selection, verifiedDetails }).userPrompt,
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
  assert.match(sidebar, /error\?\.includes\("最近没有与当前正文自然相关的热点。"\)/);
  assert.match(sidebar, /noSuitableHotspot \? <p className=\{styles\.empty\}>最近没有与当前正文自然相关的热点。<\/p>/);
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
