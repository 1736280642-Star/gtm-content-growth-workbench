import { observationError, observationOk } from "@/lib/v5/observation-api";
import { getMonthlyOverflowStatus, migrateMonthlyOverflow } from "@/lib/v5/monthly-overflow-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Run month-end overflow - snapshot and migrate unexecuted tasks
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sourceMonth = String(body.sourceMonth || "").trim();

    if (!sourceMonth) {
      return observationOk(
        { message: "请提供 sourceMonth 参数（格式：YYYY-MM）。" },
        400
      );
    }

    return observationOk(await migrateMonthlyOverflow(sourceMonth));
  } catch (error) {
    return observationError(error, "MONTHLY_OVERFLOW_FAILED", "月末溢出任务处理失败，请稍后重试。");
  }
}

// Phase 1: Get overflow status for a given month
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceMonth = url.searchParams.get("sourceMonth") || "";

    if (!sourceMonth) {
      return observationOk(
        { message: "请提供 sourceMonth 查询参数（格式：YYYY-MM）。" },
        400
      );
    }

    const result = await getMonthlyOverflowStatus(sourceMonth);
    return observationOk(result);
  } catch (error) {
    return observationError(error, "MONTHLY_OVERFLOW_STATUS_FAILED", "月末溢出状态查询失败，请稍后重试。");
  }
}
