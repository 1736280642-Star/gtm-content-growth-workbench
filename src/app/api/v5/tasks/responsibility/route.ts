import { observationError, observationOk } from "@/lib/v5/observation-api";
import { readResponsibilitySnapshot } from "@/lib/v5/responsibility-read-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Aggregate tasks by responsibility status
export async function GET(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
    return observationOk(await readResponsibilitySnapshot(month));
  } catch (error) {
    return observationError(error, "TASKS_RESPONSIBILITY_READ_FAILED", "任务责任聚合查询失败，请稍后重试。");
  }
}
