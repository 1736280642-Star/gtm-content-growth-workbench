export type V5MonthlyPlanStatus =
  | "draft"
  | "strategy_generating"
  | "pending_strategy_review"
  | "strategy_approved"
  | "matrix_generating"
  | "pending_matrix_approval"
  | "approved"
  | "generating"
  | "in_execution"
  | "review_ready"
  | "completed"
  | "cancelled";

export type V5StrategyPackageStatus = "draft" | "pending_review" | "approved" | "rejected" | "superseded";
export type V5ContentMatrixVersionStatus = "draft" | "pending_approval" | "approved" | "superseded" | "cancelled";

export type V5ContentMatrixItemStatus =
  | "draft"
  | "preview_ready"
  | "evidence_gap"
  | "pending_approval"
  | "approved"
  | "ready_for_generation"
  | "generating"
  | "qa_passed"
  | "exception"
  | "scheduled"
  | "published"
  | "publish_failed"
  | "cancelled";

export interface V5MonthlyPlan {
  monthlyPlanId: string;
  month: string;
  status: V5MonthlyPlanStatus;
  goals: Record<string, unknown>;
  productQuotas: Record<string, number>;
  channelMix: Record<string, number>;
  contentTypeMix: Record<string, number>;
  publishFrequency: Record<string, unknown>;
  strategyPackageVersionId?: string;
  matrixVersionId?: string;
  approvedAt?: string;
  approvedBy?: string;
  version: number;
}

export interface V5MonthlyStrategyPackageVersion {
  strategyPackageVersionId: string;
  monthlyPlanId: string;
  versionNumber: number;
  status: V5StrategyPackageStatus;
  productAllocation: Record<string, number>;
  channelAllocation: Record<string, number>;
  contentTypeAllocation: Record<string, number>;
  distilledTermCoverage: Record<string, unknown>;
  evidenceReadinessSummary: Record<string, unknown>;
  risks: unknown[];
  gaps: unknown[];
  generatedByRunId?: string;
  ruleValidationResult?: Record<string, unknown>;
  approvedAt?: string;
  approvedBy?: string;
}

export interface V5ContentMatrixVersion {
  matrixVersionId: string;
  monthlyPlanId: string;
  versionNumber: number;
  basedOnStrategyPackageVersionId?: string;
  status: V5ContentMatrixVersionStatus;
  itemIds: string[];
  generatedByRunId?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface V5ContentMatrixItem {
  matrixItemId: string;
  monthlyPlanId: string;
  matrixVersionId: string;
  publishDate: string;
  publishTime?: string;
  weekIndex: number;
  productId: string;
  channel: string;
  contentType: string;
  platformContentType?: string;
  title: string;
  targetAudience?: string;
  primaryDistilledTermId?: string;
  secondaryDistilledTermIds: string[];
  knowledgeBaseIds: string[];
  rulePackageVersionId?: string;
  evidencePreviewId?: string;
  evidencePreviewStatus?: string;
  finalEvidencePackId?: string;
  evidenceGateStatus?: string;
  platformExpressionProfileId?: string;
  platformExpressionSnapshot?: Record<string, unknown>;
  sourceProblem?: string;
  status: V5ContentMatrixItemStatus;
  approvedAt?: string;
  approvedBy?: string;
  version: number;
}

export interface V5MonthlyProductionReadiness {
  readinessId: string;
  productId: string;
  rulePackageVersionId: string;
  sourceSnapshotId?: string;
  sourceSnapshotHash?: string;
  monthlyProductionReady: boolean;
  allowedContentTypes: string[];
  conditionalContentTypes: string[];
  blockedContentTypes: string[];
  allowedChannels: string[];
  requiredEvidenceRoles: string[];
  evidenceGapIds: string[];
  maxMonthlyQuota?: number;
  reasonCodes: string[];
  status: "pending_review" | "approved" | "blocked" | "superseded";
  evaluatedAt?: string;
  evaluatorVersion?: string;
  governanceRunId?: string;
  approvedAt?: string;
  approvedBy?: string;
  version: number;
}

export interface V5ProductionPoolEntry {
  productionPoolEntryId: string;
  monthlyPlanId: string;
  productId: string;
  readinessId: string;
  monthlyQuota: number;
  status: "pending_review" | "approved" | "blocked" | "removed";
  version: number;
  approvedAt?: string;
  approvedBy?: string;
  activatedAt?: string;
  suspendedAt?: string;
}

export interface V5ArtifactReference {
  artifactReferenceId: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  targetType: string;
  targetId: string;
  targetVersion?: string;
  relationType: string;
  createdBy: string;
}
