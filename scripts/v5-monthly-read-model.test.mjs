import assert from "node:assert/strict";
import test from "node:test";
import { mergeMonthlyProductionTasks } from "../src/lib/v5/monthly-workspace-read-model.ts";

function task(overrides) {
  return {
    taskId: "task-1", monthlyPlanId: "plan-1", strategyPackageId: "strategy-1", quotaRuleId: "quota-1",
    questionVersionId: "question-1", question: "question", baseTopicIndex: 1, title: "同一标题", contentType: "guide",
    articleTypeProfileVersionId: "type-1", articleTypeNameSnapshot: "guide", typeMatchRunId: "match-1",
    typeSelectionSource: "user_selected", matchReasonSnapshot: "approved", articleTypePromptConstraintSnapshot: "",
    articleTypePromptConstraintSnapshotHash: "", channel: "csdn", rulePackageVersionId: "rule-1", knowledgeBaseIds: [],
    sourceSnapshotHash: "source", evidencePackSourceSnapshotHash: "evidence", status: "scheduled",
    recoveryAttemptCount: 0, automaticRepairCount: 0, updatedAt: "2026-08-01T00:00:00.000Z", ...overrides
  };
}

test("formal production queue overlays matching snapshot items without hiding the remaining matrix", () => {
  const snapshot = Array.from({ length: 42 }, (_, index) => task({ taskId: `legacy-${index}`, title: `标题 ${index}` }));
  const formal = [task({ taskId: "formal-0", title: "标题 0", formal: true, status: "published" })];
  const merged = mergeMonthlyProductionTasks(snapshot, formal);
  assert.equal(merged.length, 42);
  assert.equal(merged.find((item) => item.title === "标题 0")?.taskId, "formal-0");
  assert.equal(merged.filter((item) => item.formal).length, 1);
});

test("a genuinely new formal item is appended instead of replacing the snapshot", () => {
  const merged = mergeMonthlyProductionTasks(
    [task({ taskId: "legacy", title: "旧矩阵" })],
    [task({ taskId: "formal", title: "新增正式任务", formal: true })]
  );
  assert.equal(merged.length, 2);
});
