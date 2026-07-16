import type { V5MonthlyPlan } from "./monthly-contracts";
import { getMonthlyWorkspaceBase } from "./monthly-service";
import type {
  MonthlyPlanConfig,
  MonthlyWorkspaceReadModel,
  RulePackageOption,
  V5MonthlyPlanRecord
} from "./monthly-workspace-contracts";
import { loadMonthlyWorkspaceGovernance } from "./monthly-workspace-governance";

function readGoalText(plan: V5MonthlyPlan, key: string) {
  const value = plan.goals[key];
  return typeof value === "string" ? value : "";
}

function readGoalNumber(plan: V5MonthlyPlan, key: string, fallback: number) {
  const value = plan.goals[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toWorkspacePlanConfig(plan: V5MonthlyPlan, rulePackages: RulePackageOption[]): MonthlyPlanConfig {
  const configuredChannels = Object.keys(plan.channelMix);
  return {
    month: plan.month,
    businessGoal: readGoalText(plan, "businessGoal"),
    baselineRatio: readGoalNumber(plan, "baselineRatio", 20),
    ratioAdjustmentReason: readGoalText(plan, "ratioAdjustmentReason"),
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
  const governance = await loadMonthlyWorkspaceGovernance(base.month, base.rulePackages, base.plan?.id);
  const formalPlanRecord = governance.monthlyPlan ? toWorkspacePlanRecord(governance.monthlyPlan, governance.rulePackages) : null;
  const plan = formalPlanRecord || base.plan;

  return {
    ...base,
    plan,
    draftPlan: plan?.config || base.draftPlan,
    rulePackages: governance.rulePackages,
    source: {
      ...base.source,
      monthlyData: plan ? "persisted" : base.source.monthlyData,
      governanceData: governance.source
    },
    formal: {
      monthlyPlan: governance.monthlyPlan,
      productionReadiness: governance.productionReadiness,
      productionPoolEntries: governance.productionPoolEntries,
      message: governance.message
    }
  };
}
