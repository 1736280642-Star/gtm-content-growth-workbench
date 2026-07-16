import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, parseV5Json } from "./knowledge-governance-repository";
import type { V5MonthlyPlan, V5MonthlyPlanStatus } from "./monthly-contracts";

const monthlyPlanStatuses = new Set<V5MonthlyPlanStatus>([
  "draft",
  "strategy_generating",
  "pending_strategy_review",
  "strategy_approved",
  "matrix_generating",
  "pending_matrix_approval",
  "approved",
  "generating",
  "in_execution",
  "review_ready",
  "completed",
  "cancelled"
]);

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

function mapMonthlyPlan(row: RowDataPacket): V5MonthlyPlan {
  const rawStatus = String(row.status) as V5MonthlyPlanStatus;
  return {
    monthlyPlanId: String(row.id),
    month: String(row.plan_month),
    status: monthlyPlanStatuses.has(rawStatus) ? rawStatus : "draft",
    goals: parseV5Json<Record<string, unknown>>(row.goals, {}),
    productQuotas: parseV5Json<Record<string, number>>(row.product_quotas, {}),
    channelMix: parseV5Json<Record<string, number>>(row.channel_mix, {}),
    contentTypeMix: parseV5Json<Record<string, number>>(row.content_type_mix, {}),
    publishFrequency: parseV5Json<Record<string, unknown>>(row.publish_frequency, {}),
    strategyPackageVersionId: row.strategy_package_version_id ? String(row.strategy_package_version_id) : undefined,
    matrixVersionId: row.matrix_version_id ? String(row.matrix_version_id) : undefined,
    approvedAt: asDate(row.approved_at),
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    version: Number(row.version)
  };
}

export async function readV5MonthlyPlanRecord(month: string): Promise<V5MonthlyPlan | undefined> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM monthly_plan WHERE plan_month = ? LIMIT 1",
    [month]
  );
  return rows[0] ? mapMonthlyPlan(rows[0]) : undefined;
}
