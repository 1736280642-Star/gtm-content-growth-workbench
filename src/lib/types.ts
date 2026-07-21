export type ChannelKey = "wechat" | "csdn" | "juejin" | "zhihu_toutiao_general";

export type DistributionPlatformKey = "weixin" | "csdn" | "juejin" | "zhihu" | "toutiao";

export type DirectPublishPlatformKey = "wechat" | "juejin" | "csdn" | "zhihu";

export type PublishScheduleStatus =
  | "scheduled"
  | "precheck_failed"
  | "publishing"
  | "published_verified"
  | "published_pending_url"
  | "pending_verify"
  | "failed"
  | "manual_takeover_required"
  | "pending_config";

export type PublishAttemptStatus =
  | "precheck_failed"
  | "publishing"
  | "published_verified"
  | "published_pending_url"
  | "pending_verify"
  | "failed"
  | "manual_takeover_required"
  | "pending_config";

export type PublishFailureCode =
  | "auth_required"
  | "pending_config"
  | "payload_invalid"
  | "platform_not_supported"
  | "platform_review_pending"
  | "verification_failed"
  | "manual_takeover_required"
  | "duplicate_protected"
  | "adapter_failed"
  | "unknown";

export type DistributionTargetStatus = "pending" | "checking" | "auth_required" | "ready" | "sending" | "draft_created" | "failed" | "cancelled";

export type DistributionTargetErrorCode =
  | "bridge_not_configured"
  | "bridge_unreachable"
  | "extension_disconnected"
  | "platform_not_supported"
  | "auth_required"
  | "variant_missing"
  | "qa_blocked"
  | "sync_failed"
  | "timeout"
  | "unknown";

export type ProductKey = "joto_brand" | "weike_guardrails";

export type FinalReviewMode = "default_final" | "manual_review";

export type LogMode = "demo_csv" | "csv_import" | "nginx_log" | "cdn_log";

export type WorkspaceRole = "content_publisher" | "content_growth" | "workbench_operator" | "knowledge_manager" | "developer_admin";

export type DataConfidence = "real" | "imported" | "demo" | "pending";

export type KnowledgeSourceType = "url" | "markdown" | "pdf" | "docx" | "manual" | "auto_crawl";

export type KnowledgeSourceStatus = "pending" | "fetching" | "parsed" | "failed";

export type KnowledgeFetchProvider = "cache" | "xcrawl" | "proxy_fetch" | "local_fetch" | "manual" | "site_import";

export type KnowledgeCrawlFailureCode = "pending_config" | "blocked" | "timeout" | "http_error" | "empty_content" | "parser_failed" | "invalid_url";

export type KnowledgeChunkingStrategy = "rule" | "auto" | "semantic_llm";

export type KnowledgeEmbeddingStatus = "not_required" | "pending_config" | "fallback_hash" | "real_embedding" | "failed";

export type KnowledgeRetrievalStrategy = "keyword" | "hybrid" | "vector";

export type KnowledgeChunkingModelProvider = "qwen" | "doubao" | "deepseek";

export type KnowledgeEmbeddingModelProvider = "qwen_embedding" | "doubao_embedding";

export type ProductExpressionRulePackageMode = "none" | "new" | "existing";

export interface KnowledgeRagConfig {
  chunkingStrategy?: KnowledgeChunkingStrategy;
  chunkingModelProvider?: KnowledgeChunkingModelProvider;
  embeddingModelProvider?: KnowledgeEmbeddingModelProvider;
  retrievalStrategy?: KnowledgeRetrievalStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
  updatedAt?: string;
}

export type PromptVersionStatus = "active" | "rolled_back";

export type DraftGenerationFailureCode =
  | "provider_config_missing"
  | "model_failure"
  | "structure_failure"
  | "evidence_missing"
  | "rule_failure"
  | "product_boundary"
  | "channel_mismatch";

export interface DraftGenerationFailure {
  code: DraftGenerationFailureCode;
  label: string;
  severity: "blocker" | "warning";
  message: string;
  nextAction: string;
}

export type DraftEditActionType = "manual_edit" | "delete_risk_segment" | "ai_rewrite_segment" | "keep_risk_segment" | "run_qa";

export type DraftRiskKeepReasonCategory = "false_positive" | "evidence_added" | "business_exception" | "source_quote" | "uncategorized";

export type DraftQualityGrade = "A" | "B" | "C" | "D";

export type DraftQualityStatus = "pass" | "warning" | "review_required" | "blocked";

export type DraftQualityIssueCode =
  | "evidence_insufficient"
  | "product_expression_boundary"
  | "channel_format_mismatch"
  | "official_source_missing"
  | "exaggerated_claim"
  | "title_content_mismatch"
  | "brand_term_missing"
  | "product_term_missing"
  | "risk_kept_with_reason";

export type DraftQualitySuggestedAction = "delete" | "rewrite" | "add_evidence" | "manual_review" | "keep_with_reason";

export type DraftQualityFeedbackTarget = "prompt" | "rule_package" | "evidence_selection" | "channel_template" | "weekly_plan";

export interface DraftEditAction {
  id: string;
  type: DraftEditActionType;
  source: "user" | "local_rule" | "ai_provider";
  segment?: string;
  originalText?: string;
  rewrittenText?: string;
  reason?: string;
  keepReasonCategory?: DraftRiskKeepReasonCategory;
  beforeLength?: number;
  afterLength?: number;
  changedCharacterCount?: number;
  changedRatio?: number;
  createdAt: string;
}

export type TaskStatus =
  | "planned"
  | "confirmed"
  | "rejected"
  | "generated"
  | "qa_failed"
  | "pending_review"
  | "approved"
  | "queued"
  | "published"
  | "url_filled"
  | "measured";

export type ContentType = "brand" | "scenario" | "technical" | "faq" | "comparison" | "case";

export type PlatformContentType =
  | "explicit_product_intro"
  | "explicit_launch_matrix"
  | "implicit_personal_review"
  | "implicit_painpoint_education"
  | "implicit_tool_guide"
  | "implicit_trend_judgment";

export interface WeeklyPublishMatrixDay {
  date: string;
  weekday: string;
  plannedCount: number;
  paused: boolean;
  locked: boolean;
  source: "manual" | "ai_suggested" | "system_default";
}

export interface ProductPlanConfig {
  product: ProductKey;
  weeklyQuota: number;
  channels: ChannelKey[];
  knowledgeBaseIds?: string[];
  knowledgeBaseId?: string;
  productExpressionRulePackageId?: string;
  enabled: boolean;
}

export interface DraftQaIssue {
  code?: DraftQualityIssueCode;
  label?: string;
  severity: "blocker" | "warning" | "review";
  rule: string;
  location: string;
  failedText?: string;
  failedSegment?: string;
  suggestedAction: DraftQualitySuggestedAction | string;
  feedbackTarget?: DraftQualityFeedbackTarget;
  allowedActions?: ("restore_previous" | "delete_failed_segment" | "ai_rewrite_segment" | "keep_failed_segment")[];
}

export interface DraftQaResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  summary?: string;
  qualityGrade?: DraftQualityGrade;
  qualityStatus?: DraftQualityStatus;
  qualitySummary?: string;
  issues?: DraftQaIssue[];
  editedSegments?: string[];
  editActions?: DraftEditAction[];
  failedSegments?: string[];
  copyAllowed?: boolean;
  distributionAllowed?: boolean;
  feedbackTarget?: DraftQualityFeedbackTarget;
}

export interface WeeklyPlan {
  id: string;
  weekStart: string;
  weekEnd: string;
  targetTotalCount: number;
  status: "draft" | "confirmed" | "running" | "completed";
  publishMatrix?: WeeklyPublishMatrixDay[];
  productPlans?: ProductPlanConfig[];
  generationSource?: WeeklyPlanGenerationSource;
}

export interface WeeklyPlanGenerationSignal {
  key: "knowledge_base" | "product_expression" | "distilled_terms" | "blog_diagnosis" | "weekly_report";
  label: string;
  status: "used" | "available" | "missing";
  count?: number;
  summary: string;
}

export interface WeeklyPlanGenerationSource {
  mode: "local_rule" | "ai_provider";
  promptVersion: string;
  generatedAt: string;
  matrixIssueCount: number;
  signals: WeeklyPlanGenerationSignal[];
}

export interface WeeklyReportSuggestionDecision {
  id: string;
  week: string;
  suggestion: string;
  status: "adopted" | "partially_adopted" | "rejected";
  reason?: string;
  decidedAt: string;
}

export interface WeeklyRecommendationOutcome {
  id: string;
  week: string;
  suggestion: string;
  decisionStatus: WeeklyReportSuggestionDecision["status"];
  evaluationStatus: "measured" | "waiting_next_week" | "not_applicable";
  completionRateDelta?: number;
  dataReturnRateDelta?: number;
  channelPerformanceDelta?: number;
  failureReason?: string;
  modelLearningSignal: string;
  evaluatedAt: string;
}

export interface WeeklyPlanQualitySignal {
  key: "rejected_titles" | "risk_accepted" | "manual_edits" | "title_regenerated" | "low_confidence_review";
  label: string;
  count: number;
  status: "normal" | "attention" | "blocked";
  summary: string;
  nextStep: string;
  examples: string[];
}

export interface WeeklyPlanQualityFeedback {
  totalPlanItems: number;
  confirmedCount: number;
  rejectedCount: number;
  riskAcceptedCount: number;
  manualEditCount: number;
  regeneratedTitleCount: number;
  lowConfidencePlannedCount: number;
  reviewRequiredCount: number;
  signals: WeeklyPlanQualitySignal[];
  modelLearningSignals: string[];
}

export interface WeeklyReportDistilledTermMatrixRow {
  id: string;
  term: string;
  contentCoverage: number;
  typeCompleteness: string;
  geoLift: number;
  competitorOccupied: boolean;
  nextSuggestion: string;
}

export interface WeeklyReportSnapshot {
  week: string;
  targetTotalCount: number;
  executiveSummary: string;
  publishRecords: PublishRecord[];
  blogDiagnostics: BlogArticle[];
  distilledTerms: DistilledTerm[];
  distilledTermMatrix: WeeklyReportDistilledTermMatrixRow[];
  promptTemplates: PromptVersionRecord[];
  nextWeekSuggestions: string[];
  planQualityFeedback: WeeklyPlanQualityFeedback;
  dataSource: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceSetting {
  id: string;
  defaultWeeklyDays: number;
  defaultDailyCount: number;
  enabledChannels: ChannelKey[];
  enabledProducts: ProductKey[];
  productPlans?: ProductPlanConfig[];
  currentRole: WorkspaceRole;
  finalReviewMode: FinalReviewMode;
  logMode: LogMode;
  knowledgeRagConfig?: KnowledgeRagConfig;
  updatedAt?: string;
}

export interface PromptVersionRecord {
  id: string;
  name: string;
  version: string;
  previousVersion?: string;
  usedAt: string;
  inputContract: string[];
  outputContract: string[];
  failureRules: string[];
  status: PromptVersionStatus;
  releaseNote: string;
  rollbackPolicy: string;
  rollbackReason?: string;
  rolledBackAt?: string;
  updatedAt?: string;
}

export interface ContentTaskEditRecord {
  id: string;
  field: string;
  label: string;
  before?: string;
  after?: string;
  source: "manual" | "ai_regenerate" | "system";
  editedAt: string;
}

export interface ContentTaskRiskAcceptanceRecord {
  id: string;
  reasons: string[];
  note: string;
  source: "manual";
  acceptedAt: string;
}

export interface ContentTaskTitleSourceAttribution {
  key: WeeklyPlanGenerationSignal["key"] | "publish_matrix" | "system_rule";
  label: string;
  role: "primary" | "supporting";
  summary: string;
  referenceId?: string;
}

export interface ContentTaskRejectionRecord {
  id: string;
  reason: string;
  rejectedFromStatus: TaskStatus;
  rejectedAt: string;
  restoredAt?: string;
  restoreReason?: string;
}

export interface ContentTask {
  id: string;
  weeklyPlanId: string;
  publishDate: string;
  channel: ChannelKey;
  product: ProductKey;
  title: string;
  contentType: ContentType;
  targetKeywords: string[];
  primaryDistilledTerm?: string;
  knowledgeBaseIds?: string[];
  knowledgeBaseId?: string;
  productExpressionRulePackageId?: string;
  sourceProblem?: string;
  officialLinkTarget?: string;
  titleReason?: string;
  platformContentType?: PlatformContentType;
  platformExpressionProfileId?: string;
  platformExpressionProfileVersion?: string;
  platformExpressionPrecheck?: {
    evidenceSupported: boolean;
    bodyProvable: boolean;
    roleBoundarySafe: boolean;
    notes: string[];
  };
  /** Legacy title-only fields retained while local task data migrates to platform-expression fields. */
  titleRulePackageId?: string;
  titleRuleVersion?: string;
  titleCategory?: string;
  targetAudience?: string;
  titleEvidenceBasis?: string[];
  titlePrecheck?: {
    evidenceSupported: boolean;
    bodyProvable: boolean;
    roleBoundarySafe: boolean;
    notes: string[];
  };
  riskNote?: string;
  evidenceNeed?: string;
  confidence?: number;
  locked?: boolean;
  status: TaskStatus;
  qaSummary?: string;
  editRecords?: ContentTaskEditRecord[];
  riskAcceptanceRecords?: ContentTaskRiskAcceptanceRecord[];
  titleSourceAttributions?: ContentTaskTitleSourceAttribution[];
  rejectionRecords?: ContentTaskRejectionRecord[];
}

export interface ArticleDraft {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  content: string;
  channel: ChannelKey;
  qaResult: DraftQaResult;
  version: number;
  status: "draft" | "final" | "discarded";
  generationSource?: {
    mode: "local_rule" | "ai_provider";
    provider?: string;
    model?: string;
    promptProfile?: string;
    evidenceProfile?: string;
    productExpressionRuleVersion?: string;
    productExpressionRuleSource?: string;
    selectedChunkIds?: string[];
    evidenceSummary?: string;
    missingEvidence?: string[];
    evidenceSupplement?: string;
    fallbackTriggered?: boolean;
    failureReasons?: DraftGenerationFailure[];
    generatedAt: string;
    status: "success" | "pending_config" | "failed";
  };
  updatedAt?: string;
}

export interface PlatformDraftVariant {
  id: string;
  articleDraftId: string;
  publishRecordId: string;
  platform: DistributionPlatformKey;
  title: string;
  summary?: string;
  content: string;
  contentHash: string;
  sourceDraftVersion: number;
  qaResult: DraftQaResult;
  status: "draft" | "final" | "discarded";
  generatedAt: string;
  updatedAt?: string;
}

export interface PublishRecord {
  id: string;
  draftId: string;
  channel: ChannelKey;
  title: string;
  publishStatus: "queued" | "published" | "url_filled" | "failed";
  plannedPublishDate?: string;
  sourceWeek?: string;
  publishedUrl?: string;
  publishedAt?: string;
  exportedAt?: string;
  notes?: string;
  channelMetrics?: {
    impressions?: number;
    views?: number;
    likes?: number;
    favorites?: number;
    comments?: number;
    shares?: number;
    importedAt: string;
  };
}

export interface DistributionTarget {
  id: string;
  publishRecordId: string;
  draftId: string;
  taskId: string;
  platformVariantId?: string;
  platform: DistributionPlatformKey;
  status: DistributionTargetStatus;
  draftUrl?: string;
  editorUrl?: string;
  externalDraftId?: string;
  mode?: "mock" | "real";
  errorCode?: DistributionTargetErrorCode;
  errorMessage?: string;
  lastCheckedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PlatformPublishPayload {
  title: string;
  markdown: string;
  summary?: string;
  scheduledAt: string;
  sourceDraftId: string;
  publishRecordId?: string;
  matrixItemId?: string;
  coverMediaId?: string;
  categoryId?: string;
  tagIds?: string[];
  dryRun?: boolean;
}

export interface PublishSchedule {
  id: string;
  platform: DirectPublishPlatformKey;
  status: PublishScheduleStatus;
  scheduledAt: string;
  draftId: string;
  publishRecordId?: string;
  matrixItemId?: string;
  attemptIds: string[];
  latestAttemptId?: string;
  publishedAt?: string;
  platformArticleId?: string;
  publicUrl?: string;
  pendingCsvReturn?: boolean;
  failureCode?: PublishFailureCode;
  failureReason?: string;
  nextAction?: string;
  retryCount: number;
  manualTakeoverReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PublishAttempt {
  id: string;
  scheduleId: string;
  platform: DirectPublishPlatformKey;
  status: PublishAttemptStatus;
  startedAt: string;
  finishedAt?: string;
  mode: "mock" | "dry_run" | "real";
  authStatus: "ready" | "pending_config" | "auth_required" | "manual_takeover_required" | "failed";
  payloadStatus: "valid" | "invalid";
  publishStatus?: "submitted" | "confirmed" | "pending_review" | "failed";
  verifyStatus?: "verified" | "pending" | "failed" | "not_started";
  platformArticleId?: string;
  publicUrl?: string;
  pendingCsvReturn?: boolean;
  failureCode?: PublishFailureCode;
  failureReason?: string;
  nextAction?: string;
  diagnosticSummary?: string;
}

export interface KnowledgeChunk {
  id: string;
  knowledgeBaseId: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceTitle: string;
  sectionPath: string;
  chunkTitle: string;
  content: string;
  tokenCount: number;
  contentHash: string;
  chunkStrategy?: KnowledgeChunkingStrategy | "structured_rule" | "semantic_fallback";
  embeddingStatus?: KnowledgeEmbeddingStatus;
  embeddingModel?: string;
  embeddingVector?: number[];
  status: "enabled" | "disabled" | "needs_review";
}

export interface KnowledgeSource {
  id: string;
  knowledgeBaseId: string;
  type: "url" | "manual_text" | "legacy";
  title: string;
  url?: string;
  rawText?: string;
  extractedText: string;
  markdown: string;
  status: KnowledgeSourceStatus;
  fetchProvider: KnowledgeFetchProvider;
  errorCode?: KnowledgeCrawlFailureCode;
  errorMessage?: string;
  addedAt: string;
  parsedAt?: string;
  contentHash?: string;
}

export interface ProductExpressionRuleSnapshot {
  version: string;
  status: "draft" | "active" | "archived";
  sourceChunkCount: number;
  generatedAt?: string;
  activatedAt?: string;
  summary: string;
  doExpressions: string[];
  dontExpressions: string[];
  boundaryNotes: string[];
  distilledTermSuggestions: string[];
}

export interface ProductExpressionRuleDraft {
  id: string;
  version: string;
  status: "draft" | "active" | "archived";
  previousVersion?: string;
  previousSnapshot?: ProductExpressionRuleSnapshot;
  activatedAt?: string;
  archivedAt?: string;
  sourceKnowledgeBaseId: string;
  sourceKnowledgeBaseName: string;
  sourceChunkCount: number;
  generatedAt?: string;
  summary: string;
  doExpressions: string[];
  dontExpressions: string[];
  boundaryNotes: string[];
  distilledTermSuggestions: string[];
}

export interface DistilledTerm {
  id: string;
  term: string;
  level: "core" | "scenario" | "product";
  source: string;
  sourceQuestion?: string;
  sourceAssetId?: string;
  product?: ProductKey;
  confidence?: number;
  generationMode?: "knowledge_base" | "search_question" | "manual_seed";
  generatedAt?: string;
  archivedAt?: string;
  validationStatus: "auto_validated" | "pending" | "disabled";
  modelConsensusCount: number;
  status: "active" | "watching" | "disabled";
  coveredContentTypes?: ContentType[];
  geoLift?: number;
  competitorOccupied?: boolean;
}

export interface DistilledTermExtractionRule {
  id: string;
  ruleName: string;
  mappedTerm: string;
  level: DistilledTerm["level"];
  product?: ProductKey;
  patterns: string[];
  source: "system_seed" | "question_rule_draft" | "manual";
  sourceQuestions?: string[];
  riskNote?: string;
  confidence: number;
  status: "active" | "disabled";
  createdAt?: string;
  activatedAt?: string;
}

export interface DistilledTermRuleDraft {
  id: string;
  ruleName: string;
  mappedTerm: string;
  level: DistilledTerm["level"];
  product?: ProductKey;
  patterns: string[];
  sourceQuestions: string[];
  riskNote: string;
  confidence: number;
  status: "pending" | "active" | "discarded";
  createdAt: string;
  activatedAt?: string;
  discardedAt?: string;
  activatedRuleId?: string;
}

export interface BlogArticle {
  id: string;
  title: string;
  url: string;
  indexedStatus: "indexed" | "unknown" | "not_indexed";
  seoIssueCount: number;
  geoResult: "hit" | "miss" | "partial";
  dataConfidence: DataConfidence;
  contentHash?: string;
  lastCrawledAt?: string;
  candidateStatus?: "none" | "candidate" | "planned" | "dismissed";
  candidateReason?: string;
  candidateAddedAt?: string;
  sourceWeek?: string;
}

export interface BotVisitSummary {
  id: string;
  path: string;
  botName: string;
  pv: number;
  dataConfidence: DataConfidence;
  summaryDate?: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  type: "brand" | "product" | "official_blog" | "channel_history" | "competitor" | "custom";
  trustLevel: "highest" | "high" | "medium" | "reference";
  status: "enabled" | "disabled";
  usageScope: string;
  lastSyncedAt?: string;
  sourceType?: KnowledgeSourceType;
  sourceUrl?: string;
  sources?: KnowledgeSource[];
  contentPreview?: string;
  chunks?: KnowledgeChunk[];
  chunkingStrategy?: KnowledgeChunkingStrategy;
  chunkingModel?: string;
  embeddingModel?: string;
  retrievalStrategy?: KnowledgeRetrievalStrategy;
  vectorizationStatus?: KnowledgeEmbeddingStatus;
  productExpressionSource?: boolean;
  productExpressionRulePackageMode?: ProductExpressionRulePackageMode;
  linkedProductExpressionRulePackageId?: string;
  productExpressionRuleDraft?: ProductExpressionRuleDraft;
  autoCrawl?: {
    enabled: boolean;
    weekday: number;
    hour: number;
    lastCrawledAt?: string;
    nextCrawlAt?: string;
    sourceUrl?: string;
    status?: "idle" | "running" | "success" | "failed";
    totalDiscovered?: number;
    importedCount?: number;
    failedCount?: number;
    importedUrls?: string[];
    startedAt?: string;
    completedAt?: string;
    lastError?: string;
  };
}
