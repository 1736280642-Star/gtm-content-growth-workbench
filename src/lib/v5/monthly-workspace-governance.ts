import { getV5MonthlyProductionPool } from "./knowledge-governance-production-pool-service";
import { hasV5GovernanceDatabaseConfig } from "./knowledge-governance-repository";
import { getV5MonthlyProductionReadiness } from "./knowledge-governance-service";
import { getV5MonthlyPlan } from "./monthly-plan-service";
import type { V5MonthlyPlan, V5MonthlyProductionReadiness, V5ProductionPoolEntry } from "./monthly-contracts";
import type { RulePackageOption, V5GovernanceSource } from "./monthly-workspace-contracts";

export interface MonthlyWorkspaceGovernanceSnapshot {
  source: V5GovernanceSource;
  rulePackages: RulePackageOption[];
  monthlyPlan: V5MonthlyPlan | null;
  productionReadiness: V5MonthlyProductionReadiness[];
  productionPoolEntries: V5ProductionPoolEntry[];
  message?: string;
}

function markPendingConfig(rulePackages: RulePackageOption[], message: string): MonthlyWorkspaceGovernanceSnapshot {
  return {
    source: "pending_config",
    rulePackages: rulePackages.map((item) => ({
      ...item,
      monthlyProductionReady: false,
      readinessSource: "pending_config",
      disabledReason: message
    })),
    monthlyPlan: null,
    productionReadiness: [],
    productionPoolEntries: [],
    message
  };
}

function isFormalReadiness(value: unknown): value is V5MonthlyProductionReadiness {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<V5MonthlyProductionReadiness>;
  return Boolean(candidate.readinessId && candidate.productId && candidate.rulePackageVersionId);
}

export async function loadMonthlyWorkspaceGovernance(
  month: string,
  rulePackages: RulePackageOption[],
  monthlyPlanId?: string
): Promise<MonthlyWorkspaceGovernanceSnapshot> {
  if (!hasV5GovernanceDatabaseConfig()) {
    return markPendingConfig(rulePackages, "正式 V5 治理数据库未配置，不能确认 G6 月度生产准备度。");
  }

  try {
    const [monthlyPlanResult, readinessResults]: [
      Awaited<ReturnType<typeof getV5MonthlyPlan>>,
      Array<V5MonthlyProductionReadiness | undefined>
    ] = await Promise.all([
      getV5MonthlyPlan(month),
      Promise.all(
        rulePackages.map(async (rulePackage): Promise<V5MonthlyProductionReadiness | undefined> => {
          const result = await getV5MonthlyProductionReadiness(rulePackage.productId);
          const data: unknown = result.data;
          return isFormalReadiness(data) ? data : undefined;
        })
      )
    ]);
    const productionReadiness = readinessResults.filter((item): item is V5MonthlyProductionReadiness => item !== undefined);
    const readinessByProduct = new Map(productionReadiness.map((item) => [item.productId, item]));
    const governedRulePackages = rulePackages.map((item) => {
      const readiness = readinessByProduct.get(item.productId);
      if (!readiness) {
        return {
          ...item,
          monthlyProductionReady: false,
          readinessSource: "v5_governance" as const,
          disabledReason: "正式 V5 后端尚未生成该产品的 G6 MonthlyProductionReadiness。"
        };
      }

      const approved = readiness.monthlyProductionReady && readiness.status === "approved" && Boolean(readiness.approvedAt && readiness.approvedBy);
      return {
        ...item,
        id: readiness.rulePackageVersionId,
        status: approved ? "active" as const : item.status,
        monthlyProductionReady: approved,
        allowedChannels: readiness.allowedChannels.length ? readiness.allowedChannels : item.allowedChannels,
        readinessSource: "v5_governance" as const,
        disabledReason: approved
          ? undefined
          : readiness.reasonCodes.length
            ? `G6 未通过：${readiness.reasonCodes.join("、")}。`
            : "G6 准备度尚未由人工 Owner 批准。"
      };
    });

    const productionPoolPlanId = monthlyPlanResult.data?.monthlyPlanId || monthlyPlanId;
    const productionPoolEntries = productionPoolPlanId
      ? (
          await Promise.all(
            governedRulePackages.map(async (item) => {
              const result = await getV5MonthlyProductionPool({ productId: item.productId, monthlyPlanId: productionPoolPlanId });
              return result.data.entries as V5ProductionPoolEntry[];
            })
          )
        ).flat()
      : [];

    return {
      source: "v5_mysql",
      rulePackages: governedRulePackages,
      monthlyPlan: monthlyPlanResult.data,
      productionReadiness,
      productionPoolEntries
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "正式 V5 治理数据读取失败。";
    return {
      source: "failed",
      rulePackages: rulePackages.map((item) => ({
        ...item,
        monthlyProductionReady: false,
        readinessSource: "pending_config",
        disabledReason: `${message} 请检查正式 Repository / Service 与 MySQL Schema。`
      })),
      monthlyPlan: null,
      productionReadiness: [],
      productionPoolEntries: [],
      message
    };
  }
}
