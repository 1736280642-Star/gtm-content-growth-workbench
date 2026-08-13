import type { V5MonthlyPlanStatus } from "./monthly-contracts";
import { readV5MonthlyPlanRecord } from "./monthly-plan-repository";
import { getMonthlyWorkspaceReadModel } from "./monthly-workspace-read-model";
import { approveV5Strategy, preflightV5Strategy, saveV5MonthlyPlan } from "./monthly-service";
import type { ContentQuotaRule } from "./monthly-workspace-contracts";

export type OverflowTaskStatus = "pending" | "migrated" | "skipped";

export interface OverflowTask {
  taskId: string;
  title: string;
  channel: string;
  originalMonth: string;
  targetMonth: string;
  status: OverflowTaskStatus;
  skipReason?: string;
}

export interface MonthlyOverflowResult {
  sourceMonth: string;
  targetMonth: string;
  overflowedCount: number;
  skippedCount: number;
  eligibleCount: number;
  tasks: OverflowTask[];
  message: string;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function nextMonth(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  if (monthNum === 12) return `${year + 1}-01`;
  return `${year}-${String(monthNum + 1).padStart(2, "0")}`;
}

function isMonthCompleted(status: V5MonthlyPlanStatus): boolean {
  return status === "completed" || status === "review_ready";
}

function isTaskUnexecuted(task: { status: string; scheduledAt?: string | null }): boolean {
  return !["published", "cancelled", "archived"].includes(task.status);
}

export async function runMonthlyOverflow(sourceMonth: string): Promise<MonthlyOverflowResult> {
  if (!MONTH_PATTERN.test(sourceMonth)) {
    throw new Error(`Invalid month format: ${sourceMonth}. Expected YYYY-MM.`);
  }

  const targetMonth = nextMonth(sourceMonth);
  const workspace = await getMonthlyWorkspaceReadModel(sourceMonth);

  const plan = await readV5MonthlyPlanRecord(sourceMonth).catch(() => undefined);
  const isCompleted = plan ? isMonthCompleted(plan.status) : false;

  const productionTasks = workspace.productionTasks || [];
  const unexecuted = productionTasks.filter((task) => isTaskUnexecuted(task));

  const overflowTasks: OverflowTask[] = [];
  let overflowedCount = 0;
  let eligibleCount = 0;
  let skippedCount = 0;

  for (const task of unexecuted) {
    const overflowTask: OverflowTask = {
      taskId: task.taskId,
      title: task.title || "未命名任务",
      channel: task.channel || "unknown",
      originalMonth: sourceMonth,
      targetMonth,
      status: "pending"
    };

    if (task.status === "scheduled" && task.scheduledAt) {
      const scheduledDate = new Date(task.scheduledAt);
      const [y, m] = sourceMonth.split("-").map(Number);
      const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
      if (scheduledDate <= monthEnd) {
        overflowTask.status = "pending";
        eligibleCount += 1;
      } else {
        overflowTask.status = "skipped";
        overflowTask.skipReason = "排程日期已超出当月，可能在下一月自然执行。";
        skippedCount += 1;
      }
    } else {
      overflowTask.status = "pending";
      eligibleCount += 1;
    }

    overflowTasks.push(overflowTask);
  }

  if (!isCompleted && unexecuted.length > 0) {
    return {
      sourceMonth,
      targetMonth,
      overflowedCount: 0,
      eligibleCount: 0,
      skippedCount: unexecuted.length,
      tasks: unexecuted.map((task) => ({
        taskId: task.taskId,
        title: task.title || "未命名任务",
        channel: task.channel || "unknown",
        originalMonth: sourceMonth,
        targetMonth,
        status: "skipped" as OverflowTaskStatus,
        skipReason: "当月尚未结束，任务仍在执行窗口内。"
      })),
      message: `${sourceMonth} 尚未标记为完成状态，当前有 ${unexecuted.length} 个未执行任务仍在执行窗口内。`
    };
  }

  return {
    sourceMonth,
    targetMonth,
    overflowedCount,
    eligibleCount,
    skippedCount,
    tasks: overflowTasks,
    message: eligibleCount > 0
      ? `发现 ${eligibleCount} 个任务可迁移至 ${targetMonth}，当前仅完成预览，尚未写入下一月快照。${skippedCount > 0 ? ` ${skippedCount} 个任务已跳过。` : ""}`
      : `未发现需要溢出的任务。${skippedCount > 0 ? ` ${skippedCount} 个任务已跳过。` : ""}`
  };
}

export async function getMonthlyOverflowStatus(sourceMonth: string): Promise<MonthlyOverflowResult> {
  return runMonthlyOverflow(sourceMonth);
}

export async function migrateMonthlyOverflow(sourceMonth: string): Promise<MonthlyOverflowResult> {
  const preview = await runMonthlyOverflow(sourceMonth);
  if (!preview.eligibleCount) return preview;
  const [source, target] = await Promise.all([getMonthlyWorkspaceReadModel(sourceMonth), getMonthlyWorkspaceReadModel(preview.targetMonth)]);
  const eligibleIds = new Set(preview.tasks.filter((item) => item.status === "pending").map((item) => item.taskId));
  const existingRules = target.plan?.config.quotaRules || [];
  const existingRuleIds = new Set(existingRules.map((item) => item.quotaRuleId));
  const overflowRules = source.productionTasks.filter((task) => eligibleIds.has(task.taskId)).flatMap<ContentQuotaRule>((task) => {
    const quotaRuleId = `overflow-${sourceMonth}-${task.taskId}`.slice(0, 128);
    if (existingRuleIds.has(quotaRuleId)) return [];
    return [{ quotaRuleId, questionVersionId: task.questionVersionId, question: task.question, contentType: task.contentType,
      articleTypeProfileVersionId: task.articleTypeProfileVersionId, articleTypeNameSnapshot: task.articleTypeNameSnapshot,
      typeMatchRunId: task.typeMatchRunId, typeSelectionSource: task.typeSelectionSource,
      matchReasonSnapshot: `从 ${sourceMonth} 未执行任务迁移：${task.matchReasonSnapshot}`,
      articleTypePromptConstraintSnapshot: task.articleTypePromptConstraintSnapshot,
      articleTypePromptConstraintSnapshotHash: task.articleTypePromptConstraintSnapshotHash,
      sameQuotaForAllChannels: false, perChannelQuota: 1, channelQuotas: { [task.channel]: 1 }, expandedDeliverableCount: 1,
      rulePackageVersionId: task.rulePackageVersionId, knowledgeBaseIds: task.knowledgeBaseIds,
      sourceSnapshotHash: task.sourceSnapshotHash, rulePackageSourceSnapshotHash: task.sourceSnapshotHash,
      knowledgeIndexSourceSnapshotHash: task.sourceSnapshotHash, evidencePackSourceSnapshotHash: task.evidencePackSourceSnapshotHash }];
  });
  if (overflowRules.length) {
    const quotaRules = [...existingRules, ...overflowRules];
    const saved = await saveV5MonthlyPlan(preview.targetMonth, { expectedVersion: target.plan?.version || 0, mutationSource: "system_policy", config: {
      month: preview.targetMonth,
      businessGoal: target.plan?.config.businessGoal || `承接 ${sourceMonth} 未执行内容并持续提升 GEO 可见性`,
      targetDeliverableCount: quotaRules.reduce((sum, item) => sum + item.expandedDeliverableCount, 0),
      questionVersionIds: Array.from(new Set(quotaRules.map((item) => item.questionVersionId))), quotaRules, groups: target.plan?.config.groups || []
    } }, `monthly-overflow:${sourceMonth}:${preview.targetMonth}:${target.plan?.version || 0}`);
    await preflightV5Strategy(preview.targetMonth, { expectedVersion: saved.version, auditReason: `校验 ${sourceMonth} 月末溢出任务`, mutationSource: "system_policy" });
    const checked = await getMonthlyWorkspaceReadModel(preview.targetMonth);
    if (checked.plan?.strategyPackage?.status === "preview_ready") await approveV5Strategy(preview.targetMonth, { expectedVersion: checked.plan.version, auditReason: `批准 ${sourceMonth} 月末溢出执行快照`, mutationSource: "system_policy" });
  }
  return { ...preview, overflowedCount: preview.eligibleCount,
    tasks: preview.tasks.map((item) => item.status === "pending" ? { ...item, status: "migrated" as const } : item),
    message: `${preview.eligibleCount} 个未执行任务已写入 ${preview.targetMonth} 的正式 MonthlyPlan 快照；重复执行不会创建重复配额。` };
}
