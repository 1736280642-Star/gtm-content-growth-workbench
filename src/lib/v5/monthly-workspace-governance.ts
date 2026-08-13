import { getV5MonthlyProductionPool } from "./knowledge-governance-production-pool-service";
import {
  hasV5GovernanceDatabaseConfig,
  readV5ReadinessContext
} from "./knowledge-governance-repository";
import { getV5MonthlyProductionReadiness } from "./knowledge-governance-service";
import { getV5MonthlyPlan } from "./monthly-plan-service";
import type {
  V5MonthlyPlan,
  V5MonthlyProductionReadiness,
  V5ProductionPoolEntry
} from "./monthly-contracts";
import type {
  KnowledgeBaseOption,
  RulePackageOption,
  V5GovernanceSource
} from "./monthly-workspace-contracts";
import { listProducts } from "./product-registry-service";

export interface MonthlyWorkspaceGovernanceSnapshot {
  source: V5GovernanceSource;
  rulePackages: RulePackageOption[];
  knowledgeBases: KnowledgeBaseOption[];
  monthlyPlan: V5MonthlyPlan | null;
  productionReadiness: V5MonthlyProductionReadiness[];
  productionPoolEntries: V5ProductionPoolEntry[];
  message?: string;
}

function markPendingConfig(
  rulePackages: RulePackageOption[],
  message: string
): MonthlyWorkspaceGovernanceSnapshot {
  return {
    source: "pending_config",
    rulePackages: rulePackages.map((item) => ({
      ...item,
      monthlyProductionReady: false,
      readinessSource: "pending_config",
      disabledReason: message
    })),
    knowledgeBases: [],
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
    return markPendingConfig(
      rulePackages,
      "正式 V5 治理数据库未配置，不能确认 G6 月度生产准备度。"
    );
  }

  try {
    const products = await listProducts();
    const candidateByProduct = new Map(rulePackages.map((item) => [item.productId, item]));
    const productById = new Map(products.map((item) => [item.productId, item]));
    const productIds = Array.from(new Set([...candidateByProduct.keys(), ...productById.keys()]));

    const [monthlyPlanResult, readinessAndContextResults] = await Promise.all([
      getV5MonthlyPlan(month),
      Promise.all(
        productIds.map(async (productId) => {
          const [readinessResult, context] = await Promise.all([
            getV5MonthlyProductionReadiness(productId),
            readV5ReadinessContext(productId)
          ]);
          const data: unknown = readinessResult.data;
          return {
            productId,
            readiness: isFormalReadiness(data) ? data : undefined,
            context
          };
        })
      )
    ]);

    const productionReadiness = readinessAndContextResults
      .map((item) => item.readiness)
      .filter((item): item is V5MonthlyProductionReadiness => item !== undefined);
    const readinessByProduct = new Map(productionReadiness.map((item) => [item.productId, item]));
    const contextByProduct = new Map(
      readinessAndContextResults.map((item) => [item.productId, item.context])
    );

    const governedRulePackages = productIds.map((productId) => {
      const item = candidateByProduct.get(productId);
      const product = productById.get(productId);
      const readiness = readinessByProduct.get(productId);
      const context = contextByProduct.get(productId);
      const approved = Boolean(
        readiness
        && readiness.monthlyProductionReady
        && readiness.status === "approved"
        && readiness.approvedAt
        && readiness.approvedBy
      );

      return {
        id:
          readiness?.rulePackageVersionId
          || context?.rulePackageVersionId
          || item?.id
          || `pending-${productId}`,
        productId,
        productName: product?.displayName || item?.productName || productId,
        version: context?.rulePackageVersion || item?.version || "pending",
        status: approved ? "active" as const : item?.status || "pending" as const,
        monthlyProductionReady: approved,
        allowedChannels:
          readiness?.allowedChannels.length
            ? readiness.allowedChannels
            : item?.allowedChannels || [],
        readinessSource: "v5_governance" as const,
        knowledgeBaseIds: context?.knowledgeBaseIds || item?.knowledgeBaseIds || [],
        sourceSnapshotHash:
          readiness?.sourceSnapshotHash
          || context?.sourceSnapshotHash
          || item?.sourceSnapshotHash,
        disabledReason: approved
          ? undefined
          : readiness?.reasonCodes.length
            ? `G6 未通过：${readiness.reasonCodes.join("、")}。`
            : "正式 V5 后端尚未生成或批准该产品的 G6 MonthlyProductionReadiness。"
      } satisfies RulePackageOption;
    });

    const knowledgeBases = Array.from(
      new Map(
        readinessAndContextResults.flatMap(({ productId, context }) =>
          (context.knowledgeBases || []).map((knowledgeBase) => [
            knowledgeBase.knowledgeBaseId,
            {
              knowledgeBaseId: knowledgeBase.knowledgeBaseId,
              name: knowledgeBase.name,
              productId,
              sourceSnapshotHash: context.sourceSnapshotHash || "",
              status:
                knowledgeBase.status === "enabled" || knowledgeBase.status === "ready"
                  ? "ready" as const
                  : "pending_config" as const,
              source: "v5_formal" as const
            } satisfies KnowledgeBaseOption
          ] as const)
        )
      ).values()
    );

    const productionPoolPlanId = monthlyPlanResult.data?.monthlyPlanId || monthlyPlanId;
    const productionPoolEntries = productionPoolPlanId
      ? (
          await Promise.all(
            governedRulePackages.map(async (item) => {
              const result = await getV5MonthlyProductionPool({
                productId: item.productId,
                monthlyPlanId: productionPoolPlanId
              });
              return result.data.entries as V5ProductionPoolEntry[];
            })
          )
        ).flat()
      : [];

    return {
      source: "v5_mysql",
      rulePackages: governedRulePackages,
      knowledgeBases,
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
      knowledgeBases: [],
      monthlyPlan: null,
      productionReadiness: [],
      productionPoolEntries: [],
      message
    };
  }
}
