export type V5AuthorityLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "D" | "E";
export type V5LifecycleStatus = "current" | "beta" | "planned" | "deprecated" | "expired" | "unknown";
export type V5Visibility = "public" | "internal" | "restricted_customer" | "confidential" | "unknown";
export type V5GovernanceRole =
  | "business_owner"
  | "product_owner"
  | "technical_owner"
  | "security_owner"
  | "privacy_owner"
  | "legal_owner"
  | "delivery_owner"
  | "knowledge_manager";

export type V5IngestionBatchStatus =
  | "draft"
  | "parsing"
  | "classifying"
  | "awaiting_entity_review"
  | "extracting_claims"
  | "reviewing_conflicts"
  | "generating_rule_draft"
  | "awaiting_approval"
  | "completed"
  | "blocked_sensitive_data"
  | "blocked_entity_ambiguous"
  | "blocked_evidence_conflict"
  | "partial_failed"
  | "failed"
  | "cancelled";

export type V5SourceAssetStatus =
  | "pending_parse"
  | "parsed"
  | "review_required"
  | "approved_for_claim_extraction"
  | "isolated"
  | "superseded"
  | "deprecated"
  | "parse_failed";

export type V5ProductClaimStatus = "candidate" | "supported" | "conditional" | "disputed" | "rejected" | "superseded" | "expired";
export type V5SupportMode = "direct" | "qualified" | "derived" | "negative" | "background_only" | "unsupported";
export type V5ClaimScope =
  | "public_product"
  | "specific_version"
  | "specific_deployment"
  | "specific_customer"
  | "representative_anonymized_case"
  | "beta"
  | "planned"
  | "internal_only";

export type V5RulePackageVersionStatus =
  | "draft_pending_confirmation"
  | "draft_pending_business_confirmation"
  | "draft_pending_technical_confirmation"
  | "draft_pending_security_confirmation"
  | "draft_pending_privacy_confirmation"
  | "draft_pending_legal_confirmation"
  | "draft_pending_delivery_confirmation"
  | "active"
  | "deprecated"
  | "rolled_back"
  | "archived";

export type V5ApprovalAction =
  | "approve"
  | "approve_with_conditions"
  | "request_changes"
  | "reject"
  | "request_more_evidence"
  | "accept_conservative_wording"
  | "defer";

export type V5EvidenceGapSeverity = "info" | "warning" | "high" | "blocking";
export type V5GateCode = "G0" | "G1" | "G2" | "G3" | "G4" | "G5" | "G6";

export interface V5ProductEntity {
  productId: string;
  canonicalName: string;
  displayName: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases: string[];
  status: "active" | "deprecated" | "archived";
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface V5ProductEntityCandidate {
  candidateId: string;
  candidateName: string;
  aliases: string[];
  brandCandidate?: string;
  officialUrlCandidate?: string;
  categoryCandidate?: string;
  discoveredSourceId: string;
  similarProductIds: string[];
  similarities: string[];
  conflicts: string[];
  confidence: number;
  status: "pending_review" | "confirmed_new" | "linked_existing" | "rejected";
  resolutionProductId?: string;
}

export interface V5IngestionBatch {
  batchId: string;
  idempotencyKey: string;
  purpose?: string;
  targetKnowledgeBaseId?: string;
  targetProductId?: string;
  status: V5IngestionBatchStatus;
  currentGate: V5GateCode;
  sourceCount: number;
  successCount: number;
  failedCount: number;
  isolatedCount: number;
  pendingReviewCount: number;
  parserVersion?: string;
  classifierVersion?: string;
  extractorVersion?: string;
  requestedBy: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface V5MonthlySupport {
  supportedContentTypes: string[];
  supportedChannels: string[];
  evidenceRoles: string[];
  limitationCodes: string[];
}

export interface V5SourceAsset {
  sourceId: string;
  batchId: string;
  knowledgeBaseId: string;
  importMethod: "url" | "file" | "manual_text" | "batch_manifest";
  documentType: string;
  authorityLevel: V5AuthorityLevel;
  lifecycleStatus: V5LifecycleStatus;
  visibility: V5Visibility;
  title?: string;
  canonicalUrl?: string;
  fileName?: string;
  mimeType?: string;
  language?: string;
  contentHash?: string;
  rawAssetRef?: string;
  normalizedTextRef?: string;
  capturedAt?: string;
  sourceUpdatedAt?: string;
  validFrom?: string;
  validUntil?: string;
  productCandidates: string[];
  classificationConfidence: number;
  classificationReasons: string[];
  status: V5SourceAssetStatus;
  qualityFlags: string[];
  monthlySupport: V5MonthlySupport;
  safetyStatus: "pending" | "passed" | "isolated" | "restricted_approved";
  safetyRiskTypes: string[];
  isolatedReason?: string;
  createdBy: string;
}

export interface V5SourceRevision {
  sourceRevisionId: string;
  sourceId: string;
  revisionNumber: number;
  contentHash: string;
  rawAssetRef?: string;
  normalizedTextRef: string;
  titleSnapshot?: string;
  canonicalUrlSnapshot?: string;
  capturedAt: string;
  sourceUpdatedAt?: string;
  parserName: string;
  parserVersion: string;
  parseStatus: "parsed" | "parse_failed";
  qualityFlags: string[];
  contentLength: number;
  supersedesRevisionId?: string;
}

export interface V5SourceLocator {
  headingPath: string[];
  pageNumber?: number;
  paragraphIndex?: number;
  characterRange?: [number, number];
  tableCell?: string;
}

export interface V5ProductClaim {
  claimId: string;
  productId: string;
  subjectType: "product" | "external" | "cross_product";
  claimType: string;
  normalizedClaim: string;
  originalQuote: string;
  sourceId: string;
  sourceRevisionId: string;
  sourceLocator: V5SourceLocator;
  authorityLevel: V5AuthorityLevel;
  supportMode: V5SupportMode;
  capabilityStatus: V5LifecycleStatus;
  claimScope: V5ClaimScope;
  conditions: string[];
  limitations: string[];
  productVersion?: string;
  validFrom?: string;
  validUntil?: string;
  confidence: number;
  extractionModel?: string;
  extractionPromptVersion?: string;
  extractorVersion: string;
  parentClaimIds: string[];
  reviewStatus: V5ProductClaimStatus;
  conflictGroupId?: string;
  supersedesClaimId?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface V5ClaimConflict {
  conflictGroupId: string;
  productId: string;
  conflictType:
    | "value_conflict"
    | "status_conflict"
    | "scope_conflict"
    | "version_conflict"
    | "time_conflict"
    | "ownership_conflict"
    | "privacy_conflict"
    | "case_conflict"
    | "comparison_conflict";
  subject: string;
  claimIds: string[];
  sourceIds: string[];
  preferredTemporaryClaimId?: string;
  temporaryPolicy:
    | "use_more_conservative_claim"
    | "downgrade_to_conditional"
    | "remove_metric"
    | "limit_to_specific_version"
    | "limit_to_specific_deployment"
    | "mark_as_planned_or_unverified"
    | "block_public_expression";
  severity: V5EvidenceGapSeverity;
  requiredRoles: V5GovernanceRole[];
  status: "open" | "resolved" | "accepted_risk" | "superseded";
  resolution?: Record<string, unknown>;
}

export interface V5EvidenceGap {
  gapId: string;
  productId: string;
  gapCode: string;
  title: string;
  description?: string;
  affectedRuleFields: string[];
  affectedClaimTypes: string[];
  triggerSourceIds: string[];
  severity: V5EvidenceGapSeverity;
  status: "open" | "in_progress" | "resolved" | "accepted_risk" | "superseded";
  recommendedAction: string;
  ownerRole: V5GovernanceRole;
  dueAt?: string;
  resolvedBySourceIds: string[];
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface V5MonthlyMatrixScope {
  allowedContentTypes: string[];
  conditionalContentTypes: string[];
  blockedContentTypes: string[];
  allowedChannels: string[];
  requiredEvidenceRoles: string[];
  maxMonthlyQuota?: number;
  readinessReasonCodes: string[];
}

export interface V5RuleCapability {
  capabilityId: string;
  name: string;
  status: "confirmed" | "conditional" | "beta" | "planned" | "deprecated" | "disputed";
  scope?: string;
  conditions: string[];
  limitations: string[];
  applicableVersion?: string;
  evidenceClaimIds: string[];
}

export interface V5RulePackageChange {
  changeId: string;
  rulePackageVersionId: string;
  section: string;
  fieldPath: string;
  changeType:
    | "added"
    | "strengthened"
    | "weakened"
    | "condition_added"
    | "condition_removed"
    | "status_changed"
    | "evidence_upgraded"
    | "evidence_downgraded"
    | "conflict_detected"
    | "deprecated"
    | "removed"
    | "no_material_change";
  before?: unknown;
  after?: unknown;
  reason: string;
  claimIds: string[];
  sourceIds: string[];
  riskLevel: V5EvidenceGapSeverity;
  requiredRoles: V5GovernanceRole[];
  reviewStatus: "pending" | "approved" | "changes_requested" | "rejected";
}

export interface V5RulePackageVersion {
  rulePackageVersionId: string;
  rulePackageId: string;
  productId: string;
  version: string;
  status: V5RulePackageVersionStatus;
  pendingRoles: V5GovernanceRole[];
  basedOnVersionId?: string;
  sourceBatchIds: string[];
  linkedKnowledgeBaseIds: string[];
  linkedSourceIds: string[];
  linkedClaimIds: string[];
  productIdentity: Record<string, unknown>;
  capabilities: V5RuleCapability[];
  allowedExpressions: unknown[];
  conditionalExpressions: unknown[];
  blockedExpressions: unknown[];
  evidenceRequirements: unknown[];
  channelBoundaries: unknown[];
  officialCitationRules: unknown[];
  evidenceGapIds: string[];
  conflictRefs: string[];
  distilledTermSuggestions: unknown[];
  questionSuggestions: unknown[];
  monthlyMatrixScope: V5MonthlyMatrixScope;
  changeSet: V5RulePackageChange[];
  claimSetHash: string;
  sourceSnapshotHash: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
  activatedAt?: string;
  immutableAt?: string;
}

export interface V5ApprovalRecord {
  approvalId: string;
  objectType: "claim" | "change" | "package" | "source" | "conflict" | "exception";
  objectId: string;
  confirmationUnit: "claim" | "change" | "package";
  role: V5GovernanceRole;
  action: V5ApprovalAction;
  status: "pending" | "approved" | "changes_requested" | "rejected" | "deferred";
  actorId: string;
  beforeSummary?: Record<string, unknown>;
  afterSummary?: Record<string, unknown>;
  reason: string;
  evidenceSourceIds: string[];
  impactSummary: Record<string, unknown>;
  createdAt: string;
}

export interface V5TermCandidate {
  candidateId: string;
  term: string;
  productId: string;
  level: string;
  sourceClaimIds: string[];
  sourceIds: string[];
  generationReason: string;
  confidence: number;
  riskFlags: string[];
  status: "pending_review" | "confirmed" | "discarded";
  monthlyPlanId?: string;
  matrixCoverageStatus?: string;
  contentTypes: string[];
  channels: string[];
}

export interface V5QuestionCandidate {
  candidateId: string;
  question: string;
  productId: string;
  intentType: string;
  sourceClaimIds: string[];
  sourceIds: string[];
  generationReason: string;
  confidence: number;
  riskFlags: string[];
  status: "pending_review" | "confirmed" | "discarded";
}

export interface V5SourceSnapshot {
  sourceSnapshotId: string;
  productId: string;
  sourceSnapshotHash: string;
  sourceIds: string[];
  sourceRevisionIds: string[];
  approvedClaimIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface V5GovernanceAuditEvent {
  auditEventId: string;
  eventType: string;
  actorId: string;
  actorRole: string;
  actorType: "human" | "agent" | "scheduler" | "system";
  objectType: string;
  objectId: string;
  relatedSourceIds: string[];
  beforeSummary?: Record<string, unknown>;
  afterSummary?: Record<string, unknown>;
  reason: string;
  correlationId?: string;
  createdAt: string;
}
