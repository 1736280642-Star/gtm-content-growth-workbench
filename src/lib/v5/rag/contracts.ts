import type {
  V5AuthorityLevel,
  V5ClaimScope,
  V5LifecycleStatus,
  V5SourceLocator,
  V5SupportMode,
  V5Visibility
} from "../knowledge-governance-contracts";

export const RAG_NAMESPACES = [
  "production_public",
  "production_internal",
  "governance_preview",
  "evaluation_sandbox",
  "isolated"
] as const;

export type RagNamespace = (typeof RAG_NAMESPACES)[number];
export type RagJobStatus =
  | "queued"
  | "running"
  | "pending_config"
  | "awaiting_validation"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled";
export type RagIndexSnapshotStatus =
  | "pending_config"
  | "building"
  | "validating"
  | "ready"
  | "active"
  | "superseded"
  | "rollback_target"
  | "archived";
export type RagChunkStatus = "active" | "review_required" | "blocked" | "superseded" | "expired" | "isolated";
export type RagChunkType = "source_parent" | "claim_chunk" | "context_chunk" | "official_citation" | "limitation_chunk";
export type RagEvidenceDecision =
  | "generatable"
  | "generatable_with_downgrade"
  | "needs_material"
  | "needs_review"
  | "blocked"
  | "pending_config";
export type RagEvidencePreviewStatus = "preview_ready" | "needs_material" | "needs_review" | "blocked" | "pending_config";
export type RagPlatformContentType =
  | "explicit_product_intro"
  | "explicit_launch_matrix"
  | "implicit_personal_review"
  | "implicit_painpoint_education"
  | "implicit_tool_guide"
  | "implicit_trend_judgment";

export interface RagActor {
  actorId: string;
  actorRole: string;
  actorType: "human" | "agent" | "scheduler" | "system";
  auditReason: string;
}

export interface RagIngestionManifest {
  manifestId: string;
  productId: string;
  knowledgeBaseIds: string[];
  activeRulePackageVersionId: string;
  approvedSourceRevisionIds: string[];
  approvedClaimIds: string[];
  blockedClaimIds: string[];
  unresolvedConflictIds: string[];
  authorityPolicyVersion: string;
  monthlyProductionReadinessId: string;
  matrixScopeVersion: string;
  manifestHash: string;
  status: "draft" | "awaiting_approval" | "approved" | "superseded" | "revoked";
  generatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface RagIndexSnapshot {
  indexSnapshotId: string;
  manifestId: string;
  namespace: RagNamespace;
  productId: string;
  language: string;
  indexVersion: string;
  indexName: string;
  indexAlias: string;
  status: RagIndexSnapshotStatus;
  chunkSchemaVersion: string;
  chunkerVersion: string;
  retrievalPolicyVersion: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  documentCount: number;
  manifestHash: string;
  validationSummary?: RagEvaluationSummary;
  immutableAt?: string;
  activatedAt?: string;
  supersedesSnapshotId?: string;
  createdAt: string;
}

export interface RagKnowledgeChunk {
  chunkId: string;
  indexSnapshotId: string;
  namespace: RagNamespace;
  productId: string;
  productName: string;
  knowledgeBaseIds: string[];
  sourceId: string;
  sourceRevisionId: string;
  parentChunkId?: string;
  primaryClaimId?: string;
  claimIds: string[];
  sourceLocator: V5SourceLocator;
  semanticType: RagChunkType | string;
  chunkTitle: string;
  summary: string;
  content: string;
  originalQuote: string;
  canonicalUrl?: string;
  documentType: string;
  authorityLevel: V5AuthorityLevel;
  lifecycleStatus: V5LifecycleStatus;
  visibility: V5Visibility;
  supportMode: V5SupportMode;
  claimScope: V5ClaimScope;
  capabilityStatus: V5LifecycleStatus;
  conditions: string[];
  limitations: string[];
  scenarioTags: string[];
  capabilityTags: string[];
  audienceTags: string[];
  problemTags: string[];
  channelTags: string[];
  distilledTermIds: string[];
  questionCandidateIds: string[];
  conflictGroupIds: string[];
  rulePackageVersionId: string;
  validFrom?: string;
  validUntil?: string;
  contentHash: string;
  semanticHash: string;
  duplicateClusterId: string;
  status: RagChunkStatus;
  chunkerVersion: string;
}

export interface RagRetrievalRoute {
  routeId: string;
  routeVersion: string;
  platformContentType: RagPlatformContentType;
  requiredSemanticTypes: string[];
  requiredEvidenceRoles: string[];
  forbiddenSupportModes: V5SupportMode[];
  requireOfficialCitation: boolean;
  requireLimitation: boolean;
  candidateLimits: { bm25: number; vector: number; relation: number; required: number; final: number };
  sourcePageLimit: number;
  duplicateClusterLimit: number;
}

export interface RagRetrievalRequest {
  retrievalRequestId: string;
  matrixItemId: string;
  taskId?: string;
  taskVersion?: number;
  productId: string;
  productName: string;
  namespace: RagNamespace;
  language: string;
  title: string;
  channel: string;
  contentType: string;
  platformContentType: RagPlatformContentType;
  targetAudience: string;
  sourceProblem: string;
  distilledTermIds: string[];
  rulePackageVersionId: string;
  permissionScope: V5Visibility[];
  lifecycleStatuses: V5LifecycleStatus[];
  requestedAt: string;
}

export interface RagRetrievalCandidate {
  chunk: RagKnowledgeChunk;
  channels: Array<"bm25" | "vector" | "relation" | "required">;
  rawScores: Partial<Record<"bm25" | "vector" | "relation" | "required", number>>;
  rrfScore: number;
  rerankScore: number;
  selected: boolean;
  exclusionReasons: string[];
  selectionReasons: string[];
  evidenceRoles: string[];
}

export interface RagRetrievalRun {
  retrievalRunId: string;
  retrievalRequestId: string;
  indexSnapshotIds: string[];
  routeId: string;
  routeVersion: string;
  retrievalPolicyVersion: string;
  status: "completed" | "needs_material" | "blocked" | "pending_config" | "failed";
  candidates: RagRetrievalCandidate[];
  selectedChunkIds: string[];
  missingEvidenceRoles: string[];
  startedAt: string;
  completedAt: string;
}

export interface RagEvidenceItem {
  evidenceItemId: string;
  chunkId: string;
  primaryClaimId?: string;
  claimIds: string[];
  sourceId: string;
  sourceRevisionId: string;
  sourceLocator: V5SourceLocator;
  title: string;
  summary: string;
  originalQuote: string;
  canonicalUrl?: string;
  documentType: string;
  authorityLevel: V5AuthorityLevel;
  supportMode: V5SupportMode;
  claimScope: V5ClaimScope;
  status: RagChunkStatus;
  version: string;
  conditions: string[];
  limitations: string[];
  validity: { validFrom?: string; validUntil?: string; lifecycleStatus: V5LifecycleStatus; capabilityStatus: V5LifecycleStatus };
  selectionReason: string[];
  allowedUsage: string[];
  forbiddenUsage: string[];
}

export interface RagEvidencePreview {
  evidencePreviewId: string;
  matrixItemId: string;
  matrixVersionId: string;
  retrievalRunId?: string;
  status: RagEvidencePreviewStatus;
  coreClaims: string[];
  provableAngles: string[];
  conditionalCapabilities: string[];
  officialCitations: RagEvidenceItem[];
  forbiddenTitleClaims: string[];
  gaps: string[];
  conflicts: string[];
  sourceSnapshotHash: string;
  expiresAt?: string;
  createdAt: string;
}

export interface RagClaimPlanSlot {
  slotId: string;
  evidenceRole: string;
  required: boolean;
  minItems: number;
  allowedSemanticTypes: string[];
  selectedEvidenceItemIds: string[];
  status: "satisfied" | "missing" | "blocked";
}

export interface RagClaimPlan {
  claimPlanVersion: string;
  platformContentType: RagPlatformContentType;
  requiredClaimIds: string[];
  forbiddenClaimIds: string[];
  slots: RagClaimPlanSlot[];
}

export interface RagFinalEvidencePack {
  evidencePackId: string;
  packVersion: number;
  monthlyPlanId: string;
  matrixVersionId: string;
  matrixItemId: string;
  taskId: string;
  taskVersion: number;
  retrievalRunId: string;
  indexSnapshotIds: string[];
  routeId: string;
  routeVersion: string;
  retrievalPolicyVersion: string;
  embeddingProvider: string;
  embeddingModel: string;
  rerankerModel?: string;
  rulePackageVersionId: string;
  taskSnapshot: Record<string, unknown>;
  governanceSnapshot: Record<string, unknown>;
  retrievalSnapshot: Record<string, unknown>;
  claimPlan: RagClaimPlan;
  evidenceGroups: Record<string, RagEvidenceItem[]>;
  evidenceItems: RagEvidenceItem[];
  gaps: string[];
  conflicts: string[];
  outdatedEvidence: string[];
  unverifiedClaims: string[];
  decision: RagEvidenceDecision;
  sourceSnapshotHash: string;
  snapshotHash: string;
  supersedesPackId?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  immutableAt: string;
  createdAt: string;
}

export interface RagEvaluationSummary {
  unapprovedProductionSources: number;
  crossProductHits: number;
  permissionBoundaryHits: number;
  blockedClaimHits: number;
  plannedAsCurrentHits: number;
  claimLocatorCompleteness: number;
  scopedFactRetention: number;
  coreClaimRecallAt10: number;
  conditionalLimitationRecall: number;
  officialCitationHitRate: number;
  duplicateClusterTop5Max: number;
  previewRiskAccuracy: number;
  finalPackDecisionAccuracy: number;
  blockingFalseNegatives: number;
  passed: boolean;
  blockers: string[];
}

export interface RagInfrastructureStatus {
  status: "ready" | "pending_config";
  mysql: { status: "ready" | "pending_config"; missingConfig: string[] };
  opensearch: { status: "ready" | "pending_config"; missingConfig: string[] };
  embedding: { status: "ready" | "pending_config"; provider?: string; model?: string; missingConfig: string[] };
}
