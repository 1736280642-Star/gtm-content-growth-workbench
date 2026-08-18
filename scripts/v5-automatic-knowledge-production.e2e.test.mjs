import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AutomaticKnowledgeProductionPipeline,
  cleanParsedWebMarkdown,
  extractAutomaticClaims,
  governAutomaticClaims
} from "../src/lib/v5/rag/automatic-knowledge-production.ts";
import { buildRagSourceImportPlan } from "../src/lib/v5/rag/source-registry.ts";
import { buildManagedClaimExtractionIdempotencyKey } from "../src/lib/v5/rag/managed-claim-extraction-service.ts";
import {
  buildProtectedProductExpressions,
  filterAutomaticKnowledgeBlockedClaims,
  isAutomaticNoiseRejectedClaim
} from "../src/lib/v5/rag/knowledge-refresh-repository.ts";

test("managed claim extraction keeps versioned idempotency keys within the database contract", () => {
  const key = buildManagedClaimExtractionIdempotencyKey("joto-workbuddy", "a".repeat(64));
  assert.ok(key.length <= 128);
  assert.equal(key, buildManagedClaimExtractionIdempotencyKey("joto-workbuddy", "a".repeat(64)));
  assert.notEqual(key, buildManagedClaimExtractionIdempotencyKey("joto-workbuddy", "b".repeat(64)));
});

test("source snapshot rebuild uses the knowledge worker role and one-shot imports close their database pool", async () => {
  const route = await readFile("src/app/api/v5/products/[productId]/source-snapshot/route.ts", "utf8");
  const worker = await readFile("workers/rag-source-import-worker.mjs", "utf8");
  assert.match(route, /const knowledgeActor =/);
  assert.match(route, /runAutomaticKnowledgeRefresh\(\{ productId: product\.productId, actor: knowledgeActor \}\)/);
  assert.doesNotMatch(route, /runAutomaticKnowledgeRefresh\(\{ productId: product\.productId, actor: automationActor \}\)/);
  assert.match(worker, /finally\s*\{/);
  assert.match(worker, /getV5GovernancePool\(\)\.end\(\)/);
});

async function representativeDocuments() {
  const candidates = await buildRagSourceImportPlan({
    includeAuditAssets: false,
    productIds: ["joto-workbuddy", "tencent-adp-joto"]
  });
  const selected = candidates.filter((candidate) => candidate.disposition === "production_candidate");
  assert.equal(
    selected.find((candidate) => candidate.documentType === "official_structured_snapshot" && candidate.productId === "joto-workbuddy")?.canonicalUrl,
    "https://joto.ai/solutions/workbuddy"
  );
  assert.equal(selected.some((candidate) => candidate.relativePath.endsWith("structured/01-workbuddy-structured.md")), true);
  assert.equal(selected.some((candidate) => candidate.relativePath.endsWith("structured/02-tencent-adp-structured.md")), true);
  assert.equal(selected.some((candidate) => candidate.relativePath === "腾讯云adp × joto 联合解决方案.md"), true);
  return Promise.all(selected.map(async (candidate) => ({
    sourceId: candidate.sourceId,
    productId: candidate.productId,
    productName: candidate.productName,
    knowledgeBaseId: candidate.knowledgeBaseId,
    title: candidate.title,
    markdown: await readFile(candidate.normalizedTextRef, "utf8"),
    authorityLevel: candidate.authorityLevel,
    sourceUpdatedAt: candidate.documentType === "historical_solution_document" ? "2026-07-01T00:00:00.000Z" : candidate.sourceUpdatedAt,
    documentType: candidate.documentType,
    canonicalUrl: candidate.canonicalUrl
  })));
}

test("official webpage navigation, media, forms, labels, and slogan chains never become approved product facts", () => {
  const document = {
    sourceId: "official-workbuddy-page",
    productId: "joto-workbuddy",
    productName: "WorkBuddy x JOTO",
    knowledgeBaseId: "kb-workbuddy",
    title: "WorkBuddy",
    markdown: [
      "# WorkBuddy",
      "",
      "[JOTO](https://joto.ai/#hero)[Home](https://joto.ai/#hero)",
      "![WorkBuddy hero](https://joto.ai/workbuddy.png)",
      "**经营与增长**",
      "02 · GOVERNANCE",
      "WorkBuddy",
      "为什么由 JOTO 落地 WorkBuddy",
      "Name*Company*Email*Phone or WeChat*",
      "Product TeamsLeadershipProject Management",
      "员工用得起来企业管得住业务价值看得见",
      "预约 WorkBuddy 场景评估[进入场景大厅](https://joto.ai/hall)",
      "JOTO 基于 WorkBuddy 企业版，为企业规划岗位场景、配置专家与 Skills、接入业务系统并持续运营。",
      "效率放开、风险管住、资产留下、价值算清。"
    ].join("\n"),
    authorityLevel: "A2",
    sourceUpdatedAt: "2026-08-11T00:00:00.000Z",
    documentType: "workbench_managed_url",
    canonicalUrl: "https://joto.ai/solutions/workbuddy"
  };
  const claims = extractAutomaticClaims(document, {
    sourceRevisionId: "revision-workbuddy",
    sourceId: document.sourceId,
    revisionNumber: 1,
    contentHash: "a".repeat(64),
    sourceUpdatedAt: document.sourceUpdatedAt,
    title: document.title
  });
  const rejected = claims.filter((claim) => claim.status === "rejected");
  const approved = claims.filter((claim) => ["supported", "conditional"].includes(claim.status));

  assert.equal(rejected.length, 10);
  assert.equal(rejected.every((claim) => claim.limitations.some((item) => item.startsWith("automatic_noise_filter:"))), true);
  assert.deepEqual(approved.map((claim) => claim.normalizedClaim), [
    "JOTO 基于 WorkBuddy 企业版，为企业规划岗位场景、配置专家与 Skills、接入业务系统并持续运营。",
    "效率放开、风险管住、资产留下、价值算清。"
  ]);
});

test("parsed webpage noise is removed before Claim governance and historical noise is not a safety blocker", () => {
  const parsed = [
    "# WorkBuddy",
    "",
    "* Contact Us",
    "WORKBUDDY",
    "3. WorkBuddy",
    "![会执行任务的 WorkBuddy 机器人猫](https://joto.ai/scenario.png)WORKBUDDY",
    "* Insights",
    "JOTO 基于 WorkBuddy 企业版，为企业规划岗位场景、接入业务系统并持续运营。"
  ].join("\n");
  const cleaned = cleanParsedWebMarkdown(parsed, { productName: "WorkBuddy" });
  assert.equal(cleaned.removed.length, 5);
  assert.equal(cleaned.markdown.includes("Contact Us"), false);
  assert.equal(cleaned.markdown.includes("scenario.png"), false);
  assert.equal(cleaned.markdown.includes("JOTO 基于 WorkBuddy 企业版"), true);
  assert.equal(isAutomaticNoiseRejectedClaim(
    "rejected",
    ["automatic_noise_filter:navigation_terms"]
  ), true);
  assert.equal(isAutomaticNoiseRejectedClaim(
    "rejected",
    ["未经授权的客户案例"]
  ), false);
  const protectedExpressions = buildProtectedProductExpressions({
    canonicalName: "WorkBuddy",
    displayName: "WorkBuddy",
    brandName: "Tencent",
    aliases: ["WORKBUDDY", "JOTO WorkBuddy"],
    fixedExpressionText: "JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商，支持WorkBuddy专项服务。"
  });
  const effectiveBlocked = filterAutomaticKnowledgeBlockedClaims([
    { id: "noise", normalized_claim: "Contact Us", review_status: "rejected", limitations: ["automatic_noise_filter:navigation_terms"] },
    { id: "product", normalized_claim: "WORKBUDDY", review_status: "rejected", limitations: ["legacy_manual_reject"] },
    { id: "fixed-token", normalized_claim: "ADP", review_status: "rejected", limitations: ["legacy_manual_reject"] },
    { id: "real", normalized_claim: "未经授权的客户案例", review_status: "rejected", limitations: ["unauthorized_customer_case"] }
  ], protectedExpressions);
  assert.deepEqual(effectiveBlocked.map((item) => item.id), ["real"]);
});

test("collapsed taxonomy labels are rejected while complete English facts remain usable", () => {
  const document = {
    sourceId: "official-noteflow-page",
    productId: "noteflow",
    productName: "Noteflow",
    knowledgeBaseId: "kb-noteflow",
    title: "Noteflow",
    markdown: [
      "# Use cases",
      "",
      "Product TeamsLeadershipProject Management",
      "Sales Marketing Operations",
      "FeaturesSecurityPricing",
      "Noteflow is designed for enterprise product teams that need private document analysis.",
      "Sales teams upload product manuals and ask questions directly.",
      "Noteflow supports PDF, Word and audio files."
    ].join("\n"),
    authorityLevel: "A2",
    sourceUpdatedAt: "2026-08-11T00:00:00.000Z",
    documentType: "workbench_managed_url",
    canonicalUrl: "https://note.jotoai.com/"
  };
  const claims = extractAutomaticClaims(document, {
    sourceRevisionId: "revision-noteflow",
    sourceId: document.sourceId,
    revisionNumber: 1,
    contentHash: "b".repeat(64),
    sourceUpdatedAt: document.sourceUpdatedAt,
    title: document.title
  });

  assert.deepEqual(
    claims.filter((claim) => claim.status === "rejected").map((claim) => claim.normalizedClaim),
    ["Product TeamsLeadershipProject Management", "Sales Marketing Operations", "FeaturesSecurityPricing"]
  );
  assert.deepEqual(
    claims.filter((claim) => claim.status !== "rejected").map((claim) => claim.normalizedClaim),
    [
      "Noteflow is designed for enterprise product teams that need private document analysis.",
      "Sales teams upload product manuals and ask questions directly.",
      "Noteflow supports PDF, Word and audio files."
    ]
  );
});

test("generic labeled capabilities use authority and recency, while unresolved peers fail closed", () => {
  const revision = (sourceId, sourceUpdatedAt) => ({
    sourceRevisionId: `revision-${sourceId}`,
    sourceId,
    revisionNumber: 1,
    contentHash: sourceId.padEnd(64, "0").slice(0, 64),
    sourceUpdatedAt,
    title: sourceId
  });
  const document = (sourceId, authorityLevel, sourceUpdatedAt, row) => ({
    sourceId,
    productId: "generic-product",
    productName: "Generic Product",
    knowledgeBaseId: "kb-generic",
    title: sourceId,
    markdown: `# Capabilities\n\n| Capability | Description |\n| --- | --- |\n${row}`,
    authorityLevel,
    sourceUpdatedAt,
    documentType: "structured_product_facts"
  });
  const newer = document("official-new", "A2", "2026-07-25T00:00:00.000Z", "| Data export | Exports CSV and JSON |\n| Offline cache | Supported | ");
  const older = document("historical-old", "B1", "2026-07-01T00:00:00.000Z", "| Data export | Exports CSV only |\n| Offline cache | Not supported | ");
  const extracted = [newer, older].flatMap((item) => extractAutomaticClaims(item, revision(item.sourceId, item.sourceUpdatedAt)));
  const governed = governAutomaticClaims(extracted);
  const exports = governed.filter((claim) => /Data export/.test(claim.originalQuote));
  assert.equal(exports.find((claim) => claim.sourceId === "official-new")?.status, "supported");
  assert.equal(exports.find((claim) => claim.sourceId === "historical-old")?.status, "superseded");

  const peerA = document("peer-a", "A2", "2026-07-25T00:00:00.000Z", "| Private deployment | Supported | ");
  const peerB = document("peer-b", "A2", "2026-07-25T00:00:00.000Z", "| Private deployment | Not supported | ");
  const peers = governAutomaticClaims([peerA, peerB].flatMap((item) => extractAutomaticClaims(item, revision(item.sourceId, item.sourceUpdatedAt))))
    .filter((claim) => /Private deployment/.test(claim.originalQuote));
  assert.equal(peers.length, 2);
  assert.equal(peers.every((claim) => claim.status === "disputed"), true);
});

test("JOTO x ADP facts automatically flow from import to traceable, conflict-safe drafts", async () => {
  const documents = await representativeDocuments();
  let forbiddenClaimIds = [];
  const generator = {
    async generate({ task, evidencePack }) {
      const relevant = evidencePack.evidenceItems.filter((item) => {
        if (task.productId === "tencent-adp-joto") return /合作伙伴|部署|workflow|rag/i.test(item.normalizedClaim);
        return /enterprise|价格|席|可能变化|以当期/i.test(item.normalizedClaim);
      }).slice(0, 8);
      return {
        title: task.title,
        passages: [
          ...relevant.map((item) => ({ text: item.normalizedClaim, claimId: item.claimId })),
          { text: "腾讯云 ADP 提供知识库中未记录的量子计算自动扩容能力。" },
          ...forbiddenClaimIds.map((claimId) => ({ text: "产品支持离线模式。", claimId }))
        ]
      };
    }
  };
  let clock = 0;
  const pipeline = new AutomaticKnowledgeProductionPipeline(generator, () => `2026-07-24T10:00:${String(clock++).padStart(2, "0")}.000Z`);
  const sameGradeConflict = [
    {
      sourceId: "same-grade-a",
      productId: "tencent-adp-joto",
      productName: "腾讯云 ADP × JOTO",
      knowledgeBaseId: "kb-joto-tencent-adp-official",
      title: "同级资料 A",
      markdown: "# 能力\n\n产品支持离线模式。",
      authorityLevel: "A2",
      sourceUpdatedAt: "2026-07-24T00:00:00.000Z",
      documentType: "official_structured_snapshot"
    },
    {
      sourceId: "same-grade-b",
      productId: "tencent-adp-joto",
      productName: "腾讯云 ADP × JOTO",
      knowledgeBaseId: "kb-joto-tencent-adp-official",
      title: "同级资料 B",
      markdown: "# 能力\n\n产品不支持离线模式。",
      authorityLevel: "A2",
      sourceUpdatedAt: "2026-07-24T00:00:00.000Z",
      documentType: "official_structured_snapshot"
    }
  ];

  const importResult = await pipeline.importDocuments([...documents, ...sameGradeConflict]);
  assert.equal(importResult.indexSnapshot?.status, "active", "导入后应自动完成索引快照");
  assert.equal(Object.keys(importResult.indexSnapshot?.vectors || {}).length > 0, true, "索引应包含向量");

  const claims = pipeline.getClaims();
  const officialBoundary = claims.filter((claim) => claim.subjectKey === "joto-tencent-partnership" && claim.semanticValue === "tencent_partner_not_adp_official_partner");
  const staleOfficialPartner = claims.filter((claim) => claim.subjectKey === "joto-tencent-partnership" && claim.semanticValue === "adp_official_partner");
  assert.equal(officialBoundary.some((claim) => ["supported", "conditional"].includes(claim.status)), true, "新版官网边界应胜出");
  assert.equal(staleOfficialPartner.every((claim) => claim.status === "superseded"), true, "旧版官方合作伙伴表述应失效");

  const disputed = claims.filter((claim) => claim.subjectKey === "offline-mode");
  assert.equal(disputed.length, 2);
  assert.equal(disputed.every((claim) => claim.status === "disputed"), true, "同级同时间冲突不得自动裁决");
  forbiddenClaimIds = [...staleOfficialPartner, ...disputed].map((claim) => claim.claimId);

  await pipeline.enqueueTask({
    taskId: "task-adp",
    taskVersion: 1,
    productId: "tencent-adp-joto",
    title: "腾讯云 ADP 与 JOTO 的落地边界",
    query: "腾讯云 ADP JOTO 合作伙伴 部署 Workflow RAG"
  });
  const adpDraft = pipeline.getDraft("task-adp");
  assert.ok(adpDraft);
  assert.match(adpDraft.markdown, /没有把 JOTO 表述为“腾讯云 ADP 官方合作伙伴”|不扩写为“腾讯云 ADP 官方合作伙伴”/);
  assert.doesNotMatch(adpDraft.markdown, /量子计算自动扩容/);
  assert.doesNotMatch(adpDraft.markdown, /产品支持离线模式/);
  assert.equal(adpDraft.removedPassages.some((item) => item.reason === "claim_missing"), true, "知识库外能力应被自动删除");
  assert.equal(adpDraft.removedPassages.some((item) => item.reason === "claim_not_in_evidence_pack"), true, "冲突或过期 Claim 应被自动删除");
  assert.equal(adpDraft.factTraces.every((trace) => trace.originalQuote && trace.sourceLocator.characterRange), true, "任意事实必须带 Claim 到原文位置追溯");
  assert.equal(adpDraft.factTraces.every((trace) => adpDraft.markdown.includes(trace.originalQuote)), true, "正文必须展示逐字原文引用");
  const sourceById = new Map([...documents, ...sameGradeConflict].map((document) => [document.sourceId, document]));
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  assert.equal(adpDraft.factTraces.every((trace) => {
    const claim = claimById.get(trace.claimId);
    const source = claim ? sourceById.get(claim.sourceId) : undefined;
    const range = trace.sourceLocator.characterRange;
    return Boolean(source && range && source.markdown.slice(range[0], range[1]).includes(trace.originalQuote));
  }), true, "Claim 的字符范围必须指向 SourceRevision 中的逐字原文");

  await pipeline.enqueueTask({
    taskId: "task-workbuddy",
    taskVersion: 1,
    productId: "joto-workbuddy",
    title: "WorkBuddy 企业方案参考",
    query: "Enterprise 价格 席位 采购 当期产品页面 正式报价单 合同"
  });
  const workbuddyDraft = pipeline.getDraft("task-workbuddy");
  assert.ok(workbuddyDraft);
  assert.match(workbuddyDraft.markdown, /¥198|¥316/);
  assert.match(workbuddyDraft.markdown, /价格、席位、能力和优惠可能变化|采购时应以当期产品页面、正式报价单与合同为准/);

  const oldPack = pipeline.getEvidencePacks("task-adp").find((pack) => pack.status === "active");
  assert.ok(oldPack);
  const officialDocument = documents.find((document) => document.productId === "tencent-adp-joto" && document.documentType === "official_structured_snapshot");
  assert.ok(officialDocument);
  await pipeline.importDocuments([{
    ...officialDocument,
    sourceUpdatedAt: "2026-07-25T00:00:00.000Z",
    markdown: `${officialDocument.markdown}\n\n## 13. 更新记录\n\n本资料于 2026-07-25 完成事实边界复核。`
  }]);
  const packsAfterUpdate = pipeline.getEvidencePacks("task-adp");
  const invalidated = packsAfterUpdate.find((pack) => pack.evidencePackId === oldPack.evidencePackId);
  const refreshed = packsAfterUpdate.find((pack) => pack.status === "active" && pack.evidencePackId !== oldPack.evidencePackId);
  assert.equal(invalidated?.status, "invalidated", "SourceRevision 更新后旧 EvidencePack 应自动失效");
  assert.equal(invalidated?.invalidationReason, "source_revision_changed");
  assert.ok(refreshed, "待生成任务应使用新快照自动重检索");
  assert.notEqual(refreshed.sourceSnapshotHash, oldPack.sourceSnapshotHash);
  assert.equal(pipeline.getDraft("task-adp")?.evidencePackId, refreshed.evidencePackId);
});
