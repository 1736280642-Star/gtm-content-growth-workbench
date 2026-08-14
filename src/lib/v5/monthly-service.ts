import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { channelLabels, productLabels } from "@/lib/labels";
import { createInitialWorkbenchState, normalizeWorkbenchState } from "@/lib/workbench-store";
import type { ProductPlanConfig } from "@/lib/types";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import type {
  BatchGenerationSummary,
  ContentQuotaRule,
  ContentStrategyPackageRecord,
  KnowledgeBaseOption,
  MonthlyPlanConfig,
  MonthlyWorkspaceBase,
  PatchProductionDraftRequest,
  ProductionMatrixTask,
  RulePackageOption,
  SavePublishResultRequest,
  ScheduleTaskRequest,
  SaveMonthlyPlanRequest,
  StrategyMutationRequest,
  StrategyPreflightResult,
  TargetQuestionOption,
  V5MonthlyPlanRecord,
  V5ReferenceSource
} from "./monthly-workspace-contracts";
import type { ArticleTypeProfileVersion, QuestionTypeMatchRun } from "./article-type-contracts";
import {
  getArticleTypeVersionsByIds,
  getLatestQuestionTypeMatchRun,
  getQuestionTypeMatchRun,
  listArticleTypeProfiles
} from "./article-type-service";
import { readV5FoundationSnapshot } from "./foundation-repository";
import { getV5GovernancePool, parseV5Json, V5GovernanceRepositoryError } from "./knowledge-governance-repository";
import { readV5MonthlyState, updateV5MonthlyState } from "./monthly-repository";
import { loadMonthlyWorkspaceGovernance } from "./monthly-workspace-governance";
import { persistFormalApprovedStrategy, persistFormalMonthlyPlan, removeFormalProductionTasks, saveFormalPublishResult, scheduleFormalProductionTask } from "./monthly-execution-repository";
import { readV5MonthlyPlanRecord } from "./monthly-plan-repository";
import { calculateExpandedDeliverableCount, evaluateStrategyPreflight, expandApprovedStrategyTasks } from "./monthly-strategy-policy";

export { calculateExpandedDeliverableCount, evaluateStrategyPreflight, expandApprovedStrategyTasks } from "./monthly-strategy-policy";

type WorkbenchState = ReturnType<typeof createInitialWorkbenchState>;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class V5ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = "V5ServiceError";
  }
}

function resolveV4StatePath() {
  const configuredPath = process.env.WORKBENCH_STATE_PATH?.trim();
  return path.resolve(process.cwd(), configuredPath || "data/workbench-state.json");
}

let cachedV4Reference:
  | { statePath: string; mtimeMs: number; size: number; state: WorkbenchState; source: V5ReferenceSource }
  | undefined;

async function readV4Reference(): Promise<{ state: WorkbenchState; source: V5ReferenceSource }> {
  const statePath = resolveV4StatePath();
  try {
    const fileInfo = await stat(statePath);
    if (cachedV4Reference?.statePath === statePath && cachedV4Reference.mtimeMs === fileInfo.mtimeMs && cachedV4Reference.size === fileInfo.size) {
      return cachedV4Reference;
    }

    const raw = await readFile(statePath, "utf8");
    cachedV4Reference = {
      statePath,
      mtimeMs: fileInfo.mtimeMs,
      size: fileInfo.size,
      state: normalizeWorkbenchState(JSON.parse(raw) as Partial<WorkbenchState>),
      source: "v4_runtime"
    };
    return cachedV4Reference;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: createInitialWorkbenchState(), source: "seed_fallback" };
    }

    throw new V5ServiceError(500, "V4_STATE_READ_FAILED", "无法读取 V4 工作台状态，请检查 WORKBENCH_STATE_PATH 和状态文件格式。");
  }
}

function getDefaultMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function assertMonth(month: string) {
  if (!MONTH_PATTERN.test(month)) {
    throw new V5ServiceError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM。");
  }
}

function getProductPlan(knowledgeBaseId: string, rulePackageId: string, plans: ProductPlanConfig[]) {
  return plans.find(
    (plan) =>
      plan.productExpressionRulePackageId === rulePackageId ||
      plan.knowledgeBaseId === knowledgeBaseId ||
      plan.knowledgeBaseIds?.includes(knowledgeBaseId)
  );
}

function buildRulePackages(state: WorkbenchState, source: V5ReferenceSource): RulePackageOption[] {
  const plans = state.workspaceSetting.productPlans || [];
  const fallbackChannels = state.workspaceSetting.enabledChannels.map((channel) => channelLabels[channel]);

  return state.knowledgeBases.flatMap((knowledgeBase) => {
    const draft = knowledgeBase.productExpressionRuleDraft;
    if (!draft) return [];

    const productPlan = getProductPlan(knowledgeBase.id, draft.id, plans);
    const productId = productPlan?.product || knowledgeBase.id;
    const productName = productPlan ? productLabels[productPlan.product] : knowledgeBase.name;
    const enabledChunkCount = (knowledgeBase.chunks || []).filter((chunk) => chunk.status === "enabled").length;
    const allowedChannels = productPlan?.channels?.length
      ? productPlan.channels.map((channel) => channelLabels[channel])
      : fallbackChannels;
    const readinessIssues = [
      source === "seed_fallback" ? "未连接真实 V4 工作台状态" : "",
      draft.status !== "active" ? `规则包状态为 ${draft.status}` : "",
      knowledgeBase.status !== "enabled" ? "知识库未启用" : "",
      enabledChunkCount === 0 ? "没有可用知识条目" : "",
      !productPlan ? "未关联产品计划" : "",
      productPlan && !productPlan.enabled ? "产品计划未启用" : ""
    ].filter(Boolean);

    return [
      {
        id: draft.id,
        productId,
        productName,
        version: draft.version,
        status: draft.status === "archived" ? "deprecated" : draft.status,
        monthlyProductionReady: readinessIssues.length === 0,
        allowedChannels: Array.from(new Set(allowedChannels)),
        disabledReason: readinessIssues.length ? `${readinessIssues.join("；")}。` : undefined,
        readinessSource: source === "v4_runtime" ? "derived_v4" : "seed_fallback",
        knowledgeBaseIds: [knowledgeBase.id],
        sourceSnapshotHash: createHash("sha256")
          .update(JSON.stringify((knowledgeBase.chunks || []).filter((chunk) => chunk.status === "enabled")))
          .digest("hex")
      } satisfies RulePackageOption
    ];
  });
}

function buildTargetQuestions(state: WorkbenchState, source: V5ReferenceSource, month: string, snapshots: ContentQuotaRule[] = []): TargetQuestionOption[] {
  const foundation = readV5FoundationSnapshot();
  const monthlyLocks = foundation.monthlyQuestionLocks.filter((lock) => lock.month === month);

  // A monthly lock is a historical snapshot. New selectable questions must
  // come from the human-confirmed GEO monitoring pool below.
  const versionsById = new Map(foundation.questionVersions.map((version) => [version.questionVersionId, version]));
  const toOption = (questionId: string, questionVersionId: string, status: TargetQuestionOption["status"]): TargetQuestionOption | undefined => {
    const version = versionsById.get(questionVersionId);
    if (!version || version.questionId !== questionId || !version.text.trim()) return undefined;
    return {
      questionVersionId: version.questionVersionId,
      question: version.text.trim(),
      productId: version.product,
      status,
      source: "v5_formal"
    };
  };

  const locked = monthlyLocks.map((lock) => {
      const option = toOption(lock.questionId, lock.questionVersionId, "frozen");
      if (!option) {
        throw new V5ServiceError(
          500,
          "V5_MONTHLY_QUESTION_VERSION_MISSING",
          `月度目标问题 ${lock.questionId} 的锁定版本不存在或引用不一致。`,
          ["请检查 V5 Foundation Repository 中的 monthlyQuestionLocks 和 questionVersions。"]
        );
      }

      return option;
    });
  const currentFormal = foundation.questions.flatMap((question) => {
    if (!question.currentVersionId || question.geoMonitoringApproval?.status !== "approved" || !["available", "observing"].includes(question.status)) return [];
    const option = toOption(question.questionId, question.currentVersionId, "monthly_ready");
    return option ? [option] : [];
  });
  const frozenSnapshots = snapshots
    .filter((rule) => rule.questionVersionId.trim() && rule.question.trim())
    .map((rule) => ({
      questionVersionId: rule.questionVersionId,
      question: rule.question.trim(),
      status: "frozen" as const,
      source: "v5_formal" as const
    }));
  return Array.from(new Map([...frozenSnapshots, ...currentFormal, ...locked].map((item) => [item.questionVersionId, item])).values());
}

function buildKnowledgeBases(state: WorkbenchState, source: V5ReferenceSource): KnowledgeBaseOption[] {
  if (source !== "v4_runtime") return [];
  return state.knowledgeBases.map((knowledgeBase) => {
    const productPlan = getProductPlan(knowledgeBase.id, knowledgeBase.productExpressionRuleDraft?.id || "", state.workspaceSetting.productPlans || []);
    const enabledChunks = (knowledgeBase.chunks || []).filter((chunk) => chunk.status === "enabled");
    return {
      knowledgeBaseId: knowledgeBase.id,
      name: knowledgeBase.name,
      productId: productPlan?.product,
      sourceSnapshotHash: createHash("sha256").update(JSON.stringify(enabledChunks)).digest("hex"),
      status: knowledgeBase.status === "enabled" && enabledChunks.length ? "ready" as const : "pending_config" as const,
      source: "v4_adapter" as const
    };
  });
}

function buildDraftPlan(month: string): MonthlyPlanConfig {
  return {
    month,
    businessGoal: "",
    targetDeliverableCount: 0,
    questionVersionIds: [],
    quotaRules: [],
    groups: []
  };
}

function selectMonth(requestedMonth: string | undefined, availableMonths: string[]) {
  if (requestedMonth) {
    assertMonth(requestedMonth);
    return requestedMonth;
  }

  return [...availableMonths].sort().at(-1) || getDefaultMonth();
}

export async function getMonthlyWorkspaceBase(requestedMonth?: string): Promise<MonthlyWorkspaceBase> {
  const [monthlyState, reference] = await Promise.all([readV5MonthlyState(), readV4Reference()]);
  const availableMonths = Array.from(
    new Set([
      ...Object.keys(monthlyState.plans),
      ...Object.keys(monthlyState.strategyRows),
      ...Object.keys(monthlyState.batchQueueItems),
      ...Object.keys(monthlyState.exceptionItems),
      ...Object.keys(monthlyState.scheduleDraftItems),
      ...Object.keys(monthlyState.generationBatches)
    ])
  );
  const month = selectMonth(requestedMonth, availableMonths);
  const plan = monthlyState.plans[month] || null;
  const strategyRows = monthlyState.strategyRows[month] || [];
  const batchQueueItems = monthlyState.batchQueueItems[month] || [];
  const exceptionItems = monthlyState.exceptionItems[month] || [];
  const scheduleDraftItems = monthlyState.scheduleDraftItems[month] || [];
  const generationBatches = monthlyState.generationBatches[month] || [];
  const hasPersistedMonthlyData = Boolean(
    plan || strategyRows.length || batchQueueItems.length || exceptionItems.length || scheduleDraftItems.length || generationBatches.length
  );
  const rulePackages = buildRulePackages(reference.state, reference.source);
  const targetQuestions = buildTargetQuestions(reference.state, reference.source, month, plan?.config.quotaRules || []);
  const knowledgeBases = buildKnowledgeBases(reference.state, reference.source);
  const [articleTypeProfiles, typeMatchRun] = await Promise.all([
    listArticleTypeProfiles(),
    getLatestQuestionTypeMatchRun(month)
  ]);

  return {
    schemaVersion: 1,
    month,
    plan,
    draftPlan: plan?.config || buildDraftPlan(month),
    rulePackages,
    channels: reference.state.workspaceSetting.enabledChannels.map((channel) => channelLabels[channel]),
    strategyRows,
    batchQueueItems,
    exceptionItems,
    scheduleDraftItems,
    targetQuestions,
    knowledgeBases,
    articleTypeProfiles,
    typeMatchRun,
    strategyPackage: plan?.strategyPackage || null,
    productionTasks: plan?.matrixTasks || [],
    generationBatches,
    source: {
      monthlyData: hasPersistedMonthlyData ? "persisted" : "empty",
      referenceData: reference.source
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseSaveMonthlyPlanRequest(value: unknown): SaveMonthlyPlanRequest {
  if (!isRecord(value) || !isRecord(value.config) || !Number.isInteger(value.expectedVersion)) {
    throw new V5ServiceError(400, "INVALID_REQUEST", "请求必须包含 config 和整数 expectedVersion。");
  }

  return value as unknown as SaveMonthlyPlanRequest;
}

function validateMonthlyPlan(
  config: MonthlyPlanConfig,
  month: string,
  rulePackages: RulePackageOption[],
  targetQuestions: TargetQuestionOption[],
  knowledgeBases: KnowledgeBaseOption[],
  articleTypeVersions: ArticleTypeProfileVersion[],
  matchRuns: Map<string, QuestionTypeMatchRun>
): MonthlyPlanConfig {
  const issues: string[] = [];
  const packageById = new Map(rulePackages.map((item) => [item.id, item]));
  const questionById = new Map(targetQuestions.map((item) => [item.questionVersionId, item]));
  const knowledgeById = new Map(knowledgeBases.map((item) => [item.knowledgeBaseId, item]));
  const articleTypeById = new Map(articleTypeVersions.map((item) => [item.profileVersionId, item]));

  if (!isRecord(config)) {
    throw new V5ServiceError(400, "INVALID_MONTHLY_PLAN", "月度计划配置格式不正确。");
  }

  if (config.month !== month || !MONTH_PATTERN.test(config.month)) issues.push("配置月份必须与接口路径月份一致。");
  if (typeof config.businessGoal !== "string" || !config.businessGoal.trim()) issues.push("请填写月度业务目标。");
  if (typeof config.businessGoal === "string" && config.businessGoal.length > 160) issues.push("月度业务目标不能超过 160 个字符。");
  if (!Number.isInteger(config.targetDeliverableCount) || Number(config.targetDeliverableCount) < 1 || Number(config.targetDeliverableCount) > 1000) {
    issues.push("月度渠道成品总数必须是 1 到 1000 的整数。");
  }
  if (!Array.isArray(config.questionVersionIds) || config.questionVersionIds.length === 0) issues.push("至少选择 1 个目标问题。");
  if ((config.questionVersionIds || []).some((id) => !questionById.has(id))) issues.push("目标问题必须来自当前可用于月度计划的问题版本。");
  if (!Array.isArray(config.quotaRules) || config.quotaRules.length === 0) issues.push("至少配置 1 条目标问题配额。");
  if ((config.quotaRules || []).length > 100) issues.push("单个月度计划最多包含 100 条配额。");

  const quotaRuleIds = new Set<string>();
  const normalizedQuotaRules: ContentQuotaRule[] = [];
  for (const rule of config.quotaRules || []) {
    const rulePackage = packageById.get(rule.rulePackageVersionId);
    const question = questionById.get(rule.questionVersionId);
    const articleTypeVersion = articleTypeById.get(rule.articleTypeProfileVersionId);
    const matchRun = matchRuns.get(rule.typeMatchRunId);
    const matchedSuggestion = matchRun?.suggestions.find((item) =>
      item.questionVersionId === rule.questionVersionId
      && item.articleTypeProfileVersionId === rule.articleTypeProfileVersionId
      && (item.selectionStatus === "accepted" || item.selectionStatus === "manual_added")
    );
    const selectedKnowledge = rule.knowledgeBaseIds.map((id) => knowledgeById.get(id));
    const channelEntries = Object.entries(rule.channelQuotas);
    if (!rule.quotaRuleId || quotaRuleIds.has(rule.quotaRuleId)) issues.push("每条配额必须使用唯一标识。");
    quotaRuleIds.add(rule.quotaRuleId);
    if (!question || question.question !== rule.question) issues.push("配额中的目标问题与已选问题版本不一致。");
    if (rulePackage && question?.productId && rulePackage.productId !== question.productId) issues.push(`${rule.question || "目标问题"} 的目标问题与产品规则包不属于同一产品。`);
    if (!articleTypeVersion) issues.push(`${rule.question || "目标问题"} 使用的内容类型版本不存在。`);
    if (articleTypeVersion && (rule.contentType !== articleTypeVersion.name || rule.articleTypeNameSnapshot !== articleTypeVersion.name)) {
      issues.push(`${rule.question || "目标问题"} 的内容类型名称快照与版本不一致。`);
    }
    if (articleTypeVersion && (rule.articleTypePromptConstraintSnapshotHash !== articleTypeVersion.promptConstraintSnapshotHash || rule.articleTypePromptConstraintSnapshot !== articleTypeVersion.promptConstraintSnapshot)) {
      issues.push(`${rule.question || "目标问题"} 的内容类型 Prompt 约束快照不一致。`);
    }
    if (!matchRun || matchRun.status !== "confirmed" || !matchedSuggestion) issues.push(`${rule.question || "目标问题"} 的内容类型匹配尚未人工确认。`);
    if (matchedSuggestion && (rule.typeSelectionSource !== matchedSuggestion.selectionSource || rule.matchReasonSnapshot !== matchedSuggestion.reason)) {
      issues.push(`${rule.question || "目标问题"} 的匹配来源或推荐理由快照不一致。`);
    }
    if (!channelEntries.length || channelEntries.some(([, quota]) => !Number.isInteger(quota) || quota < 1 || quota > 200)) {
      issues.push(`${rule.question || "目标问题"} 的每个渠道配额必须是 1 到 200 的整数。`);
    }
    if (!rulePackage || rulePackage.status !== "active" || !rulePackage.monthlyProductionReady) issues.push(`${rule.question || "目标问题"} 使用的规则包未达到生产准入。`);
    if (rulePackage && channelEntries.some(([channel]) => !rulePackage.allowedChannels.includes(channel))) issues.push(`${rule.question || "目标问题"} 包含规则包未允许的渠道。`);
    if (!rule.knowledgeBaseIds.length || selectedKnowledge.some((item) => !item || item.status !== "ready")) issues.push(`${rule.question || "目标问题"} 必须选择已就绪知识库。`);
    const expandedDeliverableCount = calculateExpandedDeliverableCount(rule.channelQuotas);
    if (expandedDeliverableCount !== rule.expandedDeliverableCount) issues.push(`${rule.question || "目标问题"} 的渠道成品数计算不一致。`);
    const sourceHashes = [rule.sourceSnapshotHash, rule.rulePackageSourceSnapshotHash, rule.knowledgeIndexSourceSnapshotHash, rule.evidencePackSourceSnapshotHash];
    if (!sourceHashes[0] || new Set(sourceHashes).size !== 1) issues.push(`${rule.question || "目标问题"} 的策略包、知识索引和 EvidencePack 快照不一致。`);
    normalizedQuotaRules.push({
      quotaRuleId: rule.quotaRuleId,
      productId: rulePackage?.productId || rule.productId || question?.productId,
      productNameSnapshot: rulePackage?.productName || rule.productNameSnapshot,
      questionVersionId: rule.questionVersionId,
      question: rule.question.trim(),
      contentType: rule.contentType.trim(),
      articleTypeProfileVersionId: rule.articleTypeProfileVersionId,
      articleTypeNameSnapshot: rule.articleTypeNameSnapshot,
      typeMatchRunId: rule.typeMatchRunId,
      typeSelectionSource: rule.typeSelectionSource,
      matchReasonSnapshot: rule.matchReasonSnapshot,
      articleTypePromptConstraintSnapshot: rule.articleTypePromptConstraintSnapshot,
      articleTypePromptConstraintSnapshotHash: rule.articleTypePromptConstraintSnapshotHash,
      sameQuotaForAllChannels: Boolean(rule.sameQuotaForAllChannels),
      perChannelQuota: Number(rule.perChannelQuota),
      channelQuotas: Object.fromEntries(channelEntries),
      expandedDeliverableCount,
      rulePackageVersionId: rule.rulePackageVersionId,
      knowledgeBaseIds: Array.from(new Set(rule.knowledgeBaseIds)),
      sourceSnapshotHash: rule.sourceSnapshotHash,
      rulePackageSourceSnapshotHash: rule.rulePackageSourceSnapshotHash,
      knowledgeIndexSourceSnapshotHash: rule.knowledgeIndexSourceSnapshotHash,
      evidencePackSourceSnapshotHash: rule.evidencePackSourceSnapshotHash
    });
  }

  const allocatedTotal = normalizedQuotaRules.reduce((total, rule) => total + rule.expandedDeliverableCount, 0);
  if (allocatedTotal > Number(config.targetDeliverableCount || 0)) issues.push("已分配渠道成品数不能超过月度总数。");
  if (issues.length) throw new V5ServiceError(422, "MONTHLY_PLAN_VALIDATION_FAILED", "月度计划未通过服务端校验。", issues);

  return {
    month: config.month,
    businessGoal: config.businessGoal.trim(),
    targetDeliverableCount: config.targetDeliverableCount,
    questionVersionIds: Array.from(new Set(config.questionVersionIds)),
    quotaRules: normalizedQuotaRules,
    groups: []
  };
}

function assertIdempotencyKey(value: string | null) {
  const key = value?.trim() || "";
  if (key.length < 8 || key.length > 200) {
    throw new V5ServiceError(400, "INVALID_IDEMPOTENCY_KEY", "写请求必须携带 8 到 200 字符的 x-idempotency-key。");
  }
  return key;
}

async function loadProductStrategyMonthlyReferences(
  month: string,
  quotaRules: ContentQuotaRule[],
  articleTypeVersionIds: string[],
  matchRunIds: string[]
) {
  const strategyMatchRunIds = matchRunIds.filter((id) => id.startsWith("product-strategy:"));
  const strategyPackIds = strategyMatchRunIds.map((id) => id.slice("product-strategy:".length)).filter(Boolean);
  if (!strategyPackIds.length || !articleTypeVersionIds.length) {
    return { articleTypeVersions: [] as ArticleTypeProfileVersion[], matchRuns: [] as Array<readonly [string, QuestionTypeMatchRun]> };
  }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT atv.*, sp.status AS strategy_status, sp.strategy_approved_by, sp.strategy_approved_at
     FROM product_strategy_article_type_versions atv
     JOIN product_strategy_packs sp ON sp.id = atv.strategy_pack_id
     WHERE atv.strategy_pack_id IN (?) AND atv.article_type_version_id IN (?)
       AND atv.status IN ('active', 'frozen') AND sp.status = 'production_ready'`,
    [strategyPackIds, articleTypeVersionIds]
  );
  const rowByVersionId = new Map(rows.map((row) => [String(row.article_type_version_id), row]));
  const now = new Date().toISOString();
  const articleTypeVersions = rows.map<ArticleTypeProfileVersion>((row) => {
    const definition = parseV5Json<Record<string, unknown>>(row.definition_json, {});
    const modules = Array.isArray(definition.structureModules) ? definition.structureModules : [];
    const moduleNames = modules.flatMap((module) => {
      if (typeof module === "string") return [module];
      if (!module || typeof module !== "object") return [];
      const record = module as Record<string, unknown>;
      return [String(record.label || record.key || record.purpose || "").trim()].filter(Boolean);
    });
    const range = definition.lengthRange && typeof definition.lengthRange === "object"
      ? definition.lengthRange as Record<string, unknown>
      : {};
    const snapshot = typeof row.definition_json === "string" ? row.definition_json : JSON.stringify(definition);
    return {
      profileVersionId: String(row.article_type_version_id),
      profileId: String(row.article_type_id || `product-strategy-type-${row.portfolio_item_id}`),
      version: 1,
      name: String(row.name),
      semanticDescription: String(definition.definition || ""),
      suitableQuestionDescription: Array.isArray(definition.suitableFor) ? definition.suitableFor.join("；") : "",
      unsuitableQuestionDescription: Array.isArray(definition.notSuitableFor) ? definition.notSuitableFor.join("；") : "",
      targetAudience: Array.isArray(definition.targetAudience) ? definition.targetAudience.map(String) : [],
      contentGoal: String(definition.contentGoal || ""),
      structureModules: moduleNames,
      requiredSections: moduleNames,
      cta: "",
      lengthRange: {
        min: Number(range.min || 800),
        max: Number(range.max || 3000),
        unit: "字" as ArticleTypeProfileVersion["lengthRange"]["unit"]
      },
      styleTraits: Array.isArray(definition.styleTraits) ? definition.styleTraits.map(String) : [],
      caseUsage: "",
      evidencePreferences: Array.isArray(definition.evidencePreferences) ? definition.evidencePreferences.map(String) : [],
      channelHints: [],
      exampleQuestions: [],
      promptConstraintSnapshot: snapshot,
      promptConstraintSnapshotHash: String(row.definition_hash),
      fieldSources: {},
      status: "active",
      createdBy: String(row.strategy_approved_by || "product-strategy-reviewer"),
      createdAt: row.strategy_approved_at ? new Date(row.strategy_approved_at).toISOString() : now
    };
  });
  const matchRuns = strategyMatchRunIds.flatMap((matchRunId) => {
    const packId = matchRunId.slice("product-strategy:".length);
    const rules = quotaRules.filter((rule) => rule.typeMatchRunId === matchRunId && rowByVersionId.get(rule.articleTypeProfileVersionId)?.strategy_pack_id === packId);
    if (!rules.length) return [];
    const suggestions = rules.map((rule, index) => ({
      suggestionId: `${matchRunId}:${index + 1}`,
      questionVersionId: rule.questionVersionId,
      question: rule.question,
      articleTypeProfileVersionId: rule.articleTypeProfileVersionId,
      articleTypeName: rule.articleTypeNameSnapshot,
      fitLevel: "high" as const,
      semanticScore: 1,
      reason: rule.matchReasonSnapshot,
      matchedFacets: ["approved_product_strategy"],
      missingInformation: [],
      conflictProfileVersionIds: [],
      selectionStatus: "accepted" as const,
      selectionSource: "user_selected" as const
    }));
    return [[matchRunId, {
      matchRunId,
      month,
      revision: 1,
      status: "confirmed" as const,
      questionVersionIds: suggestions.map((item) => item.questionVersionId),
      provider: "product_geo_strategy",
      promptVersion: "product-geo-strategy.v2",
      suggestions,
      confirmedAt: now,
      confirmedBy: "product-strategy-reviewer",
      createdAt: now,
      createdBy: "product-strategy-reviewer",
      auditReason: "复用用户已确认的产品 GEO 策略文章类型组合"
    }] as const];
  });
  return { articleTypeVersions, matchRuns };
}

export async function saveV5MonthlyPlan(
  month: string,
  request: SaveMonthlyPlanRequest,
  idempotencyHeader: string | null
): Promise<V5MonthlyPlanRecord> {
  assertMonth(month);
  const idempotencyKey = assertIdempotencyKey(idempotencyHeader);
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 0) {
    throw new V5ServiceError(400, "INVALID_EXPECTED_VERSION", "expectedVersion 必须是大于等于 0 的整数。");
  }

  const reference = await readV4Reference();
  const mutationSource = request.mutationSource === "system_policy" ? "system_policy" : "human";
  const actor = mutationSource === "system_policy" ? "monthly-strategy-policy" : WORKSPACE_ACTOR.actorId;
  const candidateRulePackages = buildRulePackages(reference.state, reference.source);
  const governance = await loadMonthlyWorkspaceGovernance(month, candidateRulePackages, `monthly-plan-${month}`);
  if (governance.source !== "v5_mysql" && reference.source !== "v4_runtime") {
    throw new V5ServiceError(
      503,
      "V5_GOVERNANCE_PENDING_CONFIG",
      governance.message || "正式 V5 治理数据不可用，且现有正式接口适配层不可用，不能保存月度计划。"
    );
  }
  const rulePackages = governance.source === "v5_mysql" ? governance.rulePackages : candidateRulePackages;
  const targetQuestions = buildTargetQuestions(reference.state, reference.source, month, request.config.quotaRules || []);
  const knowledgeBases = Array.from(
    new Map(
      [...buildKnowledgeBases(reference.state, reference.source), ...governance.knowledgeBases]
        .map((item) => [item.knowledgeBaseId, item])
    ).values()
  );
  const referencedArticleTypeIds = Array.from(new Set((request.config.quotaRules || []).map((rule) => rule.articleTypeProfileVersionId).filter(Boolean)));
  const referencedMatchRunIds = Array.from(new Set((request.config.quotaRules || []).map((rule) => rule.typeMatchRunId).filter(Boolean)));
  const [baseArticleTypeVersions, baseMatchRunEntries, productStrategyReferences] = await Promise.all([
    getArticleTypeVersionsByIds(referencedArticleTypeIds),
    Promise.all(referencedMatchRunIds.filter((id) => !id.startsWith("product-strategy:")).map(async (id) => [id, await getQuestionTypeMatchRun(id)] as const)),
    loadProductStrategyMonthlyReferences(month, request.config.quotaRules || [], referencedArticleTypeIds, referencedMatchRunIds)
  ]);
  const articleTypeVersions = [...baseArticleTypeVersions, ...productStrategyReferences.articleTypeVersions];
  const matchRunEntries = [...baseMatchRunEntries, ...productStrategyReferences.matchRuns];
  const config = validateMonthlyPlan(
    request.config,
    month,
    rulePackages,
    targetQuestions,
    knowledgeBases,
    articleTypeVersions,
    new Map(matchRunEntries.filter((entry): entry is readonly [string, QuestionTypeMatchRun] => Boolean(entry[1])))
  );

  const requestHash = createHash("sha256")
    .update(JSON.stringify({ month, expectedVersion: request.expectedVersion, config }))
    .digest("hex");
  const storageKey = `${month}:${idempotencyKey}`;

  return updateV5MonthlyState(async (state) => {
    const previousRequest = state.idempotency[storageKey];
    if (previousRequest) {
      if (previousRequest.requestHash !== requestHash) {
        throw new V5ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同请求，请刷新页面后重试。");
      }
      return previousRequest.response as V5MonthlyPlanRecord;
    }

    const current = state.plans[month];
    const currentVersion = current?.version || 0;
    if (currentVersion !== request.expectedVersion) {
      throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", `月度计划已更新到版本 ${currentVersion}，请刷新后再保存。`);
    }
    const versionedEdit = Boolean(current?.strategyPackage && ["approved", "partially_approved"].includes(current.strategyPackage.status));

    const now = new Date().toISOString();
    const previousStrategy = current?.strategyPackage;
    if (versionedEdit && previousStrategy) {
      state.strategyHistory[month] = [previousStrategy, ...(state.strategyHistory[month] || [])];
    }
    const strategyPackage: ContentStrategyPackageRecord = {
      strategyPackageId: versionedEdit ? `strategy-${month}-${randomUUID()}` : previousStrategy?.strategyPackageId || `strategy-${month}-${randomUUID()}`,
      version: (previousStrategy?.version || 0) + 1,
      status: "draft",
      targetDeliverableCount: config.targetDeliverableCount || 0,
      quotaRules: config.quotaRules || [],
      preflightResults: [],
      createdAt: versionedEdit ? now : previousStrategy?.createdAt || now,
      updatedAt: now
    };
    const record: V5MonthlyPlanRecord = {
      id: current?.id || `monthly-plan-${month}`,
      version: currentVersion + 1,
      status: versionedEdit ? "draft" : current?.status || "draft",
      config,
      createdAt: current?.createdAt || now,
      createdBy: current?.createdBy || actor,
      updatedAt: now,
      updatedBy: actor,
      strategyPackage,
      matrixTasks: versionedEdit ? current?.matrixTasks || [] : []
    };

    state.plans[month] = record;
    await persistFormalMonthlyPlan(record, {
      actorId: `local-${actor}`,
      actorRole: actor,
      actorType: mutationSource === "system_policy" ? "scheduler" : "human",
      auditReason: mutationSource === "system_policy" ? "系统根据知识库、调研结果和问题池生成月度策略" : "保存月度计划正式草稿"
    }, versionedEdit ? "preserve" : "draft");
    state.auditLog.unshift({
      id: randomUUID(),
      event: "monthly_plan_saved",
      month,
      actor,
      version: record.version,
      createdAt: now,
      summary: versionedEdit ? {
        mode: "next_version",
        previousStrategyPackageId: previousStrategy?.strategyPackageId,
        retainedTaskCount: current?.matrixTasks?.length || 0,
        retainedPublishedTaskCount: current?.matrixTasks?.filter((task) => task.status === "published").length || 0
      } : { mode: "draft", mutationSource }
    });
    state.idempotency[storageKey] = { requestHash, response: record, createdAt: now };

    return record;
  });
}

function assertStrategyMutationRequest(request: StrategyMutationRequest) {
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) {
    throw new V5ServiceError(400, "INVALID_EXPECTED_VERSION", "expectedVersion 必须是大于 0 的整数。");
  }
  if (!request.auditReason?.trim() || request.auditReason.trim().length > 200) {
    throw new V5ServiceError(400, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的操作原因。");
  }
}

async function getWritableActor() {
  return WORKSPACE_ACTOR.actorId;
}

function getStrategyMutationActor(request: StrategyMutationRequest) {
  const systemPolicy = request.mutationSource === "system_policy";
  const actor = systemPolicy ? "monthly-strategy-policy" : WORKSPACE_ACTOR.actorId;
  return {
    actor,
    formalActor: {
      actorId: `local-${actor}`,
      actorRole: actor,
      actorType: systemPolicy ? "scheduler" as const : "human" as const,
      auditReason: request.auditReason.trim()
    }
  };
}

export async function preflightV5Strategy(month: string, request: StrategyMutationRequest) {
  assertMonth(month);
  assertStrategyMutationRequest(request);
  const { actor, formalActor } = getStrategyMutationActor(request);
  return updateV5MonthlyState(async (state) => {
    const plan = state.plans[month];
    if (!plan?.strategyPackage) throw new V5ServiceError(404, "STRATEGY_NOT_FOUND", "请先保存月度计划和内容策略配置。");
    if (plan.version !== request.expectedVersion) throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", "月度计划已更新，请刷新后重试。");
    if (["approved", "partially_approved"].includes(plan.strategyPackage.status)) {
      throw new V5ServiceError(409, "APPROVED_STRATEGY_LOCKED", "已批准月度策略不能重新预检或修改。");
    }
    const now = new Date().toISOString();
    const preflightResults = plan.strategyPackage.quotaRules.map((rule) => evaluateStrategyPreflight(rule));
    plan.version += 1;
    plan.updatedAt = now;
    plan.updatedBy = actor;
    plan.strategyPackage = { ...plan.strategyPackage, status: "preview_ready", preflightResults, updatedAt: now };
    await persistFormalMonthlyPlan(plan, formalActor, "pending_strategy_review");
    state.auditLog.unshift({
      id: randomUUID(), event: "strategy_preflight_completed", month, actor, version: plan.version,
      createdAt: now, auditReason: request.auditReason.trim(), objectId: plan.strategyPackage.strategyPackageId,
      summary: { generatable: preflightResults.filter((item) => item.status === "generatable").length }
    });
    return plan;
  });
}

export async function approveV5Strategy(month: string, request: StrategyMutationRequest) {
  assertMonth(month);
  assertStrategyMutationRequest(request);
  const { actor, formalActor } = getStrategyMutationActor(request);
  return updateV5MonthlyState(async (state) => {
    const plan = state.plans[month];
    const strategy = plan?.strategyPackage;
    if (!plan || !strategy) throw new V5ServiceError(404, "STRATEGY_NOT_FOUND", "请先保存并预检内容策略包。");
    if (plan.version !== request.expectedVersion) throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", "月度计划已更新，请刷新后重试。");
    if (strategy.status !== "preview_ready") throw new V5ServiceError(409, "STRATEGY_PREFLIGHT_REQUIRED", "批准前必须运行最新一次生产预检。");
    const allocatedTotal = strategy.quotaRules.reduce((total, rule) => total + rule.expandedDeliverableCount, 0);
    if (allocatedTotal !== strategy.targetDeliverableCount) {
      throw new V5ServiceError(422, "STRATEGY_QUOTA_UNBALANCED", "批准前，已分配渠道成品数必须等于月度总数。", [`当前 ${allocatedTotal}，目标 ${strategy.targetDeliverableCount}。`]);
    }
    if (strategy.preflightResults.some((item) => item.status === "configuration_error")) {
      throw new V5ServiceError(422, "STRATEGY_CONFIGURATION_BLOCKED", "存在配置错误，不能批准策略包。");
    }
    const now = new Date().toISOString();
    const hasAwaitingMaterial = strategy.preflightResults.some((item) => item.status === "awaiting_material");
    const approvedStrategy: ContentStrategyPackageRecord = {
      ...strategy,
      status: hasAwaitingMaterial ? "partially_approved" : "approved",
      approvedAt: now,
      approvedBy: actor,
      approvalReason: request.auditReason.trim(),
      updatedAt: now
    };
    plan.version += 1;
    plan.status = "confirmed";
    plan.updatedAt = now;
    plan.updatedBy = actor;
    plan.strategyPackage = approvedStrategy;
    plan.matrixTasks = expandApprovedStrategyTasks({ monthlyPlanId: plan.id, strategyPackage: approvedStrategy, now });
    await persistFormalApprovedStrategy(plan, formalActor);
    state.auditLog.unshift({
      id: randomUUID(), event: "strategy_approved", month, actor, version: plan.version, createdAt: now,
      auditReason: request.auditReason.trim(), objectId: strategy.strategyPackageId,
      summary: { taskCount: plan.matrixTasks.length, partial: hasAwaitingMaterial }
    });
    return plan;
  });
}

export function parseStrategyMutationRequest(value: unknown): StrategyMutationRequest {
  if (!isRecord(value)) throw new V5ServiceError(400, "INVALID_REQUEST", "请求格式不正确。");
  return {
    expectedVersion: Number(value.expectedVersion),
    auditReason: String(value.auditReason || ""),
    mutationSource: value.mutationSource === "system_policy" ? "system_policy" : "human"
  };
}

export function parseScheduleTaskRequest(value: unknown): ScheduleTaskRequest {
  if (!isRecord(value)) throw new V5ServiceError(400, "INVALID_REQUEST", "排程请求格式不正确。");
  return {
    expectedVersion: Number(value.expectedVersion),
    scheduledAt: String(value.scheduledAt || ""),
    platformAccount: String(value.platformAccount || "").trim(),
    auditReason: String(value.auditReason || "").trim(),
    mutationSource: value.mutationSource === "system_policy" ? "system_policy" : "human"
  };
}

export function parseSavePublishResultRequest(value: unknown): SavePublishResultRequest {
  if (!isRecord(value) || !isRecord(value.metrics)) throw new V5ServiceError(400, "INVALID_REQUEST", "发布结果请求格式不正确。");
  const status = String(value.status || "");
  if (!["published", "failed", "manual_takeover"].includes(status)) throw new V5ServiceError(422, "INVALID_PUBLISH_STATUS", "发布状态不正确。");
  return {
    expectedVersion: Number(value.expectedVersion),
    status: status as SavePublishResultRequest["status"],
    publicUrl: String(value.publicUrl || "").trim() || undefined,
    externalContentId: String(value.externalContentId || "").trim() || undefined,
    failureReason: String(value.failureReason || "").trim() || undefined,
    metrics: Object.fromEntries(Object.entries(value.metrics).filter(([, metric]) => typeof metric === "number" || typeof metric === "string")) as Record<string, number | string>,
    auditReason: String(value.auditReason || "").trim()
  };
}

export async function saveV5PublishResult(taskId: string, request: SavePublishResultRequest) {
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 0) throw new V5ServiceError(422, "INVALID_EXPECTED_VERSION", "发布结果版本号不正确。");
  if (!request.auditReason || request.auditReason.length > 200) throw new V5ServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的回传原因。");
  if (request.status === "published" && !/^https?:\/\//i.test(request.publicUrl || "")) throw new V5ServiceError(422, "PUBLIC_URL_REQUIRED", "确认发布时必须填写可访问的 http(s) URL。");
  if (request.status !== "published" && !request.failureReason?.trim()) throw new V5ServiceError(422, "FAILURE_REASON_REQUIRED", "失败或人工接管必须填写原因。");
  const actor = await getWritableActor();
  try {
    return await saveFormalPublishResult({
      taskId,
      request,
      actor: { actorId: `local-${actor}`, actorRole: actor, actorType: "human", auditReason: request.auditReason }
    });
  } catch (error) {
    if (!(error instanceof V5GovernanceRepositoryError) || error.code !== "formal_task_not_found") throw error;
    return updateV5MonthlyState((state) => {
      const entry = Object.entries(state.plans).find(([, plan]) => (plan.matrixTasks || []).some((task) => task.taskId === taskId));
      if (!entry) throw error;
      const [month, plan] = entry;
      const taskIndex = (plan.matrixTasks || []).findIndex((task) => task.taskId === taskId);
      const task = plan.matrixTasks![taskIndex];
      const currentVersion = task.publishResultVersion || 0;
      if (currentVersion !== request.expectedVersion) {
        throw new V5ServiceError(409, "PUBLISH_RESULT_VERSION_CONFLICT", `发布结果当前 version 为 ${currentVersion}。`);
      }
      const now = new Date().toISOString();
      plan.matrixTasks![taskIndex] = {
        ...task,
        status: request.status === "published" ? "published" : "scheduled",
        publishResultVersion: currentVersion + 1,
        publicUrl: request.status === "published" ? request.publicUrl : undefined,
        externalContentId: request.externalContentId,
        failureReason: request.status === "published" ? undefined : request.failureReason,
        updatedAt: now
      };
      plan.status = plan.matrixTasks!.every((item) => item.status === "published") ? "completed" : "running";
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.auditLog.unshift({
        id: randomUUID(),
        event: "publish_result_saved",
        month,
        actor,
        version: plan.version,
        createdAt: now,
        auditReason: request.auditReason,
        objectId: taskId,
        summary: { status: request.status, hasPublicUrl: Boolean(request.publicUrl), source: "restored_monthly_snapshot" }
      });
      return {
        publishResultId: `restored-${taskId}`,
        taskId,
        status: request.status,
        version: currentVersion + 1,
        publicUrl: request.publicUrl,
        metrics: request.metrics
      };
    });
  }
}

export async function scheduleV5ProductionTask(month: string, taskId: string, request: ScheduleTaskRequest) {
  assertMonth(month);
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) throw new V5ServiceError(400, "INVALID_EXPECTED_VERSION", "排程版本号不正确。");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(request.scheduledAt) || Number.isNaN(Date.parse(request.scheduledAt))) throw new V5ServiceError(422, "INVALID_SCHEDULE_TIME", "请选择有效的发布日期和时间。");
  if (!request.platformAccount || request.platformAccount.length > 120) throw new V5ServiceError(422, "INVALID_PLATFORM_ACCOUNT", "请选择 120 个字符以内的平台账号。");
  if (!request.auditReason || request.auditReason.length > 200) throw new V5ServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的排程原因。");
  const systemPolicy = request.mutationSource === "system_policy";
  const actor = systemPolicy ? "monthly-schedule-policy" : await getWritableActor();
  const formalPlan = await readV5MonthlyPlanRecord(month);
  if (formalPlan) {
    return scheduleFormalProductionTask({
      month,
      taskId,
      request,
      actor: { actorId: `local-${actor}`, actorRole: actor, actorType: systemPolicy ? "scheduler" : "human", auditReason: request.auditReason }
    });
  }
  return updateV5MonthlyState((state) => {
    const plan = state.plans[month];
    if (!plan || plan.version !== request.expectedVersion) throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", "月度计划已更新，请刷新后重新排程。");
    const tasks = plan.matrixTasks || [];
    const index = tasks.findIndex((item) => item.taskId === taskId);
    if (index < 0) throw new V5ServiceError(404, "PRODUCTION_TASK_NOT_FOUND", "内容任务不存在。");
    if (!tasks[index].lastUsableDraft || !["available", "scheduled"].includes(tasks[index].status)) {
      throw new V5ServiceError(422, "TASK_NOT_AVAILABLE", "只有系统检查通过且保留可用正文的任务可以排程。");
    }
    const now = new Date().toISOString();
    tasks[index] = { ...tasks[index], status: "scheduled", scheduledAt: request.scheduledAt, platformAccount: request.platformAccount, updatedAt: now };
    plan.matrixTasks = tasks;
    plan.version += 1;
    plan.updatedAt = now;
    plan.updatedBy = actor;
    state.auditLog.unshift({ id: randomUUID(), event: "schedule_saved", month, actor, version: plan.version, createdAt: now, auditReason: request.auditReason, objectId: taskId, summary: { scheduledAt: request.scheduledAt, platformAccount: request.platformAccount } });
    return plan;
  });
}

export async function removeV5StrategyItem(month: string, quotaRuleId: string, request: StrategyMutationRequest) {
  assertMonth(month);
  assertStrategyMutationRequest(request);
  const actor = await getWritableActor();
  return updateV5MonthlyState((state) => {
    const plan = state.plans[month];
    const strategy = plan?.strategyPackage;
    if (!plan || !strategy) throw new V5ServiceError(404, "STRATEGY_NOT_FOUND", "当前月份没有可删除的内容策略项。");
    if (plan.version !== request.expectedVersion) throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", "月度计划已更新，请刷新后重试。");
    const rule = strategy.quotaRules.find((item) => item.quotaRuleId === quotaRuleId);
    if (!rule) throw new V5ServiceError(404, "STRATEGY_ITEM_NOT_FOUND", "策略项不存在或已被移除。");
    const affectedTasks = (plan.matrixTasks || []).filter((task) => task.quotaRuleId === quotaRuleId);
    const publishedCount = affectedTasks.filter((task) => task.status === "published").length;
    const versioned = ["approved", "partially_approved"].includes(strategy.status) || affectedTasks.length > 0;
    const now = new Date().toISOString();
    if (versioned) state.strategyHistory[month] = [strategy, ...(state.strategyHistory[month] || [])];
    plan.strategyPackage = {
      ...strategy,
      strategyPackageId: versioned ? `strategy-${month}-${randomUUID()}` : strategy.strategyPackageId,
      version: versioned ? strategy.version + 1 : strategy.version,
      status: "draft",
      targetDeliverableCount: Math.max(0, strategy.targetDeliverableCount - rule.expandedDeliverableCount),
      quotaRules: strategy.quotaRules.filter((item) => item.quotaRuleId !== quotaRuleId),
      preflightResults: strategy.preflightResults.filter((item) => item.quotaRuleId !== quotaRuleId),
      approvedAt: undefined,
      approvedBy: undefined,
      approvalReason: undefined,
      updatedAt: now
    };
    plan.config = { ...plan.config, targetDeliverableCount: plan.strategyPackage.targetDeliverableCount, quotaRules: plan.strategyPackage.quotaRules, questionVersionIds: Array.from(new Set(plan.strategyPackage.quotaRules.map((item) => item.questionVersionId))) };
    plan.version += 1; plan.updatedAt = now; plan.updatedBy = actor;
    state.auditLog.unshift({ id: randomUUID(), event: "strategy_item_removed", month, actor, version: plan.version, createdAt: now, auditReason: request.auditReason, objectId: quotaRuleId, summary: { mode: versioned ? "next_version" : "direct", affectedTaskCount: affectedTasks.length, publishedCount } });
    return { mode: versioned ? "next_version" : "direct", affectedTaskCount: affectedTasks.length, publishedCount };
  });
}

export async function removeV5ProductionTasks(month: string, taskIds: string[], request: StrategyMutationRequest) {
  assertMonth(month);
  assertStrategyMutationRequest(request);
  const normalizedIds = Array.from(new Set(taskIds.map(String).filter(Boolean)));
  if (!normalizedIds.length) throw new V5ServiceError(422, "TASK_IDS_REQUIRED", "至少选择 1 篇文章任务。");
  const actor = await getWritableActor();
  const formalPlan = await readV5MonthlyPlanRecord(month);
  if (formalPlan) {
    const result = await removeFormalProductionTasks({
      month,
      taskIds: normalizedIds,
      expectedVersion: request.expectedVersion,
      actor: { actorId: `local-${actor}`, actorRole: actor, actorType: "human", auditReason: request.auditReason }
    });
    await updateV5MonthlyState((state) => {
      const plan = state.plans[month];
      if (!plan) return;
      const removed = (plan.matrixTasks || []).filter((task) => normalizedIds.includes(task.taskId));
      state.removedTasks[month] = [...removed, ...(state.removedTasks[month] || [])];
      plan.matrixTasks = (plan.matrixTasks || []).filter((task) => !normalizedIds.includes(task.taskId));
      plan.version = result.planVersion;
      plan.updatedAt = new Date().toISOString();
      plan.updatedBy = actor;
      state.auditLog.unshift({ id: randomUUID(), event: "production_tasks_removed", month, actor, version: plan.version, createdAt: plan.updatedAt, auditReason: request.auditReason, summary: { taskIds: normalizedIds, archived: result.archived, deleted: result.deleted, formal: true } });
    });
    const target = Number(formalPlan.workspaceConfig?.targetDeliverableCount || formalPlan.publishFrequency?.targetDeliverableCount || 0);
    return { archived: result.archived, deleted: result.deleted, quotaGap: Math.max(0, target - result.remaining) };
  }
  return updateV5MonthlyState((state) => {
    const plan = state.plans[month];
    if (!plan) throw new V5ServiceError(404, "MONTHLY_PLAN_NOT_FOUND", "当前月份没有可操作的月度计划。");
    if (plan.version !== request.expectedVersion) throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", "月度计划已更新，请刷新后重试。");
    const removed = (plan.matrixTasks || []).filter((task) => normalizedIds.includes(task.taskId));
    if (!removed.length) throw new V5ServiceError(404, "PRODUCTION_TASK_NOT_FOUND", "所选文章任务不存在或已删除。");
    const archived = removed.filter((task) => task.status === "published").length;
    state.removedTasks[month] = [...removed, ...(state.removedTasks[month] || [])];
    plan.matrixTasks = (plan.matrixTasks || []).filter((task) => !normalizedIds.includes(task.taskId));
    const now = new Date().toISOString();
    plan.version += 1; plan.updatedAt = now; plan.updatedBy = actor;
    const quotaGap = Math.max(0, Number(plan.strategyPackage?.targetDeliverableCount || 0) - plan.matrixTasks.length);
    state.auditLog.unshift({ id: randomUUID(), event: "production_tasks_removed", month, actor, version: plan.version, createdAt: now, auditReason: request.auditReason, summary: { taskIds: normalizedIds, archived, deleted: removed.length - archived, quotaGap, scheduleCancelled: removed.filter((task) => task.status === "scheduled").length, draftInvalidated: removed.filter((task) => Boolean(task.currentDraft || task.lastUsableDraft || task.formalDraftId)).length } });
    return { archived, deleted: removed.length - archived, quotaGap };
  });
}
