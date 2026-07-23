import type {
  ContentQuotaRule,
  ContentStrategyPackageRecord,
  ProductionMatrixTask,
  StrategyPreflightResult
} from "./monthly-workspace-contracts";

export function calculateExpandedDeliverableCount(channelQuotas: Record<string, number>) {
  return Object.values(channelQuotas).reduce((total, quota) => total + (Number.isInteger(quota) && quota > 0 ? quota : 0), 0);
}

export function evaluateStrategyPreflight(
  rule: ContentQuotaRule,
  evidence?: { criticalFactMissing: boolean; reason?: string; knowledgeTodoId?: string }
): StrategyPreflightResult {
  const sourceHashes = [rule.sourceSnapshotHash, rule.rulePackageSourceSnapshotHash, rule.knowledgeIndexSourceSnapshotHash, rule.evidencePackSourceSnapshotHash];
  if (!sourceHashes[0] || new Set(sourceHashes).size !== 1) {
    return { quotaRuleId: rule.quotaRuleId, status: "configuration_error", deliverableCount: rule.expandedDeliverableCount, reason: "策略、规则包、知识索引和 EvidencePack 未绑定同一资料快照。" };
  }
  if (evidence?.criticalFactMissing) {
    return {
      quotaRuleId: rule.quotaRuleId,
      status: "awaiting_material",
      deliverableCount: rule.expandedDeliverableCount,
      reason: evidence.reason || "缺少文章主题成立所需关键事实。",
      knowledgeTodoId: evidence.knowledgeTodoId
    };
  }
  return { quotaRuleId: rule.quotaRuleId, status: "generatable", deliverableCount: rule.expandedDeliverableCount, reason: "资料快照一致，可进入生产。" };
}

export function expandApprovedStrategyTasks(input: {
  monthlyPlanId: string;
  strategyPackage: ContentStrategyPackageRecord;
  now?: string;
}): ProductionMatrixTask[] {
  const now = input.now || new Date().toISOString();
  const resultByRule = new Map(input.strategyPackage.preflightResults.map((item) => [item.quotaRuleId, item]));
  return input.strategyPackage.quotaRules.flatMap((rule) => {
    const preflight = resultByRule.get(rule.quotaRuleId);
    return Object.entries(rule.channelQuotas).flatMap(([channel, quota]) =>
      Array.from({ length: quota }, (_, index): ProductionMatrixTask => ({
        taskId: `task-${rule.quotaRuleId}-${encodeURIComponent(channel)}-${index + 1}`,
        monthlyPlanId: input.monthlyPlanId,
        strategyPackageId: input.strategyPackage.strategyPackageId,
        quotaRuleId: rule.quotaRuleId,
        questionVersionId: rule.questionVersionId,
        question: rule.question,
        baseTopicIndex: index + 1,
        title: `${rule.question} · ${channel}选题 ${index + 1}`,
        contentType: rule.contentType,
        channel,
        rulePackageVersionId: rule.rulePackageVersionId,
        knowledgeBaseIds: rule.knowledgeBaseIds,
        articleExpressionProfileVersionId: rule.articleExpressionProfileVersionId,
        sourceSnapshotHash: rule.sourceSnapshotHash,
        evidencePackSourceSnapshotHash: rule.evidencePackSourceSnapshotHash,
        status: preflight?.status === "generatable" ? "ready_for_generation" : "awaiting_material",
        knowledgeTodoId: preflight?.knowledgeTodoId,
        recoveryAttemptCount: 0,
        automaticRepairCount: 0,
        updatedAt: now
      }))
    );
  });
}
