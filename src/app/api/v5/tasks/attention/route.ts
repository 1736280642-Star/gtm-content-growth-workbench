import { observationError, observationOk } from "@/lib/v5/observation-api";
import { readResponsibilitySnapshot } from "@/lib/v5/responsibility-read-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Get "needs your attention" task list
export async function GET(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const snapshot = await readResponsibilitySnapshot(month);
    const items = snapshot.user.tasks.map((task) => ({
      id: task.id,
      whatHappened: `${task.source === "publishing" ? "发布" : "生产"}任务处于 ${task.status}`,
      impact: task.title,
      nextAction: task.nextAutomaticAction || "系统已停止自动重试，需要人工处理",
      nextCheckAt: task.nextAttemptAt || "人工处理后立即复查",
      attemptCount: task.attemptCount,
      impactCount: task.impactCount,
      refId: task.id
    }));
    return observationOk({
      month,
      items,
      total: items.length
    });
  } catch (error) {
    return observationError(error, "TASKS_ATTENTION_READ_FAILED", "需你处理清单查询失败，请稍后重试。");
  }
}
