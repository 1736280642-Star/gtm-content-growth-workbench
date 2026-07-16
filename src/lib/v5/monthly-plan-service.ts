import type { V5MonthlyPlan } from "./monthly-contracts";
import { readV5MonthlyPlanRecord } from "./monthly-plan-repository";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function getV5MonthlyPlan(month: string): Promise<{
  ok: true;
  status: "success" | "not_created";
  data: V5MonthlyPlan | null;
}> {
  if (!monthPattern.test(month)) throw new Error("月份格式必须为 YYYY-MM。");
  const plan = await readV5MonthlyPlanRecord(month);
  return { ok: true, status: plan ? "success" : "not_created", data: plan || null };
}
