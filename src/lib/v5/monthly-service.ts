import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { channelLabels, productLabels } from "@/lib/labels";
import { createInitialWorkbenchState, normalizeWorkbenchState } from "@/lib/workbench-store";
import type { ProductPlanConfig, WorkspaceRole } from "@/lib/types";
import type {
  ArticleExpressionPresetOption,
  BatchGenerationSummary,
  ContentQuotaRule,
  ContentStrategyPackageRecord,
  KnowledgeBaseOption,
  MonthlyPlanConfig,
  MonthlyWorkspaceBase,
  PatchProductionDraftRequest,
  ProductionMatrixTask,
  RulePackageOption,
  ScheduleTaskRequest,
  SaveMonthlyPlanRequest,
  StrategyMutationRequest,
  StrategyPreflightResult,
  TargetQuestionOption,
  V5MonthlyPlanRecord,
  V5ReferenceSource
} from "./monthly-workspace-contracts";
import { readV5MonthlyState, updateV5MonthlyState } from "./monthly-repository";
import { loadMonthlyWorkspaceGovernance } from "./monthly-workspace-governance";
import { calculateExpandedDeliverableCount, evaluateStrategyPreflight, expandApprovedStrategyTasks } from "./monthly-strategy-policy";

export { calculateExpandedDeliverableCount, evaluateStrategyPreflight, expandApprovedStrategyTasks } from "./monthly-strategy-policy";

type WorkbenchState = ReturnType<typeof createInitialWorkbenchState>;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const WRITE_ROLES = new Set<WorkspaceRole>(["content_growth", "workbench_operator", "developer_admin"]);

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

function buildTargetQuestions(state: WorkbenchState, source: V5ReferenceSource): TargetQuestionOption[] {
  if (source !== "v4_runtime") return [];
  return state.distilledTerms
    .filter((term) => term.status === "active" && term.validationStatus !== "disabled" && term.sourceQuestion?.trim())
    .map((term) => ({
      questionVersionId: term.id,
      question: term.sourceQuestion!.trim(),
      productId: term.product,
      status: "monthly_ready" as const,
      source: "v4_adapter" as const
    }));
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

const expressionPresetAdapters: ArticleExpressionPresetOption[] = [
  { articleExpressionProfileVersionId: "v4-expression-professional-decision-v1", name: "专业决策型", summary: "面向企业决策者，强调条件、边界与可验证依据。", status: "active", source: "v4_adapter" },
  { articleExpressionProfileVersionId: "v4-expression-practical-guide-v1", name: "实用指南型", summary: "面向执行人员，强调步骤、前置条件与落地检查。", status: "active", source: "v4_adapter" },
  { articleExpressionProfileVersionId: "v4-expression-natural-explanation-v1", name: "自然科普型", summary: "面向通用读者，使用克制、易理解的说明方式。", status: "active", source: "v4_adapter" }
];

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
      ...Object.keys(monthlyState.scheduleDraftItems)
    ])
  );
  const month = selectMonth(requestedMonth, availableMonths);
  const plan = monthlyState.plans[month] || null;
  const strategyRows = monthlyState.strategyRows[month] || [];
  const batchQueueItems = monthlyState.batchQueueItems[month] || [];
  const exceptionItems = monthlyState.exceptionItems[month] || [];
  const scheduleDraftItems = monthlyState.scheduleDraftItems[month] || [];
  const hasPersistedMonthlyData = Boolean(
    plan || strategyRows.length || batchQueueItems.length || exceptionItems.length || scheduleDraftItems.length
  );
  const rulePackages = buildRulePackages(reference.state, reference.source);
  const targetQuestions = buildTargetQuestions(reference.state, reference.source);
  const knowledgeBases = buildKnowledgeBases(reference.state, reference.source);

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
    articleExpressionPresets: reference.source === "v4_runtime" ? expressionPresetAdapters : [],
    strategyPackage: plan?.strategyPackage || null,
    productionTasks: plan?.matrixTasks || [],
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
  expressionPresets: ArticleExpressionPresetOption[]
): MonthlyPlanConfig {
  const issues: string[] = [];
  const packageById = new Map(rulePackages.map((item) => [item.id, item]));
  const questionById = new Map(targetQuestions.map((item) => [item.questionVersionId, item]));
  const knowledgeById = new Map(knowledgeBases.map((item) => [item.knowledgeBaseId, item]));
  const expressionById = new Map(expressionPresets.map((item) => [item.articleExpressionProfileVersionId, item]));

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
    const selectedKnowledge = rule.knowledgeBaseIds.map((id) => knowledgeById.get(id));
    const channelEntries = Object.entries(rule.channelQuotas);
    if (!rule.quotaRuleId || quotaRuleIds.has(rule.quotaRuleId)) issues.push("每条配额必须使用唯一标识。");
    quotaRuleIds.add(rule.quotaRuleId);
    if (!question || question.question !== rule.question) issues.push("配额中的目标问题与已选问题版本不一致。");
    if (!rule.contentType.trim()) issues.push(`${rule.question || "目标问题"} 缺少文章类型。`);
    if (!channelEntries.length || channelEntries.some(([, quota]) => !Number.isInteger(quota) || quota < 1 || quota > 200)) {
      issues.push(`${rule.question || "目标问题"} 的每个渠道配额必须是 1 到 200 的整数。`);
    }
    if (!rulePackage || rulePackage.status !== "active" || !rulePackage.monthlyProductionReady) issues.push(`${rule.question || "目标问题"} 使用的规则包未达到生产准入。`);
    if (rulePackage && channelEntries.some(([channel]) => !rulePackage.allowedChannels.includes(channel))) issues.push(`${rule.question || "目标问题"} 包含规则包未允许的渠道。`);
    if (!rule.knowledgeBaseIds.length || selectedKnowledge.some((item) => !item || item.status !== "ready")) issues.push(`${rule.question || "目标问题"} 必须选择已就绪知识库。`);
    if (!expressionById.has(rule.articleExpressionProfileVersionId)) issues.push(`${rule.question || "目标问题"} 的文章表达预设不可用。`);
    const expandedDeliverableCount = calculateExpandedDeliverableCount(rule.channelQuotas);
    if (expandedDeliverableCount !== rule.expandedDeliverableCount) issues.push(`${rule.question || "目标问题"} 的渠道成品数计算不一致。`);
    const sourceHashes = [rule.sourceSnapshotHash, rule.rulePackageSourceSnapshotHash, rule.knowledgeIndexSourceSnapshotHash, rule.evidencePackSourceSnapshotHash];
    if (!sourceHashes[0] || new Set(sourceHashes).size !== 1) issues.push(`${rule.question || "目标问题"} 的策略包、知识索引和 EvidencePack 快照不一致。`);
    normalizedQuotaRules.push({
      ...rule,
      question: rule.question.trim(),
      contentType: rule.contentType.trim(),
      channelQuotas: Object.fromEntries(channelEntries),
      expandedDeliverableCount
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

function assertWritableRole(role: WorkspaceRole) {
  if (!WRITE_ROLES.has(role)) {
    throw new V5ServiceError(403, "MONTHLY_PLAN_FORBIDDEN", "当前角色无权修改月度计划，请切换到内容增长、工作台运营或开发管理员。");
  }
}

function assertIdempotencyKey(value: string | null) {
  const key = value?.trim() || "";
  if (key.length < 8 || key.length > 200) {
    throw new V5ServiceError(400, "INVALID_IDEMPOTENCY_KEY", "写请求必须携带 8 到 200 字符的 x-idempotency-key。");
  }
  return key;
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
  const role = reference.state.workspaceSetting.currentRole;
  assertWritableRole(role);
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
  const targetQuestions = buildTargetQuestions(reference.state, reference.source);
  const knowledgeBases = buildKnowledgeBases(reference.state, reference.source);
  const config = validateMonthlyPlan(request.config, month, rulePackages, targetQuestions, knowledgeBases, expressionPresetAdapters);

  const requestHash = createHash("sha256")
    .update(JSON.stringify({ month, expectedVersion: request.expectedVersion, config }))
    .digest("hex");
  const storageKey = `${month}:${idempotencyKey}`;

  return updateV5MonthlyState((state) => {
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
    if (current?.strategyPackage && ["approved", "partially_approved"].includes(current.strategyPackage.status)) {
      throw new V5ServiceError(409, "APPROVED_STRATEGY_LOCKED", "已批准月度策略不能修改，请创建新的策略版本。", ["批量生成中心不会反向修改已批准策略字段。"]);
    }

    const now = new Date().toISOString();
    const previousStrategy = current?.strategyPackage;
    const strategyPackage: ContentStrategyPackageRecord = {
      strategyPackageId: previousStrategy?.strategyPackageId || `strategy-${month}-${randomUUID()}`,
      version: (previousStrategy?.version || 0) + 1,
      status: "draft",
      targetDeliverableCount: config.targetDeliverableCount || 0,
      quotaRules: config.quotaRules || [],
      preflightResults: [],
      createdAt: previousStrategy?.createdAt || now,
      updatedAt: now
    };
    const record: V5MonthlyPlanRecord = {
      id: current?.id || `monthly-plan-${month}`,
      version: currentVersion + 1,
      status: current?.status || "draft",
      config,
      createdAt: current?.createdAt || now,
      createdBy: current?.createdBy || role,
      updatedAt: now,
      updatedBy: role,
      strategyPackage,
      matrixTasks: []
    };

    state.plans[month] = record;
    state.auditLog.unshift({
      id: randomUUID(),
      event: "monthly_plan_saved",
      month,
      actor: role,
      version: record.version,
      createdAt: now
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
  const reference = await readV4Reference();
  assertWritableRole(reference.state.workspaceSetting.currentRole);
  return reference.state.workspaceSetting.currentRole;
}

export async function preflightV5Strategy(month: string, request: StrategyMutationRequest) {
  assertMonth(month);
  assertStrategyMutationRequest(request);
  const actor = await getWritableActor();
  return updateV5MonthlyState((state) => {
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
  const actor = await getWritableActor();
  return updateV5MonthlyState((state) => {
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
  return { expectedVersion: Number(value.expectedVersion), auditReason: String(value.auditReason || "") };
}

export function parseScheduleTaskRequest(value: unknown): ScheduleTaskRequest {
  if (!isRecord(value)) throw new V5ServiceError(400, "INVALID_REQUEST", "排程请求格式不正确。");
  return {
    expectedVersion: Number(value.expectedVersion),
    scheduledAt: String(value.scheduledAt || ""),
    platformAccount: String(value.platformAccount || "").trim(),
    auditReason: String(value.auditReason || "").trim()
  };
}

export async function scheduleV5ProductionTask(month: string, taskId: string, request: ScheduleTaskRequest) {
  assertMonth(month);
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) throw new V5ServiceError(400, "INVALID_EXPECTED_VERSION", "排程版本号不正确。");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(request.scheduledAt) || Number.isNaN(Date.parse(request.scheduledAt))) throw new V5ServiceError(422, "INVALID_SCHEDULE_TIME", "请选择有效的发布日期和时间。");
  if (!request.platformAccount || request.platformAccount.length > 120) throw new V5ServiceError(422, "INVALID_PLATFORM_ACCOUNT", "请选择 120 个字符以内的平台账号。");
  if (!request.auditReason || request.auditReason.length > 200) throw new V5ServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的排程原因。");
  const actor = await getWritableActor();
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
