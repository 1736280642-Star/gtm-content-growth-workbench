import type { RagEvaluationSummary } from "./contracts";

export const RAG_EVALUATION_THRESHOLDS = {
  unapprovedProductionSources: 0,
  crossProductHits: 0,
  permissionBoundaryHits: 0,
  blockedClaimHits: 0,
  plannedAsCurrentHits: 0,
  claimLocatorCompleteness: 1,
  scopedFactRetention: 1,
  coreClaimRecallAt10: 0.95,
  conditionalLimitationRecall: 1,
  officialCitationHitRate: 1,
  duplicateClusterTop5Max: 1,
  previewRiskAccuracy: 0.95,
  finalPackDecisionAccuracy: 0.95,
  blockingFalseNegatives: 0
} as const;

export function evaluateRagMetrics(metrics: Omit<RagEvaluationSummary, "passed" | "blockers">): RagEvaluationSummary {
  const blockers: string[] = [];
  const exactZero = ["unapprovedProductionSources", "crossProductHits", "permissionBoundaryHits", "blockedClaimHits", "plannedAsCurrentHits", "blockingFalseNegatives"] as const;
  exactZero.forEach((key) => { if (metrics[key] !== 0) blockers.push(`${key}=${metrics[key]}, required=0`); });
  const exactOne = ["claimLocatorCompleteness", "scopedFactRetention", "conditionalLimitationRecall", "officialCitationHitRate"] as const;
  exactOne.forEach((key) => { if (metrics[key] < 1) blockers.push(`${key}=${metrics[key]}, required=1`); });
  if (metrics.coreClaimRecallAt10 < .95) blockers.push(`coreClaimRecallAt10=${metrics.coreClaimRecallAt10}, required>=0.95`);
  if (metrics.duplicateClusterTop5Max > 1) blockers.push(`duplicateClusterTop5Max=${metrics.duplicateClusterTop5Max}, required<=1`);
  if (metrics.previewRiskAccuracy < .95) blockers.push(`previewRiskAccuracy=${metrics.previewRiskAccuracy}, required>=0.95`);
  if (metrics.finalPackDecisionAccuracy < .95) blockers.push(`finalPackDecisionAccuracy=${metrics.finalPackDecisionAccuracy}, required>=0.95`);
  return { ...metrics, passed: blockers.length === 0, blockers };
}

export type RagBadcaseStage = "governance" | "chunking_index" | "retrieval" | "evidence" | "generation";

export function routeRagBadcase(type: string): { stage: RagBadcaseStage; ownerRole: string; recommendedAction: string } {
  if (["wrong_product_entity", "claim_status_wrong", "authority_wrong", "source_approval_wrong", "conflict_unresolved"].includes(type)) return { stage: "governance", ownerRole: "knowledge_manager", recommendedAction: "回到 Source/Claim 治理与人工裁决。" };
  if (["locator_missing", "condition_lost", "duplicate_pollution", "planned_indexed_as_current"].includes(type)) return { stage: "chunking_index", ownerRole: "rag_operator", recommendedAction: "修正切片/索引规则并重建新 Snapshot。" };
  if (["cross_product_recall", "permission_leak", "low_authority_override", "official_citation_missing"].includes(type)) return { stage: "retrieval", ownerRole: "rag_operator", recommendedAction: "修正硬过滤、路由、配额或重排并重跑评测。" };
  if (["preview_risk_missed", "pack_decision_wrong", "slot_missing", "stale_pack_used"].includes(type)) return { stage: "evidence", ownerRole: "content_governance", recommendedAction: "修正 ClaimPlan、Evidence Gate 或失效规则。" };
  return { stage: "generation", ownerRole: "content_operator", recommendedAction: "检查冻结输入、Prompt 与 QA；不得通过补写无证据事实修复。" };
}
