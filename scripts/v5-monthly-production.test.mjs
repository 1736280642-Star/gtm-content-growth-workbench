import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { calculateExpandedDeliverableCount, evaluateStrategyPreflight, expandApprovedStrategyTasks } from "../src/lib/v5/monthly-strategy-policy.ts";
import { runAutomatedProduction } from "../src/lib/v5/monthly-production-service.ts";

const quotaRule = {
  quotaRuleId: "quota-adp-selection",
  questionVersionId: "question-v1",
  question: "企业应该如何选择腾讯云 ADP 服务商？",
  contentType: "选型与比较",
  articleTypeProfileVersionId: "article-type-selection-v1",
  articleTypeNameSnapshot: "选型与比较",
  typeMatchRunId: "type-match-2026-08-v1",
  typeSelectionSource: "ai_recommended",
  matchReasonSnapshot: "问题需要比较标准、边界和风险。",
  articleTypePromptConstraintSnapshot: "{\"name\":\"选型与比较\"}",
  articleTypePromptConstraintSnapshotHash: "article-type-prompt-v1",
  sameQuotaForAllChannels: true,
  perChannelQuota: 4,
  channelQuotas: { 官网: 4, 知乎: 4 },
  expandedDeliverableCount: 8,
  rulePackageVersionId: "rule-v3",
  knowledgeBaseIds: ["kb-adp"],
  sourceSnapshotHash: "snapshot-2026-07-22-3",
  rulePackageSourceSnapshotHash: "snapshot-2026-07-22-3",
  knowledgeIndexSourceSnapshotHash: "snapshot-2026-07-22-3",
  evidencePackSourceSnapshotHash: "snapshot-2026-07-22-3"
};

test("per-channel quota expands across every selected channel", () => {
  assert.equal(calculateExpandedDeliverableCount({ 官网: 4, 知乎: 4 }), 8);
  assert.equal(calculateExpandedDeliverableCount({ 官网: 2, 知乎: 2 }), 4);
  assert.equal(calculateExpandedDeliverableCount({ 官网: 2, 知乎: 3 }), 5);
});

test("admission fails closed unless strategy, index and evidence share one snapshot", () => {
  assert.equal(evaluateStrategyPreflight(quotaRule).status, "generatable");
  assert.equal(evaluateStrategyPreflight({ ...quotaRule, evidencePackSourceSnapshotHash: "stale-snapshot" }).status, "configuration_error");
  const missing = evaluateStrategyPreflight(quotaRule, { criticalFactMissing: true, reason: "缺少验收条件", knowledgeTodoId: "todo-kb-1" });
  assert.equal(missing.status, "awaiting_material");
  assert.equal(missing.knowledgeTodoId, "todo-kb-1");
});

test("approved quota expands to independent channel tasks", () => {
  const tasks = expandApprovedStrategyTasks({
    monthlyPlanId: "plan-2026-08",
    now: "2026-07-22T00:00:00.000Z",
    strategyPackage: {
      strategyPackageId: "strategy-v3",
      version: 3,
      status: "approved",
      targetDeliverableCount: 8,
      quotaRules: [quotaRule],
      preflightResults: [{ quotaRuleId: quotaRule.quotaRuleId, status: "generatable", deliverableCount: 8, reason: "ready" }],
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z"
    }
  });
  assert.equal(tasks.length, 8);
  assert.equal(tasks.filter((item) => item.channel === "官网").length, 4);
  assert.equal(tasks.filter((item) => item.channel === "知乎").length, 4);
  assert.equal(new Set(tasks.map((item) => item.taskId)).size, 8);
});

test("automatic repair completes without creating a user review task", async () => {
  let checks = 0;
  const result = await runAutomatedProduction({
    now: () => "2026-07-22T00:00:00.000Z",
    engine: {
      async generate() { return { title: "ADP 选型", markdown: "初稿" }; },
      async check() { checks += 1; return checks === 1 ? { status: "fixable", reasons: ["结构需要调整"] } : { status: "passed", basisSummary: ["公开产品资料"] }; },
      async repair() { return { title: "ADP 选型", markdown: "修复后正文" }; }
    }
  });
  assert.equal(result.status, "available");
  assert.equal(result.automaticRepairCount, 1);
  assert.equal(result.currentDraft?.markdown, "修复后正文");
});

test("technical recovery retries and preserves the last usable draft on continued failure", async () => {
  const previous = { draftId: "draft-good", title: "可用正文", markdown: "上一份可用正文", status: "available", basisSummary: ["公开资料"], updatedAt: "2026-07-21T00:00:00.000Z" };
  let attempts = 0;
  const recovered = await runAutomatedProduction({
    previousUsableDraft: previous,
    engine: {
      async generate() { attempts += 1; if (attempts < 3) throw new Error("temporary"); return { title: "新正文", markdown: "新正文" }; },
      async check() { return { status: "passed", basisSummary: ["公开资料"] }; },
      async repair(draft) { return draft; }
    }
  });
  assert.equal(recovered.status, "available");
  assert.equal(recovered.recoveryAttemptCount, 2);

  const failed = await runAutomatedProduction({
    previousUsableDraft: previous,
    engine: {
      async generate() { throw new Error("continued failure"); },
      async check() { return { status: "passed", basisSummary: [] }; },
      async repair(draft) { return draft; }
    }
  });
  assert.equal(failed.status, "system_recovering");
  assert.equal(failed.currentDraft?.draftId, "draft-good");
});

test("preview stays in a drawer and business UI omits internal quality vocabulary", async () => {
  const [table, page, draftCompat] = await Promise.all([
    readFile("src/components/BatchGenerationMatrixTable.tsx", "utf8"),
    readFile("src/app/monthly-matrix/batch-generation/page.tsx", "utf8"),
    readFile("src/app/v5/drafts/[id]/page.tsx", "utf8")
  ]);
  assert.match(table, /<Drawer/);
  assert.match(table, /内容依据/);
  assert.match(table, /保存并自动复检/);
  assert.doesNotMatch(table, /softQualityScore|hardRuleStatus|claimCount|EvidencePack|Claim|逐条重试/);
  assert.match(page, /key: "content"/);
  assert.match(page, /key: "schedule"/);
  assert.doesNotMatch(page, /key: "quality"|key: "exceptions"/);
  assert.match(draftCompat, /monthly-matrix\/batch-generation\?draftId=/);
});

test("schedule mutation only accepts available tasks and does not edit strategy fields", async () => {
  const [service, schedule, legacy] = await Promise.all([
    readFile("src/lib/v5/monthly-service.ts", "utf8"),
    readFile("src/components/ScheduleCalendarLite.tsx", "utf8"),
    readFile("src/app/batch-generation/page.tsx", "utf8")
  ]);
  assert.match(service, /only system checks passed|只有系统检查通过|TASK_NOT_AVAILABLE/);
  assert.match(service, /lastUsableDraft/);
  assert.match(schedule, /日期、时间、平台账号和发布方式由排程决定，不会修改已批准策略/);
  assert.match(legacy, /redirect\("\/monthly-matrix\/batch-generation"\)/);
});
