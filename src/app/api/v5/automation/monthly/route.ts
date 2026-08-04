import { NextResponse } from "next/server";
import { runAutomaticMonthlyPlan, runAutomaticSchedule } from "@/lib/v5/monthly-automation-service";

export const dynamic = "force-dynamic";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

function errorResponse(error: unknown) {
  const candidate = error as { status?: number; code?: string; message?: string; details?: string[] };
  return NextResponse.json({
    ok: false,
    status: "failed",
    error: {
      code: candidate.code || "MONTHLY_AUTOMATION_FAILED",
      message: candidate.message || "月度自动化运行失败。",
      details: candidate.details
    }
  }, { status: candidate.status && candidate.status >= 400 ? candidate.status : 500 });
}

export async function POST(request: Request) {
  try {
    const value = await request.json().catch(() => ({})) as { month?: string; action?: string };
    const month = value.month?.trim() || currentMonth();
    const action = value.action === "schedule" ? "schedule" : value.action === "strategy" ? "strategy" : "all";
    const strategy = action === "schedule" ? undefined : await runAutomaticMonthlyPlan(month);
    const schedule = action === "strategy" ? undefined : await runAutomaticSchedule(month);
    return NextResponse.json({ ok: true, status: "success", data: { month, strategy, schedule } });
  } catch (error) {
    return errorResponse(error);
  }
}
