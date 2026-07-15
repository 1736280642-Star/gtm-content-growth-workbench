import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { channelLabels, productLabels } from "@/lib/labels";
import { createInitialWorkbenchState, normalizeWorkbenchState } from "@/lib/workbench-store";
import type { ProductPlanConfig, WorkspaceRole } from "@/lib/types";
import type {
  MonthlyPlanConfig,
  RulePackageOption,
  SaveMonthlyPlanRequest,
  V5MonthlyPlanRecord,
  V5MonthlyWorkspace,
  V5ReferenceSource
} from "./monthly-workspace-contracts";
import { readV5MonthlyState, updateV5MonthlyState } from "./monthly-repository";

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
        readinessSource: source === "v4_runtime" ? "derived_v4" : "seed_fallback"
      } satisfies RulePackageOption
    ];
  });
}

function buildDraftPlan(month: string): MonthlyPlanConfig {
  return {
    month,
    businessGoal: "",
    baselineRatio: 20,
    ratioAdjustmentReason: "",
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

export async function getV5MonthlyWorkspace(requestedMonth?: string): Promise<V5MonthlyWorkspace> {
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

  return {
    schemaVersion: 1,
    month,
    plan,
    draftPlan: plan?.config || buildDraftPlan(month),
    rulePackages: buildRulePackages(reference.state, reference.source),
    channels: reference.state.workspaceSetting.enabledChannels.map((channel) => channelLabels[channel]),
    strategyRows,
    batchQueueItems,
    exceptionItems,
    scheduleDraftItems,
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

function validateMonthlyPlan(config: MonthlyPlanConfig, month: string, rulePackages: RulePackageOption[]): MonthlyPlanConfig {
  const issues: string[] = [];
  const packageById = new Map(rulePackages.map((item) => [item.id, item]));

  if (!isRecord(config)) {
    throw new V5ServiceError(400, "INVALID_MONTHLY_PLAN", "月度计划配置格式不正确。");
  }

  if (config.month !== month || !MONTH_PATTERN.test(config.month)) issues.push("配置月份必须与接口路径月份一致。");
  if (typeof config.businessGoal !== "string" || !config.businessGoal.trim()) issues.push("请填写月度业务目标。");
  if (typeof config.businessGoal === "string" && config.businessGoal.length > 160) issues.push("月度业务目标不能超过 160 个字符。");
  if (!Number.isInteger(config.baselineRatio) || config.baselineRatio < 0 || config.baselineRatio > 100) issues.push("GEO 基线比例必须是 0 到 100 的整数。");
  if (config.baselineRatio !== 20 && (typeof config.ratioAdjustmentReason !== "string" || !config.ratioAdjustmentReason.trim())) {
    issues.push("调整默认 20/80 测试比例时必须填写原因。");
  }
  if (typeof config.ratioAdjustmentReason !== "string" || config.ratioAdjustmentReason.length > 300) {
    issues.push("测试比例调整原因必须是 300 个字符以内的文本。");
  }
  if (!Array.isArray(config.groups) || config.groups.length === 0) issues.push("至少选择 1 个可进入生产池的规则包。");
  if (Array.isArray(config.groups) && config.groups.length > 50) issues.push("单个月度计划最多包含 50 个产品分组。");

  const selectedPackageIds = new Set<string>();
  let totalQuota = 0;
  for (const group of Array.isArray(config.groups) ? config.groups : []) {
    if (!isRecord(group)) {
      issues.push("产品分组格式不正确。");
      continue;
    }

    const rulePackage = packageById.get(String(group.rulePackageVersionId || ""));
    if (typeof group.groupQuotaId !== "string" || !group.groupQuotaId.trim() || group.groupQuotaId.length > 120) {
      issues.push("每个产品分组必须包含 120 个字符以内的 groupQuotaId。");
    }
    if (!rulePackage) {
      issues.push(`规则包 ${String(group.rulePackageVersionId || "未填写")} 不存在于当前真实数据源。`);
      continue;
    }
    if (!rulePackage.monthlyProductionReady || rulePackage.status !== "active") {
      issues.push(`${rulePackage.productName} ${rulePackage.version} 尚未达到月度生产准入。`);
    }
    if (selectedPackageIds.has(rulePackage.id)) issues.push(`规则包 ${rulePackage.id} 不能重复配置。`);
    selectedPackageIds.add(rulePackage.id);
    if (group.productId !== rulePackage.productId || group.productName !== rulePackage.productName) {
      issues.push(`${rulePackage.productName} 的产品信息与规则包不一致。`);
    }
    if (!Array.isArray(group.selectedChannels) || group.selectedChannels.length === 0) {
      issues.push(`${rulePackage.productName} 至少选择 1 个发布渠道。`);
    } else if (group.selectedChannels.some((channel) => typeof channel !== "string" || !rulePackage.allowedChannels.includes(channel))) {
      issues.push(`${rulePackage.productName} 包含规则包未允许的发布渠道。`);
    }
    if (!Number.isInteger(group.articleQuota) || group.articleQuota < 1 || group.articleQuota > 200) {
      issues.push(`${rulePackage.productName} 的文章数量必须是 1 到 200 的整数。`);
    } else {
      totalQuota += group.articleQuota;
    }
  }

  if (totalQuota > 1000) issues.push("单个月度计划的文章总量不能超过 1000 篇。");
  if (issues.length) throw new V5ServiceError(422, "MONTHLY_PLAN_VALIDATION_FAILED", "月度计划未通过服务端校验。", issues);

  return {
    month: config.month,
    businessGoal: config.businessGoal.trim(),
    baselineRatio: config.baselineRatio,
    ratioAdjustmentReason: config.ratioAdjustmentReason.trim(),
    groups: config.groups.map((group) => ({
      groupQuotaId: group.groupQuotaId.trim(),
      rulePackageVersionId: group.rulePackageVersionId,
      productId: group.productId,
      productName: group.productName,
      selectedChannels: Array.from(new Set(group.selectedChannels)),
      articleQuota: group.articleQuota
    }))
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
  const rulePackages = buildRulePackages(reference.state, reference.source);
  const config = validateMonthlyPlan(request.config, month, rulePackages);

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
      return previousRequest.response;
    }

    const current = state.plans[month];
    const currentVersion = current?.version || 0;
    if (currentVersion !== request.expectedVersion) {
      throw new V5ServiceError(409, "MONTHLY_PLAN_VERSION_CONFLICT", `月度计划已更新到版本 ${currentVersion}，请刷新后再保存。`);
    }

    const now = new Date().toISOString();
    const record: V5MonthlyPlanRecord = {
      id: current?.id || `monthly-plan-${month}`,
      version: currentVersion + 1,
      status: current?.status || "draft",
      config,
      createdAt: current?.createdAt || now,
      createdBy: current?.createdBy || role,
      updatedAt: now,
      updatedBy: role
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
