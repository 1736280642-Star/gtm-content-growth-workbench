import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "joto-media-binding-"));
process.env.V5_MEDIA_LIBRARY_STATE_PATH = path.join(temporaryRoot, "media-state.json");
process.env.V5_MEDIA_LIBRARY_STORAGE_PATH = path.join(temporaryRoot, "assets");
process.env.V5_FREE_PRODUCTION_STATE_PATH = path.join(temporaryRoot, "free-production-state.json");

const { createMediaLibraryAsset } = await import("../src/lib/v5/media-library-service.ts");
const { getFreeProductionCatalog, bindFreeProductionVisualAsset } = await import("../src/lib/v5/free-production-service.ts");
const { updateFreeProductionState } = await import("../src/lib/v5/free-production-repository.ts");
const { renderJotoOfficialWechatBody, renderJotoOfficialWechatPreviewDocument } = await import("../src/lib/v5/joto-wechat-layout-renderer.ts");
const { collectWorkbenchMediaIds, rewriteWorkbenchMediaSources } = await import("./lib/workbench-media-rewrite.mjs");

const product = (await getFreeProductionCatalog()).products[0];
assert.ok(product, "media binding test requires one production-ready product");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("binding-image")]);

test.after(async () => { await rm(temporaryRoot, { recursive: true, force: true }); });

test("binds a product media asset and regenerates preview and publish HTML", async () => {
  const asset = await createMediaLibraryAsset({
    expectedVersion: 0,
    auditReason: "test create binding asset",
    productId: product.productId,
    description: "正文配图绑定测试素材。",
    file: { fileName: "binding.png", mimeType: "image/png", dataBase64: png.toString("base64") }
  }, "test-create-binding-asset");

  const sections = [{ sectionKey: "capability", heading: "核心能力", markdown: "正文段落。", citations: [{ claimText: "正文段落", sourceIds: ["source-1"] }] }];
  const suggestions = [{ id: "visual-1", placementAnchor: "capability", assetType: "product_screenshot", recommendation: "产品能力界面", captionSuggestion: "工作流能力界面", purpose: "解释产品能力", optional: true }];
  const previewBody = renderJotoOfficialWechatBody({ sections, visualSuggestions: suggestions, includeVisualPlaceholders: true, assetReferenceMode: "preview" });
  const publishHtml = renderJotoOfficialWechatBody({ sections, visualSuggestions: suggestions, includeVisualPlaceholders: false, assetReferenceMode: "publish" });
  const now = new Date().toISOString();
  await updateFreeProductionState((state) => {
    state.batches["batch-visual"] = {
      id: "batch-visual", productId: product.productId, productName: product.name, status: "ready_for_confirmation", version: 1,
      currentDraftArtifactId: "artifact-visual", draftArtifacts: [{
        id: "artifact-visual", expressionPlanId: "plan-1", generationInputSnapshotId: "input-1", titleCandidates: ["测试标题"], selectedTitle: "测试标题", summary: "测试摘要", sections,
        articleBody: "# 测试标题", channelLayoutTree: [], visualSuggestions: suggestions, sourceExcerpts: [{ id: "source-1", sourceType: "human_fact", excerpt: "正文段落" }],
        wechatPresentation: { templateId: "joto-official-v1", previewHtml: renderJotoOfficialWechatPreviewDocument({ title: "测试标题", bodyHtml: previewBody }), publishHtml, htmlHash: "before", validation: { passed: true, blockers: [], warnings: [], checkedAt: now } },
        factCheck: { supportedClaims: [], needsConfirmation: [], rejectedClaims: [] }, editorCheck: { deterministicResults: [], advisoryResults: [] }, riskAndGapSnapshot: [], contentDigest: "before", createdAt: now, version: 1
      }],
      risks: [], channelConfig: { channel: "wechat_official_account", channelRuleVersionId: "wechat-article-v1", ctaType: "contact", requiredPublishAssetKeys: [] },
      monthlyPlanId: "monthly-plan-test", monthStart: "2026-08-01", monthEnd: "2026-08-31", productExpressionRulePackageVersionId: "rule-1", knowledgeSnapshotIds: [], freeContentExpressionTypeVersionId: "expression-1", sourceMode: "facts", expressionFocus: "test", factItems: [], sourceExcerpts: [], supplementalMaterialRefs: [], riskAndGapSummary: { ready: 0, needsInput: 0, needsApproval: 0, warning: 0, blocked: 0 }, publishPolicy: "automatic_after_confirmation", repairCount: 0, expressionPlans: [], inputSnapshots: [], idempotencyKey: "seed-batch", createdBy: "test", createdAt: now, updatedAt: now
    };
    state.tasks["free-task-batch-visual"] = { id: "free-task-batch-visual", batchId: "batch-visual", monthlyPlanId: "monthly-plan-test", planningSource: "free_production", freeContentExpressionTypeVersionId: "expression-1", channel: "wechat_official_account", status: "ready_for_confirmation", createdAt: now, updatedAt: now };
  });

  const bound = await bindFreeProductionVisualAsset("batch-visual", { expectedVersion: 1, auditReason: "test bind media", artifactId: "artifact-visual", suggestionId: "visual-1", mediaAssetId: asset.id }, "test-bind-media");
  const artifact = bound.draftArtifacts[0];
  assert.equal(artifact.visualSuggestions[0].boundAssetRef, `workbench-media:${asset.id}`);
  assert.match(artifact.wechatPresentation.previewHtml, new RegExp(`/api/v5/free-production/assets/${asset.id}/content`));
  assert.match(artifact.wechatPresentation.publishHtml, new RegExp(`workbench-media://${asset.id}`));
  assert.ok(!artifact.wechatPresentation.publishHtml.includes("data-preview-only"));
  assert.notEqual(artifact.contentDigest, "before");
});

test("rewrites repeated workbench media references to one resolved WeChat URL", async () => {
  const id = "media-asset-12345678-1234-1234-1234-123456789abc";
  let calls = 0;
  const input = `<img src="workbench-media://${id}"><img src="workbench-media://${id}">`;
  assert.deepEqual(collectWorkbenchMediaIds(input), [id]);
  const output = await rewriteWorkbenchMediaSources(input, async () => { calls += 1; return "https://mmbiz.qpic.cn/article-image.png"; });
  assert.equal(calls, 1);
  assert.equal((output.match(/https:\/\/mmbiz\.qpic\.cn\/article-image\.png/g) || []).length, 2);
  assert.ok(!output.includes("workbench-media://"));
});

