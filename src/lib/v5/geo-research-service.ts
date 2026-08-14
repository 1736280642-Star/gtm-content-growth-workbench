import type {
  GeoResearchEvidence,
  GeoResearchFinding,
  GeoResearchQuestionCatalog,
  GeoResearchReadiness,
  GeoResearchRun,
  GeoResearchTask
} from "./geo-research-contracts";
import { getGeoResearchProviderReadiness } from "./geo-research-provider";
import {
  approveGeoBlueprintRecord,
  cancelStaleGeoResearchRunRecord,
  confirmGeoResearchQuestionFindingsRecord,
  createGeoResearchProjectRecord,
  createGeoResearchRunRecord,
  readGeoResearchRunWorkspace,
  readGeoResearchWorkspace,
  readLatestGeoSourceSnapshot,
  requestGeoBlueprintChangesRecord,
  updateGeoResearchProjectRecord
} from "./geo-research-repository";
import { getActiveProduct } from "./product-registry-service";
import type { ProductRegistryItem } from "./product-registry-contracts";
import { ingestV5QuestionSignals } from "./question-service";
import { hashV5GovernancePayload, type V5GovernanceActor } from "./knowledge-governance-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";
import { readProductKnowledgeProfile } from "./product-knowledge-profile";

function assertText(value: string | undefined, field: string, maxLength = 255) {
  if (!value?.trim()) {
    throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
  }
  if (value.trim().length > maxLength) {
    throw new V5GovernanceServiceError("invalid_contract", `${field} 不能超过 ${maxLength} 个字符。`, 400);
  }
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId", 128);
  assertText(actor.actorRole, "actorRole", 128);
  assertText(actor.actorType, "actorType", 32);
  assertText(actor.auditReason, "auditReason", 500);
}

function assertStringList(values: string[] | undefined, field: string, maxItems = 50) {
  if (!values) return;
  if (values.length > maxItems || values.some((item) => typeof item !== "string" || !item.trim())) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      `${field} 必须是至多 ${maxItems} 项的非空字符串数组。`,
      400
    );
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, maxItems)
    : [];
}

function normalizedQuestion(value: string) {
  return value.toLowerCase().replace(/[\s，。！？、：；“”"'（）()\-—_]/g, "");
}

export function buildGeoResearchQuestionCatalog(input: {
  product: Pick<ProductRegistryItem, "productId" | "displayName">;
  run: GeoResearchRun;
  tasks: GeoResearchTask[];
  evidence: GeoResearchEvidence[];
  findings: GeoResearchFinding[];
}): GeoResearchQuestionCatalog {
  const discoveryTask = input.tasks.find((task) => task.taskType === "live_question_discovery");
  const rawQuestions = Array.isArray(discoveryTask?.outputSummary.questions)
    ? discoveryTask.outputSummary.questions
    : [];
  const metadataByQuestion = new Map<string, Record<string, unknown>>();
  for (const raw of rawQuestions) {
    const item = asRecord(raw);
    if (typeof item.text === "string" && item.text.trim()) metadataByQuestion.set(normalizedQuestion(item.text), item);
  }
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  const items = input.findings
    .filter((finding) => finding.findingType === "question_opportunity")
    .map((finding) => {
      const metadata = metadataByQuestion.get(normalizedQuestion(finding.title)) || {};
      const sources = finding.evidenceIds.flatMap((evidenceId) => {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence?.sourceUrl || evidence.verificationStatus !== "verified") return [];
        return [{
          evidenceId,
          url: evidence.sourceUrl,
          title: evidence.sourceTitle,
          publisher: evidence.publisher,
          query: evidence.queryText
        }];
      });
      return {
        findingId: finding.findingId,
        question: finding.title,
        intent: typeof metadata.intent === "string" ? metadata.intent : finding.summary,
        audience: typeof metadata.audience === "string" ? metadata.audience : undefined,
        module: typeof metadata.module === "string" && metadata.module.trim() ? metadata.module.trim() : "uncategorized",
        priority: typeof metadata.priority === "number" ? Math.max(0, Math.min(1, metadata.priority)) : finding.confidence,
        confidence: finding.confidence,
        suggestedArticleTypes: strings(metadata.suggestedArticleTypes),
        keywords: strings(metadata.keywords),
        sourceEvidenceIds: sources.map((source) => source.evidenceId),
        sources,
        reviewStatus: finding.reviewStatus
      };
    })
    .sort((left, right) => right.priority - left.priority || left.question.localeCompare(right.question, "zh-CN"));
  const importedCount = items.filter((item) => item.reviewStatus === "confirmed").length;
  const liveSearchVerified = discoveryTask?.outputSummary.liveSearchVerified === true;
  const moduleCounts = new Map<string, number>();
  for (const item of items) moduleCounts.set(item.module, (moduleCounts.get(item.module) || 0) + 1);
  const status = importedCount === items.length && items.length > 0
    ? "imported" as const
    : importedCount > 0
      ? "partially_imported" as const
      : liveSearchVerified && discoveryTask?.status === "completed"
        ? "ready_for_review" as const
        : "collecting" as const;
  return {
    catalogId: `geo-question-catalog-${input.run.runId}`,
    runId: input.run.runId,
    productId: input.product.productId,
    productName: input.product.displayName,
    status,
    liveSearchVerified,
    totalCount: items.length,
    verifiedCount: items.filter((item) => item.sources.length > 0).length,
    importedCount,
    modules: [...moduleCounts.entries()].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || a.module.localeCompare(b.module)),
    items
  };
}

function suggestedArticleTypesForQuestion(question: string) {
  if (/对比|区别|选择|选型|是否需要|哪个好/.test(question)) return ["选型与比较"];
  if (/如何|怎么|步骤|准备|部署|实施|迁移|接入|配置/.test(question)) return ["实施指南"];
  if (/报错|异常|排查|性能|接口|API|架构|技术/.test(question)) return ["技术实践"];
  if (/场景|适合|能否用于|可以用在/.test(question)) return ["场景解决方案"];
  return ["FAQ"];
}

export async function getGeoResearchWorkspace(productId: string) {
  assertText(productId, "productId", 64);
  const product = await getActiveProduct(productId);
  const [workspace, latestSourceSnapshot, productProfile] = await Promise.all([
    readGeoResearchWorkspace(productId),
    readLatestGeoSourceSnapshot(productId),
    readProductKnowledgeProfile(productId, product.displayName)
  ]);
  const provider = getGeoResearchProviderReadiness();
  const sourceSnapshotReady = latestSourceSnapshot?.quality.status === "ready";
  const checks: GeoResearchReadiness["checks"] = [
    {
      key: "product_identity",
      label: "产品身份",
      status: product.confirmedAt ? "ready" : "blocked",
      detail: product.confirmedAt ? "产品实体已人工确认。" : "产品实体还没有人工确认记录。"
    },
    {
      key: "research_boundary",
      label: "研究边界",
      status: workspace ? "ready" : "blocked",
      detail: workspace ? "表达重点、市场、语言和渠道已保存。" : "还没有创建 GEO 调研项目。",
      actionLabel: workspace ? undefined : "补充研究边界",
      actionHref: workspace ? undefined : `/products/${encodeURIComponent(productId)}/research`
    },
    {
      key: "source_snapshot",
      label: "产品资料快照",
      status: sourceSnapshotReady ? "ready" : "blocked",
      detail: sourceSnapshotReady && latestSourceSnapshot
        ? `已冻结 ${latestSourceSnapshot.sourceCount} 个资料源、${latestSourceSnapshot.approvedClaimCount} 条已批准事实；其中 ${latestSourceSnapshot.quality.officialSourceCount} 个正式来源可公开追溯。`
        : latestSourceSnapshot
          ? `资料快照未达到正式调研标准：${latestSourceSnapshot.quality.issues.join("；")}`
        : "尚未形成可追溯的 SourceSnapshot，不能创建研究运行。",
      actionLabel: sourceSnapshotReady ? undefined : "补充正式产品资料",
      actionHref: sourceSnapshotReady ? undefined : `/products/${encodeURIComponent(productId)}?tab=materials`
    },
    {
      key: "live_search_provider",
      label: "联网研究 Provider",
      status: provider.status,
      detail: provider.status === "ready"
        ? "智谱、豆包、千问事实搜索已配置；智谱负责统一语义综合。"
        : "任务链可以先建立，但事实搜索会等待三家 Provider 配置完成。",
      actionLabel: provider.status === "ready" ? undefined : "查看待配置字段",
      actionHref: provider.status === "ready" ? undefined : "/settings?tab=models",
      missingConfig: provider.missingConfig
    }
  ];
  const hasBlockedCheck = checks.some((check) => check.status === "blocked");
  const readiness: GeoResearchReadiness = {
    status: hasBlockedCheck ? "blocked" : provider.status,
    canCreateRun: !hasBlockedCheck,
    canExecuteLiveResearch: !hasBlockedCheck && provider.status === "ready",
    latestSourceSnapshot,
    checks
  };
  return { product, productProfile, workspace, readiness };
}

export async function getGeoResearchRunDetails(input: { productId: string; runId: string }) {
  assertText(input.productId, "productId", 64);
  assertText(input.runId, "runId", 64);
  const product = await getActiveProduct(input.productId);
  const runWorkspace = await readGeoResearchRunWorkspace(input);
  if (!runWorkspace) {
    throw new V5GovernanceServiceError("research_run_not_found", "GEO 调研运行不存在。", 404);
  }
  return {
    product,
    runWorkspace: {
      ...runWorkspace,
      questionCatalog: buildGeoResearchQuestionCatalog({ product, ...runWorkspace })
    }
  };
}

export async function importGeoResearchQuestionCatalog(input: {
  productId: string;
  runId: string;
  findingIds: string[];
  expectedQuestionPoolVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.runId, "runId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  assertStringList(input.findingIds, "findingIds", 100);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError("human_approval_required", "真实用户问题目录必须经人工确认后才能进入问题池。", 403);
  }
  if (!input.findingIds.length) {
    throw new V5GovernanceServiceError("invalid_contract", "至少选择一个真实用户问题。", 400);
  }
  if (!Number.isInteger(input.expectedQuestionPoolVersion) || input.expectedQuestionPoolVersion < 0) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedQuestionPoolVersion 必须是非负整数。", 400);
  }
  const product = await getActiveProduct(input.productId);
  const runWorkspace = await readGeoResearchRunWorkspace({ productId: input.productId, runId: input.runId });
  if (!runWorkspace) throw new V5GovernanceServiceError("research_run_not_found", "GEO 调研运行不存在。", 404);
  const catalog = buildGeoResearchQuestionCatalog({ product, ...runWorkspace });
  if (!catalog.liveSearchVerified) {
    throw new V5GovernanceServiceError(
      "live_search_gate_failed",
      "本次问题目录没有通过联网搜索门禁，禁止写入正式问题池。",
      409,
      "等待联网问题发现任务完成，并确认每条问题都有公开来源。"
    );
  }
  const selectedIds = new Set(input.findingIds);
  const selected = catalog.items.filter((item) => selectedIds.has(item.findingId));
  if (selected.length !== selectedIds.size) {
    throw new V5GovernanceServiceError("question_catalog_finding_mismatch", "选择的问题不属于当前产品目录。", 409, "刷新页面后重新选择。" );
  }
  if (selected.some((item) => item.reviewStatus === "rejected")) {
    throw new V5GovernanceServiceError("question_catalog_rejected_item", "已拒绝的问题不能收录到问题池。", 409, "刷新页面后重新选择。" );
  }
  const unverified = selected.filter((item) => item.sources.length === 0);
  if (unverified.length) {
    throw new V5GovernanceServiceError(
      "question_source_evidence_missing",
      "部分问题没有逐条对应的公开来源，不能进入问题池。",
      409,
      "仅选择带有可复核来源的问题。"
    );
  }
  const result = ingestV5QuestionSignals({
    idempotencyKey: `${input.idempotencyKey}:question-pool`,
    expectedVersion: input.expectedQuestionPoolVersion,
    actor: input.actor,
    signals: selected.map((item) => ({
      text: item.question,
      source: "geo_research" as const,
      sourceId: `${input.runId}:${item.findingId}`,
      sourceConfidence: item.confidence,
      product: product.displayName,
      entities: [...new Set([product.canonicalName, product.displayName, ...product.aliases].filter(Boolean))],
      relationship: `${catalog.catalogId}:${item.module}`,
      audience: item.audience,
      suggestedArticleTypes: item.suggestedArticleTypes.length ? item.suggestedArticleTypes : suggestedArticleTypesForQuestion(item.question),
      keywords: item.keywords,
      knowledgeReadiness: {},
      evidenceGap: true,
      geoMonitoringApproval: {
        source: "geo_research_human" as const,
        approvedBy: input.actor.actorId,
        researchRunId: input.runId,
        findingId: item.findingId
      }
    }))
  });
  const confirmation = await confirmGeoResearchQuestionFindingsRecord({
    productId: input.productId,
    runId: input.runId,
    findingIds: selected.map((item) => item.findingId),
    catalogId: catalog.catalogId,
    idempotencyKey: `${input.idempotencyKey}:research-findings`,
    actor: input.actor
  });
  return {
    catalogId: catalog.catalogId,
    importedCount: selected.length,
    questionIds: result.data.questionIds,
    questionPoolStateVersion: result.data.stateVersion,
    replayed: result.status === "replayed" && confirmation.replayed
  };
}

export async function createGeoResearchProjectForProduct(input: {
  productId: string;
  expressionFocus: string;
  forbiddenFocus?: string[];
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.expressionFocus, "expressionFocus", 4000);
  assertText(input.idempotencyKey, "idempotencyKey", 96);
  assertActor(input.actor);
  assertStringList(input.forbiddenFocus, "forbiddenFocus", 100);
  assertStringList(input.researchMarkets, "researchMarkets", 20);
  assertStringList(input.languages, "languages", 20);
  assertStringList(input.targetChannels, "targetChannels", 30);
  await getActiveProduct(input.productId);
  const write = await createGeoResearchProjectRecord({
    project: {
      productId: input.productId,
      expressionFocus: input.expressionFocus,
      forbiddenFocus: input.forbiddenFocus,
      researchMarkets: input.researchMarkets,
      languages: input.languages,
      targetChannels: input.targetChannels
    },
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目创建后读取失败。", 500);
  }
  return { ...write, workspace };
}

export async function updateGeoResearchProject(input: {
  productId: string;
  expectedProjectVersion: number;
  expressionFocus: string;
  forbiddenFocus?: string[];
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.expressionFocus, "expressionFocus", 4000);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  assertStringList(input.forbiddenFocus, "forbiddenFocus", 100);
  assertStringList(input.researchMarkets, "researchMarkets", 20);
  assertStringList(input.languages, "languages", 20);
  assertStringList(input.targetChannels, "targetChannels", 30);
  if (!Number.isInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedProjectVersion 必须是正整数。", 400);
  }
  await getActiveProduct(input.productId);
  const write = await updateGeoResearchProjectRecord({
    productId: input.productId,
    expectedVersion: input.expectedProjectVersion,
    expressionFocus: input.expressionFocus.trim(),
    forbiddenFocus: input.forbiddenFocus || [],
    researchMarkets: input.researchMarkets?.length ? input.researchMarkets : ["CN"],
    languages: input.languages?.length ? input.languages : ["zh-CN"],
    targetChannels: input.targetChannels?.length ? input.targetChannels : ["wechat", "official_website"],
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}

export async function startGeoResearchRun(input: {
  productId: string;
  triggerType?: GeoResearchRun["triggerType"];
  expectedProjectVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (!Number.isInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      "expectedProjectVersion 必须是正整数。",
      400,
      "刷新产品调研页，读取最新版本后重试。"
    );
  }
  await getActiveProduct(input.productId);
  const write = await createGeoResearchRunRecord({
    productId: input.productId,
    triggerType: input.triggerType || "product_onboarding",
    expectedProjectVersion: input.expectedProjectVersion,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  }
  return { ...write, workspace };
}

export async function approveGeoBlueprint(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.blueprintVersionId, "blueprintVersionId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError(
      "human_approval_required",
      "GEO 蓝图必须由人工批准，Agent 不能代替批准。",
      403
    );
  }
  const allowedRoles = new Set(["content_growth", "knowledge_manager", "workbench_operator", "developer_admin"]);
  if (!allowedRoles.has(input.actor.actorRole)) {
    throw new V5GovernanceServiceError(
      "forbidden",
      "当前角色无权批准 GEO 蓝图。",
      403,
      "切换到内容增长、知识管理、工作台运营或开发管理员角色。"
    );
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const write = await approveGeoBlueprintRecord(input);
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}

export async function runAutomaticGeoResearchOrchestration(input: { actor: V5GovernanceActor; productIds?: string[] }) {
  assertActor(input.actor);
  if (!["system", "scheduler"].includes(input.actor.actorType)) {
    throw new V5GovernanceServiceError("system_policy_actor_required", "自动 GEO 调研必须由系统策略执行器发起。", 403);
  }
  const { listProducts } = await import("./product-registry-service");
  const productFilter = new Set((input.productIds || []).map((item) => item.trim()).filter(Boolean));
  const products = (await listProducts()).filter((product) => !productFilter.size || productFilter.has(product.productId));
  const results: Array<{ productId: string; status: string; detail?: string }> = [];
  for (const product of products) {
    let state = await getGeoResearchWorkspace(product.productId);
    if (!state.workspace) {
      const projectRequest = {
        productId: product.productId,
        expressionFocus: `围绕 ${product.displayName} 的真实用户问题、适用场景、选型依据与可信产品事实建立 GEO 可见性。`,
        forbiddenFocus: ["不得编造产品能力、客户案例或未经资料支持的结论"],
        researchMarkets: ["CN"],
        languages: ["zh-CN"],
        targetChannels: ["wechat", "official_website", "ai_frontend"]
      };
      await createGeoResearchProjectForProduct({
        ...projectRequest,
        idempotencyKey: `auto-geo-project:${product.productId}:${hashV5GovernancePayload(projectRequest).slice(0, 16)}`,
        actor: input.actor
      });
      state = await getGeoResearchWorkspace(product.productId);
    }
    const blueprint = state.workspace?.currentBlueprint;
    if (blueprint?.status === "pending_review") {
      results.push({
        productId: product.productId,
        status: "research_synthesis_ready",
        detail: "GEO 调研综合稿已通过机器门禁，等待编译产品 GEO 策略包"
      });
      continue;
    }
    const openRun = state.workspace?.latestRun && !["completed", "failed", "cancelled"].includes(state.workspace.latestRun.status);
    const latestSnapshotHash = state.readiness.latestSourceSnapshot?.snapshotHash;
    if (openRun && latestSnapshotHash
      && state.workspace!.latestRun!.inputSourceSnapshotHash !== latestSnapshotHash) {
      await cancelStaleGeoResearchRunRecord({
        runId: state.workspace!.latestRun!.runId,
        productId: product.productId,
        replacementSourceSnapshotHash: latestSnapshotHash,
        actor: input.actor
      });
      state = await getGeoResearchWorkspace(product.productId);
    } else if (openRun) {
      results.push({ productId: product.productId, status: "running" });
      continue;
    }
    if (!state.readiness.canCreateRun || !state.workspace) {
      results.push({ productId: product.productId, status: "waiting_for_sources", detail: "等待知识库形成正式来源快照" });
      continue;
    }
    const latestRun = state.workspace.latestRun;
    const recent = latestRun && Date.now() - Date.parse(latestRun.updatedAt) < 30 * 24 * 60 * 60 * 1000;
    const failedAgainstCurrentSnapshot = recent
      && latestRun.status === "failed"
      && latestRun.inputSourceSnapshotHash === state.readiness.latestSourceSnapshot?.snapshotHash;
    if (failedAgainstCurrentSnapshot) {
      results.push({
        productId: product.productId,
        status: "requires_attention",
        detail: "当前资料快照上的 GEO 调研已失败；等待人工检查或授权任务重试，不自动创建重复 run"
      });
      continue;
    }
    if (recent && blueprint && ["pending_review", "approved"].includes(blueprint.status)) {
      results.push({ productId: product.productId, status: "monitoring", detail: "本轮调研在 30 天监控周期内" });
      continue;
    }
    await startGeoResearchRun({
      productId: product.productId,
      triggerType: latestRun ? "manual_refresh" : "product_onboarding",
      expectedProjectVersion: state.workspace.project.rowVersion,
      idempotencyKey: `auto-geo-run:${product.productId}:${state.readiness.latestSourceSnapshot!.snapshotHash}`,
      actor: input.actor
    });
    results.push({ productId: product.productId, status: "queued" });
  }
  return { products: results, queuedCount: results.filter((item) => item.status === "queued").length };
}

export async function requestGeoBlueprintChanges(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  reviewNote: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.blueprintVersionId, "blueprintVersionId", 64);
  assertText(input.reviewNote, "reviewNote", 2000);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError(
      "human_approval_required",
      "GEO 蓝图只能由人工退回修改。",
      403
    );
  }
  const allowedRoles = new Set(["content_growth", "knowledge_manager", "workbench_operator", "developer_admin"]);
  if (!allowedRoles.has(input.actor.actorRole)) {
    throw new V5GovernanceServiceError("forbidden", "当前角色无权评审 GEO 蓝图。", 403);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const write = await requestGeoBlueprintChangesRecord(input);
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}
