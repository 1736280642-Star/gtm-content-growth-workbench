export type RulePackageStatus = "active" | "draft" | "pending" | "deprecated" | "rolled_back";
export type EvidenceReadinessStatus =
  | "ready"
  | "ready_with_auto_downgrade"
  | "needs_material"
  | "needs_review"
  | "blocked"
  | "pending_config";
export type StrategyRowStatus = "ready" | "ready_with_conditions" | "needs_material" | "needs_review" | "quota_error" | "blocked";
export type MatrixDisplayStatus = "preparing" | "ready" | "generating" | "qualified" | "exception" | "scheduled" | "published" | "publish_failed";
export type GenerationStatus = "title_pending" | "pending" | "generating" | "generated" | "provider_failed" | "input_expired";
export type FinalEvidenceGateStatus = "not_created" | "ready" | "needs_review" | "blocked" | "pending_config";
export type ScheduleDraftStatus = "unscheduled" | "draft" | "active" | "pending_config";
export type PublishStatus = "scheduled" | "waiting" | "publishing" | "published" | "failed" | "manual_takeover";

export interface RulePackageOption {
  id: string;
  productId: string;
  productName: string;
  version: string;
  status: RulePackageStatus;
  monthlyProductionReady: boolean;
  allowedChannels: string[];
  disabledReason?: string;
  readinessSource?: "derived_v4" | "v5_governance" | "seed_fallback" | "pending_config";
  knowledgeBaseIds?: string[];
  sourceSnapshotHash?: string;
}

export type ContentStrategyPackageStatus =
  | "draft"
  | "preview_checking"
  | "preview_ready"
  | "pending_review"
  | "approved"
  | "partially_approved"
  | "superseded";

export type StrategyPreflightStatus = "generatable" | "awaiting_material" | "configuration_error";
export type ProductionTaskStatus =
  | "ready_for_generation"
  | "generating"
  | "available"
  | "awaiting_material"
  | "system_recovering"
  | "scheduled";

export interface TargetQuestionOption {
  questionVersionId: string;
  question: string;
  productId?: string;
  status: "frozen" | "monthly_ready";
  source: "v4_adapter" | "v5_formal";
}

export interface KnowledgeBaseOption {
  knowledgeBaseId: string;
  name: string;
  productId?: string;
  sourceSnapshotHash: string;
  status: "ready" | "pending_config";
  source: "v4_adapter" | "v5_formal";
}

export interface ArticleExpressionPresetOption {
  articleExpressionProfileVersionId: string;
  name: string;
  summary: string;
  status: "active" | "pending_config";
  source: "v4_adapter" | "v5_formal";
}

export interface ContentQuotaRule {
  quotaRuleId: string;
  questionVersionId: string;
  question: string;
  contentType: string;
  sameQuotaForAllChannels: boolean;
  perChannelQuota: number;
  channelQuotas: Record<string, number>;
  expandedDeliverableCount: number;
  rulePackageVersionId: string;
  knowledgeBaseIds: string[];
  articleExpressionProfileVersionId: string;
  sourceSnapshotHash: string;
  rulePackageSourceSnapshotHash: string;
  knowledgeIndexSourceSnapshotHash: string;
  evidencePackSourceSnapshotHash: string;
}

export interface StrategyPreflightResult {
  quotaRuleId: string;
  status: StrategyPreflightStatus;
  deliverableCount: number;
  reason: string;
  knowledgeTodoId?: string;
}

export interface ContentStrategyPackageRecord {
  strategyPackageId: string;
  version: number;
  status: ContentStrategyPackageStatus;
  targetDeliverableCount: number;
  quotaRules: ContentQuotaRule[];
  preflightResults: StrategyPreflightResult[];
  sourceSnapshotHash?: string;
  approvedAt?: string;
  approvedBy?: string;
  approvalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionDraftSummary {
  draftId: string;
  title: string;
  markdown: string;
  status: "checking" | "available";
  basisSummary: string[];
  updatedAt: string;
}

export interface ProductionMatrixTask {
  taskId: string;
  monthlyPlanId: string;
  strategyPackageId: string;
  quotaRuleId: string;
  questionVersionId: string;
  question: string;
  baseTopicIndex: number;
  title: string;
  contentType: string;
  channel: string;
  rulePackageVersionId: string;
  knowledgeBaseIds: string[];
  articleExpressionProfileVersionId: string;
  sourceSnapshotHash: string;
  evidencePackSourceSnapshotHash: string;
  status: ProductionTaskStatus;
  knowledgeTodoId?: string;
  recoveryAttemptCount: number;
  automaticRepairCount: number;
  lastUsableDraft?: ProductionDraftSummary;
  currentDraft?: ProductionDraftSummary;
  scheduledAt?: string;
  platformAccount?: string;
  updatedAt: string;
}

export interface MonthlyPlanGroupQuota {
  groupQuotaId: string;
  rulePackageVersionId: string;
  productId: string;
  productName: string;
  selectedChannels: string[];
  articleQuota: number;
}

export interface MonthlyPlanConfig {
  month: string;
  businessGoal: string;
  targetDeliverableCount?: number;
  questionVersionIds?: string[];
  quotaRules?: ContentQuotaRule[];
  groups: MonthlyPlanGroupQuota[];
}

export interface StrategyTermHit {
  id: string;
  priority: "P0" | "P1" | "P2" | "Hold";
  term: string;
  source: string;
  priorityReason: string;
  productName: string;
  rulePackageVersion: string;
  allocatedQuota: number;
  channelAllocation: string[];
  contentTypeSuggestions: string[];
  evidenceStatus: EvidenceReadinessStatus;
  estimatedReadyItemCount: number;
  estimatedAutoDowngradeItemCount: number;
  estimatedMissingEvidenceItemCount: number;
  requiredClaims: string[];
  evidenceGaps: string[];
  status: StrategyRowStatus;
}

export interface BatchQueueItem {
  id: string;
  monthlyPlanId: string;
  matrixVersionId: string;
  matrixItemId: string;
  title: string;
  primaryDistilledTerm: string;
  priority: "P0" | "P1" | "P2";
  contentType: string;
  product: string;
  rulePackageVersion: string;
  channel: string;
  platformExpressionType: string;
  titleConfirmed: boolean;
  evidencePreview: EvidenceReadinessStatus;
  finalEvidenceGate: FinalEvidenceGateStatus;
  claimCount: number;
  generationStatus: GenerationStatus;
  hardRuleStatus: "pending" | "passed" | "blocked";
  softQualityScore?: number;
  qualityResult: "pending" | "passed" | "exception";
  scheduleStatus: ScheduleDraftStatus;
  scheduleDate?: string;
  scheduleTime?: string;
  platformAccount?: string;
  prepublishConfirmed: boolean;
  displayStatus: MatrixDisplayStatus;
  formal?: boolean;
  evidencePackId?: string;
  draftId?: string;
  failureReason?: string;
  nextAction?: string;
}

export interface ExceptionItem {
  id: string;
  matrixItemId: string;
  code:
    | "rule_package_inactive"
    | "distilled_term_product_mismatch"
    | "evidence_missing"
    | "title_unprovable"
    | "role_boundary_risk"
    | "provider_pending_config"
    | "hard_rule_blocked"
    | "soft_quality_failed"
    | "publish_pending_config";
  productId: string;
  product: string;
  distilledTermId: string;
  distilledTerm: string;
  title: string;
  stage: string;
  reason: string;
  claimContext: string;
  evidenceItemContext: string;
  blocking: boolean;
  nextAction: string;
  governanceLayer: string;
  missingClaimType: string;
  requiredEvidenceLevel: string;
  currentTitlePromise: string;
  status: "open" | "auto_resolved";
  severity: "high" | "medium" | "low";
}

export interface ScheduleDraftItem {
  id: string;
  matrixItemId: string;
  title: string;
  product: string;
  channel: string;
  date?: string;
  time?: string;
  platformAccount?: string;
  status: ScheduleDraftStatus;
  qualityReady: boolean;
}

export interface DailyExecutionItem {
  id: string;
  dateKey: "yesterday" | "today" | "tomorrow";
  date: string;
  time: string;
  title: string;
  product: string;
  channel: string;
  status: PublishStatus;
  failureReason: string;
}

export interface MonthlyTermReview {
  id: string;
  term: string;
  product: string;
  planned: number;
  published: number;
  gapConclusion: string;
  issueSource: string;
}

export interface NextMonthCandidate {
  id: string;
  term: string;
  product: string;
  source: string;
  reason: string;
  proposedAction: string;
  status: "pending_review" | "confirmed" | "hold";
}

export interface V5MonthlyPlanRecord {
  id: string;
  version: number;
  status: "draft" | "confirmed" | "running" | "completed";
  config: MonthlyPlanConfig;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  strategyPackage?: ContentStrategyPackageRecord;
  matrixTasks?: ProductionMatrixTask[];
}

export type V5RuntimeSource = "persisted" | "empty";
export type V5ReferenceSource = "v4_runtime" | "seed_fallback";
export type V5GovernanceSource = "v5_mysql" | "pending_config" | "failed";

export interface MonthlyWorkspaceBase {
  schemaVersion: 1;
  month: string;
  plan: V5MonthlyPlanRecord | null;
  draftPlan: MonthlyPlanConfig;
  rulePackages: RulePackageOption[];
  channels: string[];
  strategyRows: StrategyTermHit[];
  batchQueueItems: BatchQueueItem[];
  exceptionItems: ExceptionItem[];
  scheduleDraftItems: ScheduleDraftItem[];
  targetQuestions: TargetQuestionOption[];
  knowledgeBases: KnowledgeBaseOption[];
  articleExpressionPresets: ArticleExpressionPresetOption[];
  strategyPackage: ContentStrategyPackageRecord | null;
  productionTasks: ProductionMatrixTask[];
  source: {
    monthlyData: V5RuntimeSource;
    referenceData: V5ReferenceSource;
  };
}

export interface MonthlyWorkspaceReadModel extends MonthlyWorkspaceBase {
  source: MonthlyWorkspaceBase["source"] & {
    governanceData: V5GovernanceSource;
    productionQueue: "v5_mysql" | "pending_config" | "failed";
  };
  formal: {
    monthlyPlan: V5MonthlyPlan | null;
    productionReadiness: V5MonthlyProductionReadiness[];
    productionPoolEntries: V5ProductionPoolEntry[];
    message?: string;
  };
}

export type V5MonthlyWorkspace = MonthlyWorkspaceReadModel;

export interface SaveMonthlyPlanRequest {
  config: MonthlyPlanConfig;
  expectedVersion: number;
}

export interface StrategyMutationRequest {
  expectedVersion: number;
  auditReason: string;
}

export interface GenerateBatchRequest {
  taskIds?: string[];
  auditReason: string;
}

export interface BatchGenerationSummary {
  requested: number;
  available: number;
  awaitingMaterial: number;
  systemRecovering: number;
  replayed: boolean;
}

export interface PatchProductionDraftRequest {
  markdown: string;
  auditReason: string;
}

export interface ScheduleTaskRequest {
  expectedVersion: number;
  scheduledAt: string;
  platformAccount: string;
  auditReason: string;
}

export interface V5ApiError {
  code: string;
  message: string;
  details?: string[];
}

export type V5ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: V5ApiError };

import type { V5MonthlyPlan, V5MonthlyProductionReadiness, V5ProductionPoolEntry } from "./monthly-contracts";

