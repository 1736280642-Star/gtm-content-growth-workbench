import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: false,
    error: {
      code: "QUESTION_POOL_MONTHLY_SELECTION_RETIRED",
      message: "问题池二次月度选择已停用；GEO 调研人工确认的问题会自动进入 MonthlyPlan 候选和 GEO 监控。"
    }
  }, { status: 410 });
}
