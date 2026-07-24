export type AiFrontendPlatform = "chatgpt" | "yuanbao" | "doubao" | "kimi";

export type FrontendCaptureTaskStatus =
  | "draft"
  | "environment_checking"
  | "queued"
  | "waiting_for_browser"
  | "submitting_prompt"
  | "streaming"
  | "stabilizing"
  | "capturing"
  | "completed"
  | "needs_login"
  | "adapter_mismatch"
  | "interrupted"
  | "timed_out"
  | "capture_failed"
  | "cancelled";

export type CaptureFailureStatus = Extract<
  FrontendCaptureTaskStatus,
  "needs_login" | "adapter_mismatch" | "interrupted" | "timed_out" | "capture_failed"
>;

export type ObservationGapCode =
  | "answer_coverage_gap"
  | "citation_gap"
  | "evidence_gap"
  | "relationship_gap"
  | "freshness_gap"
  | "entity_gap"
  | "observation_uncertain";

export type ObservationGapDestination = "blog_candidate" | "knowledge_issue" | "site_audit" | "manual_review";

export interface V5MutationActor {
  actorId: string;
  actorRole: "content_growth" | "workbench_operator" | "knowledge_manager" | "developer_admin" | "capture_runner";
  actorType: "human" | "system" | "runner";
}

export interface V5MutationContext {
  actor: V5MutationActor;
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
}

export interface FrontendCaptureCondition {
  locale: string;
  region: string;
  conversationMode: "new_conversation";
  personalizationMode: "off";
  modelLabel: string;
}

export interface CaptureFailureDetail {
  status: CaptureFailureStatus;
  stage: FrontendCaptureTaskStatus;
  reason: string;
  retainedData: string[];
  resumable: boolean;
  recoveryAction: string;
  occurredAt: string;
}

export interface FrontendCaptureTask {
  id: string;
  captureSessionId: string;
  version: number;
  questionKey: string;
  questionVersionId?: string;
  questionText: string;
  temporaryQuestion: boolean;
  platform: AiFrontendPlatform;
  condition: FrontendCaptureCondition;
  status: FrontendCaptureTaskStatus;
  statusHistory: Array<{ status: FrontendCaptureTaskStatus; at: string; note: string }>;
  adapterVersion?: string;
  browserVersion?: string;
  manualIntervention: boolean;
  failure?: CaptureFailureDetail;
  answerId?: string;
  artifactId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CapturedCitation {
  id: string;
  label: string;
  url: string;
  title: string;
  visibleSnippet: string;
  position: number;
  capturedAt: string;
  verificationStatus: "verified" | "unverified";
  domainOwner?: string;
  sourceType?: "official" | "owned" | "third_party" | "unknown";
}

export interface CaptureCompletionSignals {
  answerNodeDetected: boolean;
  stopControlDisappeared: boolean;
  completionMarkerDetected: boolean;
  stableWindowMs: number;
  firstTokenWithinTimeout: boolean;
  totalTimeoutExceeded: boolean;
}

export interface FrontendCaptureArtifactManifest {
  taskId: string;
  captureSessionId: string;
  adapterVersion: string;
  browserVersion: string;
  startedAt: string;
  completedAt: string;
  answerHtmlSanitized: string;
  answerText: string;
  citations: Omit<CapturedCitation, "id">[];
  screenshot: {
    mimeType: "image/png" | "image/jpeg";
    dataBase64: string;
    redactionsApplied: string[];
    viewport: { width: number; height: number };
  };
  completionSignals: CaptureCompletionSignals;
  captureWarnings: string[];
}

export interface FrontendCaptureArtifact {
  id: string;
  taskId: string;
  captureSessionId: string;
  sha256: string;
  manifestSha256: string;
  screenshotArtifactId: string;
  screenshotSha256: string;
  screenshotByteLength: number;
  adapterVersion: string;
  browserVersion: string;
  storageClass: "controlled_local";
  immutable: true;
  createdAt: string;
}

export interface AnswerStatement {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  citationIds: string[];
}

export interface EvidenceMatch {
  id: string;
  statementId: string;
  sourceSnapshotHash?: string;
  claimIds: string[];
  chunkIds: string[];
  sourceIds: string[];
  status: "matched" | "unmatched" | "pending_config";
  explanation: string;
}

export interface CapturedAnswer {
  id: string;
  taskId: string;
  artifactId: string;
  questionKey: string;
  questionText: string;
  platform: AiFrontendPlatform;
  answerText: string;
  citations: CapturedCitation[];
  targetEntity?: string;
  targetEntityMentioned: boolean;
  parseVersions: Array<{
    version: number;
    parserVersion: string;
    statements: AnswerStatement[];
    evidenceMatches: EvidenceMatch[];
    createdAt: string;
  }>;
  gapAnalysisVersions: Array<{
    version: number;
    analyzerVersion: string;
    gapIds: string[];
    sourceSnapshotHash?: string;
    createdAt: string;
  }>;
  reviewVersion: number;
  createdAt: string;
}

export interface ObservationGap {
  id: string;
  answerId: string;
  statementId?: string;
  code: ObservationGapCode;
  title: string;
  explanation: string;
  evidenceLocation: string;
  confidence: number;
  suggestedDestinations: ObservationGapDestination[];
  status: "candidate" | "confirmed" | "rejected";
  analysisVersion: number;
  createdAt: string;
}

export interface ObservationReview {
  id: string;
  answerId: string;
  version: number;
  selectedGapIds: string[];
  decision: "confirmed" | "rejected";
  destinations: ObservationGapDestination[];
  note: string;
  downstream: Array<{
    target: "blog_candidate_adapter" | "knowledge_issue_adapter" | "site_audit_adapter" | "manual_review";
    status: "queued" | "pending_config" | "accepted";
    externalId?: string;
  }>;
  monthlyTaskCreated: false;
  sourceSnapshotHash?: string;
  createdAt: string;
  createdBy: string;
}

export interface CaptureConditionDifference {
  field: keyof FrontendCaptureCondition | "platform" | "adapterVersion";
  baselineValue: string;
  comparisonValue: string;
}

export interface CaptureComparison {
  id: string;
  questionKey: string;
  baselineTaskId: string;
  comparisonTaskId: string;
  conditionDifferences: CaptureConditionDifference[];
  comparable: true;
  conditionsMatched: boolean;
  trendConclusionAllowed: false;
  warning?: string;
  metrics: Array<{ label: string; baseline: string | number; comparison: string | number; change: string }>;
  semanticChanges: Array<{ type: "added" | "removed" | "unchanged"; text: string }>;
  citationChanges: { added: number; removed: number; domainOwnerChanges: number };
  createdAt: string;
  createdBy: string;
}

export interface CaptureEnvironmentStatus {
  checkedAt: string;
  source: "local_runner" | "pending_config";
  extension: {
    status: "connected" | "disconnected" | "pending_config";
    version?: string;
    lastHeartbeatAt?: string;
    privacy: { cookieUpload: false; passwordUpload: false; tokenUpload: false; taskPageOnly: true };
  };
  runner: { status: "ready" | "offline" | "pending_config"; endpoint: string; queueDepth: number; recoveryAction: string };
  adapters: Array<{
    platform: AiFrontendPlatform;
    version?: string;
    status: "ready" | "needs_login" | "adapter_mismatch" | "unsupported" | "pending_config";
    message: string;
    recoveryAction: string;
  }>;
}

export interface ObservationQuestionReference {
  questionVersionId: string;
  questionKey: string;
  text: string;
  targetEntity?: string;
  sourceSnapshotHash?: string;
}

export interface ObservationReferenceSnapshot {
  source: "formal_adapter" | "fixture" | "pending_config";
  questions: ObservationQuestionReference[];
  monthlyPlans: Array<{ monthlyPlanId: string; month: string; questionKeys: string[]; plannedContentCount: number }>;
  publishedContent: Array<{ contentId: string; questionKey: string; title: string; channel: string; publishedAt: string; metricSummary?: string }>;
  message?: string;
}

export interface FrontendCaptureWorkspace {
  source: "persisted" | "empty";
  reference: ObservationReferenceSnapshot;
  tasks: FrontendCaptureTask[];
  artifacts: FrontendCaptureArtifact[];
  answers: CapturedAnswer[];
  gaps: ObservationGap[];
  reviews: ObservationReview[];
  comparisons: CaptureComparison[];
  environment: CaptureEnvironmentStatus;
}

export interface CreateCaptureTasksRequest extends V5MutationContext {
  questionVersionId?: string;
  temporaryQuestionText?: string;
  platforms: AiFrontendPlatform[];
  condition: FrontendCaptureCondition;
  executionMode: "immediate_once";
}

export interface CreateComparisonRequest extends V5MutationContext {
  baselineTaskId: string;
  comparisonTaskId: string;
}

export interface ReviewObservationRequest extends V5MutationContext {
  selectedGapIds: string[];
  decision: "confirmed" | "rejected";
  destinations: ObservationGapDestination[];
  note: string;
}

export type V5ObservationApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: string[]; recoveryAction?: string } };
