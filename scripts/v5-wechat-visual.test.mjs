import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const scratch = path.resolve(process.cwd(), ".tmp", `v5-wechat-visual-${process.pid}`);
await mkdir(scratch, { recursive: true });
process.env.V5_FREE_PRODUCTION_STATE_PATH = path.join(scratch, "production.json");
process.env.V5_FREE_PRODUCTION_ASSET_PATH = path.join(scratch, "free-production-assets");
process.env.V5_WECHAT_VISUAL_STATE_PATH = path.join(scratch, "visual-plans.json");
process.env.V5_WECHAT_VISUAL_STORAGE_PATH = path.join(scratch, "visual-candidates");
delete process.env.WECHAT_VISUAL_IMAGE_BASE_URL;
delete process.env.WECHAT_VISUAL_IMAGE_API_KEY;
delete process.env.WECHAT_VISUAL_IMAGE_MODEL;

const productionRepository = await import("../src/lib/v5/free-production-repository.ts");
const visualProvider = await import("../src/lib/v5/wechat-visual-image-provider.ts");
const visualRepository = await import("../src/lib/v5/wechat-visual-repository.ts");
const visualService = await import("../src/lib/v5/wechat-visual-service.ts");
const visualStyles = await import("../src/lib/v5/wechat-visual-style-registry.ts");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlF9Z8AAAAASUVORK5CYII=", "base64");
const artifact = {
  id: "draft-visual-1",
  version: 3,
  selectedTitle: "企业 AI 不缺模型，缺的是进入工作流的最后一公里",
  summary: "从岗位任务、协作机制和验收标准解释企业 AI 如何进入真实业务。",
  sections: [
    { sectionKey: "judgment", heading: "先判断真正的卡点", markdown: "企业 AI 落地的主要阻力，往往不是模型能力，而是没有进入岗位工作流。" },
    { sectionKey: "system", heading: "把复杂业务拆成系统", markdown: "把输入、权限、执行步骤和验收标准组织成可以持续运行的闭环。" },
    { sectionKey: "path", heading: "从一个场景开始验证", markdown: "先完成最小路径，再按阶段扩展到更多角色和上下游。" }
  ],
  wechatPresentation: { templateId: "joto-editorial", htmlHash: "wechat-hash-1" }
};
const batch = {
  id: "free-batch-visual-1",
  productId: "product-workbuddy",
  productName: "WorkBuddy",
  status: "needs_input",
  version: 7,
  channelConfig: { channel: "wechat_official_account" },
  currentDraftArtifactId: artifact.id,
  draftArtifacts: [artifact],
  generationInputSnapshotId: "input-visual-1",
  inputSnapshots: [{ id: "input-visual-1", freeContentExpressionPresetSnapshot: { defaultAudience: "企业 AI 项目负责人" } }],
  risks: [{
    id: "risk-wechat-cover",
    key: "wechat_cover",
    title: "公众号封面",
    reason: "发送草稿前需要封面",
    status: "needs_input",
    affectedSectionKeys: [],
    inputSchema: { type: "file", label: "公众号封面", acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"] }
  }],
  riskAndGapSummary: { blockingCount: 0, needsInputCount: 1, warningCount: 0 },
  supplementalMaterialRefs: [],
  updatedAt: new Date().toISOString()
};

after(async () => {
  const expectedRoot = path.resolve(process.cwd(), ".tmp") + path.sep;
  if (!scratch.startsWith(expectedRoot)) throw new Error("Refusing to remove an unexpected test path.");
  await rm(scratch, { recursive: true, force: true });
});

test("cc2image adapter recommends three distinct cover routes and body anchors", () => {
  const routes = visualStyles.recommendWechatVisualRoutes(artifact);
  assert.deepEqual(routes.map((route) => route.routeKey), ["brand", "system", "hook"]);
  assert.equal(new Set(routes.map((route) => route.styleId)).size, 3);
  assert.equal(visualStyles.deriveWechatVisualAnchors(artifact).length, 3);
  const prompt = visualStyles.buildWechatCoverPrompt({ artifact, route: routes[0], productName: "WorkBuddy", targetAudience: "企业 AI 项目负责人" });
  assert.match(prompt, /2\.35:1/);
  assert.match(prompt, /不要生成正式中文标题/);
  assert.match(prompt, /不得编造客户、数据、排名/);
});

test("provider reports actionable pending config without exposing a credential", () => {
  const provider = visualProvider.getWechatVisualImageProviderStatus();
  assert.equal(provider.status, "pending_config");
  assert.deepEqual(provider.missingConfig, ["WECHAT_VISUAL_IMAGE_BASE_URL", "WECHAT_VISUAL_IMAGE_API_KEY", "WECHAT_VISUAL_IMAGE_MODEL"]);
  assert.equal(JSON.stringify(provider).includes("Bearer"), false);
});

test("provider errors redact configured credentials before reaching the visual plan", async () => {
  const secret = "test-secret-that-must-not-escape";
  process.env.WECHAT_VISUAL_IMAGE_BASE_URL = "https://images.example.test/v1";
  process.env.WECHAT_VISUAL_IMAGE_API_KEY = secret;
  process.env.WECHAT_VISUAL_IMAGE_MODEL = "test-image-model";
  const result = await visualProvider.generateWechatVisualImage({
    prompt: "test prompt",
    idempotencyKey: "test-provider-redaction",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `authorization denied for ${secret}` } }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorMessage?.includes(secret), false);
  assert.match(result.errorMessage || "", /\[REDACTED\]/);
  delete process.env.WECHAT_VISUAL_IMAGE_BASE_URL;
  delete process.env.WECHAT_VISUAL_IMAGE_API_KEY;
  delete process.env.WECHAT_VISUAL_IMAGE_MODEL;
});

test("three generated covers can be compared, selected, and replayed into the existing publish cover binding", async () => {
  await productionRepository.updateFreeProductionState((state) => {
    state.batches[batch.id] = structuredClone(batch);
  });
  const generateImage = async ({ idempotencyKey }) => ({
    ok: true,
    status: "success",
    provider: "test-image-provider",
    model: "test-image-model",
    requestId: idempotencyKey,
    data: png,
    mimeType: "image/png"
  });
  const plan = await visualService.generateWechatCoverCandidates(batch.id, {
    expectedVersion: batch.version,
    auditReason: "验收三种公众号封面候选生成",
    artifactId: artifact.id
  }, "test-generate-wechat-cover", { generateImage });
  assert.equal(plan.status, "cover_selection");
  assert.equal(plan.candidates.length, 3);
  assert.deepEqual(plan.candidates.map((candidate) => candidate.status), ["ready", "ready", "ready"]);
  assert.equal(plan.candidates.every((candidate) => !Object.hasOwn(candidate, "prompt")), true);
  const state = await visualRepository.readWechatVisualState();
  assert.equal(state.plans[plan.planId].anchors.length, 3);
  const candidate = plan.candidates[0];
  const selectionInput = {
    expectedVersion: batch.version,
    auditReason: "验收人工选择公众号封面",
    artifactId: artifact.id,
    planId: plan.planId,
    candidateId: candidate.candidateId
  };
  const selected = await visualService.selectWechatCoverCandidate(batch.id, selectionInput, "test-select-wechat-cover");
  assert.equal(selected.plan.status, "applied");
  assert.equal(selected.plan.selectedCoverCandidateId, candidate.candidateId);
  assert.equal(selected.batch.risks.find((risk) => risk.key === "wechat_cover")?.status, "ready");
  const coverRef = selected.batch.risks.find((risk) => risk.key === "wechat_cover")?.assetRef;
  assert.ok(coverRef);
  assert.deepEqual(await readFile(path.join(scratch, "free-production-assets", coverRef)), png);
  const replay = await visualService.selectWechatCoverCandidate(batch.id, selectionInput, "test-select-wechat-cover");
  assert.equal(replay.batch.version, selected.batch.version);
  assert.equal(replay.plan.version, selected.plan.version);
});

test("published batches keep their visual history readable but reject a new generation", async () => {
  await productionRepository.updateFreeProductionState((state) => {
    state.batches[batch.id].status = "published";
    state.batches[batch.id].version += 1;
  });
  const workspace = await visualService.getWechatVisualWorkspace(batch.id);
  assert.equal(workspace.plan?.status, "applied");
  await assert.rejects(
    visualService.generateWechatCoverCandidates(batch.id, {
      expectedVersion: batch.version + 2,
      auditReason: "验收发布后视觉方案锁定",
      artifactId: artifact.id
    }, "test-locked-wechat-cover"),
    (error) => error?.code === "WECHAT_VISUAL_LOCKED"
  );
});
