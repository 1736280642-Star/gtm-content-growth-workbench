import type {
  ContentDraftArtifact,
  FreeProductionBatch,
  FreeProductionStatus,
  RiskAndGapItem
} from "./free-production-contracts";

export const OBSOLETE_FREE_PRODUCTION_RISK_KEYS = new Set(["launch_status", "cta_url"]);

const blockingRiskStatuses = new Set(["needs_input", "needs_approval", "blocked"]);

export function currentFreeProductionArtifact(batch: FreeProductionBatch) {
  return batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
}

export function isObsoleteFreeProductionRisk(risk: RiskAndGapItem) {
  return OBSOLETE_FREE_PRODUCTION_RISK_KEYS.has(risk.key);
}

export function visibleFreeProductionRisks(batch: FreeProductionBatch) {
  return batch.risks.filter((risk) => !isObsoleteFreeProductionRisk(risk));
}

export function blockingFreeProductionRisks(batch: FreeProductionBatch) {
  return visibleFreeProductionRisks(batch).filter((risk) => blockingRiskStatuses.has(risk.status));
}

export function hasRequiredFreeProductionAssets(batch: FreeProductionBatch) {
  return batch.channelConfig.requiredPublishAssetKeys.every((key) =>
    visibleFreeProductionRisks(batch).some((risk) => risk.key === key && risk.status === "ready" && risk.assetRef)
  );
}

export function hasCurrentSourceReview(batch: FreeProductionBatch, artifact = currentFreeProductionArtifact(batch)) {
  return Boolean(artifact?.sourceExcerpts.length && batch.sourceReview?.artifactId === artifact.id);
}

export function hasCitationCoverage(artifact: ContentDraftArtifact | undefined) {
  if (!artifact?.sourceExcerpts.length || !artifact.sections.length) return false;
  const sourceIds = new Set(artifact.sourceExcerpts.map((source) => source.id));
  return artifact.sections.every((section) =>
    Array.isArray(section.citations)
    && section.citations.length > 0
    && section.citations.every((citation) =>
      Boolean(citation.claimText.trim())
      && citation.sourceIds.length > 0
      && citation.sourceIds.every((sourceId) => sourceIds.has(sourceId))
    )
  );
}

export function freeProductionGateStatus(batch: FreeProductionBatch): FreeProductionStatus {
  const artifact = currentFreeProductionArtifact(batch);
  if (!artifact || !hasCitationCoverage(artifact)) return "blocked";
  if (!hasCurrentSourceReview(batch, artifact)) return "needs_input";
  const blockers = blockingFreeProductionRisks(batch);
  if (blockers.some((risk) => risk.status === "needs_input" || risk.status === "needs_approval")) return "needs_input";
  if (blockers.length || !hasRequiredFreeProductionAssets(batch)) return "blocked";
  return "ready_for_confirmation";
}

export interface FreeProductionStatusPresentation {
  label: string;
  color?: string;
  nextAction: string;
}

const stableStatusMeta: Partial<Record<FreeProductionStatus, FreeProductionStatusPresentation>> = {
  draft: { label: "草稿", nextAction: "继续填写生产资料。" },
  compiling: { label: "编译中", color: "processing", nextAction: "等待系统完成内容编译。" },
  generating: { label: "生成中", color: "processing", nextAction: "等待正文生成完成。" },
  checking: { label: "检查中", color: "processing", nextAction: "等待系统完成确定性检查。" },
  repairing: { label: "修复中", color: "processing", nextAction: "等待系统完成一次自动修复。" },
  publishing: { label: "发布中", color: "processing", nextAction: "等待渠道返回发布结果。" },
  published: { label: "已发布", color: "success", nextAction: "查看发布结果。" },
  generation_failed: { label: "生成失败", color: "error", nextAction: "检查失败原因后安全重试。" },
  publish_failed: { label: "发布失败", color: "error", nextAction: "检查渠道连接后安全重试。" },
  cancelled: { label: "已取消", nextAction: "如有需要请重新创建任务。" }
};

export function freeProductionStatusPresentation(batch: FreeProductionBatch): FreeProductionStatusPresentation {
  const stable = stableStatusMeta[batch.status];
  if (stable) return stable;
  const artifact = currentFreeProductionArtifact(batch);
  if (!artifact) return { label: "待生成正文", color: "warning", nextAction: "生成正文后继续。" };
  if (!artifact.sourceExcerpts.length) return { label: "待重新生成来源", color: "error", nextAction: "重新选择资料生成正文，历史正文不会伪造来源。" };
  if (!hasCitationCoverage(artifact)) return { label: "待重建引用映射", color: "error", nextAction: "重新生成正文，建立事实声明与来源片段的映射。" };
  if (!hasCurrentSourceReview(batch, artifact)) return { label: "待核对来源", color: "warning", nextAction: "核对右侧来源片段并确认。" };
  if (!hasRequiredFreeProductionAssets(batch)) return { label: "待补封面", color: "warning", nextAction: "导入公众号封面。" };
  const blockers = blockingFreeProductionRisks(batch);
  if (blockers.length) return { label: "待处理风险", color: "error", nextAction: blockers[0].reason };
  return { label: "待确认发布", color: "blue", nextAction: "确认正文与封面后自动发布。" };
}
