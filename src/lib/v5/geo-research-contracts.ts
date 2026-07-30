export type GeoResearchProjectStatus =
  | "draft"
  | "ready"
  | "researching"
  | "blueprint_review"
  | "ready_for_monthly_strategy"
  | "blocked"
  | "archived";

export type GeoResearchRunStatus =
  | "planned"
  | "queued"
  | "running"
  | "awaiting_frontend"
  | "synthesizing"
  | "pending_review"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type GeoResearchTaskStatus =
  | "blocked"
  | "queued"
  | "running"
  | "pending_config"
  | "completed"
  | "failed"
  | "cancelled";

export type GeoResearchTaskType =
  | "context_validation"
  | "research_planning"
  | "live_question_discovery"
  | "live_competitor_discovery"
  | "frontend_baseline"
  | "evidence_alignment"
  | "blueprint_synthesis";

export type GeoResearchEvidenceType =
  | "knowledge_source"
  | "search_result"
  | "web_snapshot"
  | "frontend_answer"
  | "visible_citation"
  | "answer_source_alignment";

export type GeoResearchFindingType =
  | "question_opportunity"
  | "competitor_mention"
  | "citation_pattern"
  | "content_gap"
  | "evidence_gap"
  | "relationship_error"
  | "capability_error"
  | "article_type_recommendation"
  | "channel_recommendation"
  | "retest_requirement";

export type GeoBlueprintStatus = "draft" | "pending_review" | "approved" | "changes_requested" | "superseded";

export interface GeoResearchProject {
  projectId: string;
  productId: string;
  status: GeoResearchProjectStatus;
  researchMarkets: string[];
  languages: string[];
  targetChannels: string[];
  expressionFocus: string;
  forbiddenFocus: string[];
  currentApprovedBlueprintVersionId?: string;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGeoResearchProjectInput {
  productId: string;
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  expressionFocus: string;
  forbiddenFocus?: string[];
}

export interface GeoResearchRun {
  runId: string;
  projectId: string;
  productId: string;
  runVersion: number;
  triggerType: "product_onboarding" | "manual_refresh" | "post_publish_retest";
  inputSourceSnapshotHash: string;
  plan: Record<string, unknown>;
  planSchemaVersion: string;
  status: GeoResearchRunStatus;
  liveSearchRequired: true;
  liveSearchVerified: boolean;
  rowVersion: number;
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeoResearchTask {
  taskId: string;
  runId: string;
  taskType: GeoResearchTaskType;
  dependencyIds: string[];
  provider?: string;
  providerModel?: string;
  toolName?: string;
  request: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  responseArtifactId?: string;
  status: GeoResearchTaskStatus;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  idempotencyKey: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeoResearchEvidence {
  evidenceId: string;
  runId: string;
  evidenceType: GeoResearchEvidenceType;
  sourceUrl?: string;
  sourceTitle?: string;
  publisher?: string;
  queryText?: string;
  snapshotHash?: string;
  contentLocator: Record<string, unknown>;
  capturedAt: string;
  verificationStatus: "verified" | "unverified" | "unverifiable";
  visibility: "public" | "controlled_internal";
  artifactId?: string;
}

export interface GeoResearchFinding {
  findingId: string;
  runId: string;
  findingType: GeoResearchFindingType;
  title: string;
  summary: string;
  evidenceIds: string[];
  confidence: number;
  reviewStatus: "candidate" | "confirmed" | "rejected";
  analyzerVersion: string;
  createdAt: string;
}

export type GeoResearchReadinessKey =
  | "product_identity"
  | "research_boundary"
  | "source_snapshot"
  | "live_search_provider";

export interface GeoResearchReadinessCheck {
  key: GeoResearchReadinessKey;
  label: string;
  status: "ready" | "blocked" | "pending_config";
  detail: string;
  actionLabel?: string;
  actionHref?: string;
  missingConfig?: string[];
}

export interface GeoResearchReadiness {
  status: "ready" | "blocked" | "pending_config";
  canCreateRun: boolean;
  canExecuteLiveResearch: boolean;
  latestSourceSnapshot?: {
    snapshotId: string;
    snapshotHash: string;
    sourceCount: number;
    revisionCount: number;
    approvedClaimCount: number;
    createdAt: string;
  };
  checks: GeoResearchReadinessCheck[];
}

export interface GeoBlueprintVersion {
  blueprintVersionId: string;
  projectId: string;
  runId: string;
  versionNumber: number;
  status: GeoBlueprintStatus;
  questionStrategy: Record<string, unknown>;
  competitorLandscape: Record<string, unknown>;
  citationStrategy: Record<string, unknown>;
  contentTypeStrategy: Record<string, unknown>;
  evidenceRequirements: Record<string, unknown>;
  rulePackageDraftRef?: string;
  monthlyStrategyInput: Record<string, unknown>;
  retestBaseline: Record<string, unknown>;
  researchSnapshotHash: string;
  rowVersion: number;
  approvedBy?: string;
  approvedAt?: string;
  immutableAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface GeoResearchWorkspace {
  project: GeoResearchProject;
  runs: GeoResearchRun[];
  latestRun?: GeoResearchRun;
  latestTasks: GeoResearchTask[];
  latestEvidence: GeoResearchEvidence[];
  latestFindings: GeoResearchFinding[];
  currentBlueprint?: GeoBlueprintVersion;
}

export interface GeoResearchRunWorkspace {
  run: GeoResearchRun;
  tasks: GeoResearchTask[];
  evidence: GeoResearchEvidence[];
  findings: GeoResearchFinding[];
  blueprint?: GeoBlueprintVersion;
}

export interface ProductGeoOverview {
  productId: string;
  projectStatus?: GeoResearchProjectStatus;
  latestRunStatus?: GeoResearchRunStatus;
  blueprintStatus?: GeoBlueprintStatus;
  hasSourceSnapshot: boolean;
  sourceCount: number;
  nextAction: "create_project" | "add_sources" | "configure_provider" | "review_blueprint" | "open_run" | "start_research" | "monthly_strategy";
}
