import type { V5MonthlyPlan } from "./monthly-contracts";
import { getMonthlyWorkspaceBase } from "./monthly-service";
import type {
  MonthlyPlanConfig,
  MonthlyWorkspaceReadModel,
  RulePackageOption,
  V5MonthlyPlanRecord
} from "./monthly-workspace-contracts";
import { loadMonthlyWorkspaceGovernance } from "./monthly-workspace-governance";
import { hasV5GovernanceDatabaseConfig } from "./knowledge-governance-repository";
import { readFormalProductionQueue } from "./single-article-production-repository";

function readGoalText(plan: V5MonthlyPlan, key: string) {
  const value = plan.goals[key];
  return typeof value === "string" ? value : "";
}

function toWorkspacePlanConfig(plan: V5MonthlyPlan, rulePackages: RulePackageOption[]): MonthlyPlanConfig {
  const configuredChannels = Object.keys(plan.channelMix);
  return {
    month: plan.month,
    businessGoal: readGoalText(plan, "businessGoal"),
    groups: Object.entries(plan.productQuotas).map(([productId, articleQuota]) => {
      const rulePackage = rulePackages.find((item) => item.productId === productId);
      const selectedChannels = rulePackage
        ? rulePackage.allowedChannels.filter((channel) => configuredChannels.includes(channel))
        : configuredChannels;
      return {
        groupQuotaId: `formal-${plan.monthlyPlanId}-${productId}`,
        rulePackageVersionId: rulePackage?.id || "pending_config",
        productId,
        productName: rulePackage?.productName || productId,
        selectedChannels: selectedChannels.length ? selectedChannels : rulePackage?.allowedChannels || [],
        articleQuota
      };
    })
  };
}

function toWorkspacePlanRecord(plan: V5MonthlyPlan, rulePackages: RulePackageOption[]): V5MonthlyPlanRecord {
  const actor = plan.approvedBy || "v5_backend";
  const timestamp = plan.approvedAt || "";
  return {
    id: plan.monthlyPlanId,
    version: plan.version,
    status: plan.status === "completed" ? "completed" : plan.status === "in_execution" ? "running" : plan.status === "approved" ? "confirmed" : "draft",
    config: toWorkspacePlanConfig(plan, rulePackages),
    createdAt: timestamp,
    createdBy: actor,
    updatedAt: timestamp,
    updatedBy: actor
  };
}

export async function getMonthlyWorkspaceReadModel(requestedMonth?: string): Promise<MonthlyWorkspaceReadModel> {
  const base = await getMonthlyWorkspaceBase(requestedMonth);
  const [governance, productionQueue] = await Promise.all([
    loadMonthlyWorkspaceGovernance(base.month, base.rulePackages, base.plan?.id),
    loadFormalQueue(base.month)
  ]);
  const formalPlanRecord = governance.monthlyPlan ? toWorkspacePlanRecord(governance.monthlyPlan, governance.rulePackages) : null;
  const plan = formalPlanRecord || base.plan;
  const adaptedRulePackages = governance.source === "v5_mysql" || base.source.referenceData !== "v4_runtime"
    ? governance.rulePackages
    : base.rulePackages;

  return {
    ...base,
    batchQueueItems: productionQueue.items,
    plan,
    draftPlan: plan?.config || base.draftPlan,
    rulePackages: adaptedRulePackages,
    source: {
      ...base.source,
      monthlyData: plan ? "persisted" : base.source.monthlyData,
      governanceData: governance.source,
      productionQueue: productionQueue.source
    },
    formal: {
      monthlyPlan: governance.monthlyPlan,
      productionReadiness: governance.productionReadiness,
      productionPoolEntries: governance.productionPoolEntries,
      message: [governance.message, productionQueue.message].filter(Boolean).join(" ") || undefined
    }
  };
}

async function loadFormalQueue(month: string): Promise<{
  items: MonthlyWorkspaceReadModel["batchQueueItems"];
  source: MonthlyWorkspaceReadModel["source"]["productionQueue"];
  message?: string;
}> {
  if (!hasV5GovernanceDatabaseConfig()) {
    return { items: [], source: "pending_config", message: "正式生产队列需要独立 MySQL 配置。" };
  }
  try {
    return { items: await readFormalProductionQueue(month), source: "v5_mysql" };
  } catch (error) {
    return { items: [], source: "failed", message: error instanceof Error ? error.message : "正式生产队列读取失败。" };
  }
}
