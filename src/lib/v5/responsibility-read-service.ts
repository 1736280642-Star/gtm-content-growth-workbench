import { readWorkbenchState } from "@/lib/workbench-store";
import { getMonthlyWorkspaceReadModel } from "./monthly-workspace-read-model";
import { classifyProductionResponsibility, classifyPublishResponsibility, type Responsibility } from "./responsibility";

export async function readResponsibilitySnapshot(month: string) {
  const workspace = await getMonthlyWorkspaceReadModel(month);
  const state = readWorkbenchState();
  const tasks = [
    ...workspace.productionTasks.map((task) => ({
      id: task.taskId,
      source: "production" as const,
      title: task.title,
      productId: task.productId,
      status: task.status,
      ...classifyProductionResponsibility(task.status, task.recoveryAttemptCount)
    })),
    ...state.publishSchedules.map((schedule) => ({
      id: schedule.id,
      source: "publishing" as const,
      title: schedule.matrixItemId || schedule.draftId,
      status: schedule.status,
      nextAutomaticAction: schedule.nextAction,
      nextAttemptAt: schedule.nextVerificationAt,
      ...classifyPublishResponsibility(schedule.status, schedule.retryCount)
    }))
  ];
  const grouped: Record<Responsibility, { count: number; tasks: typeof tasks }> = {
    system: { count: 0, tasks: [] },
    external: { count: 0, tasks: [] },
    user: { count: 0, tasks: [] }
  };
  for (const task of tasks) grouped[task.responsibility].tasks.push(task);
  for (const value of Object.values(grouped)) value.count = value.tasks.length;
  return { month, ...grouped };
}
