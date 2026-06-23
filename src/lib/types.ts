export type ChannelKey = "wechat" | "csdn" | "juejin" | "zhihu_toutiao_general";

export type ProductKey = "joto_brand" | "weike_guardrails";

export type GeoPlatformName = "DeepSeek" | "豆包" | "通义千问";

export type FinalReviewMode = "default_final" | "manual_review";

export type LogMode = "demo_csv" | "csv_import" | "nginx_log" | "cdn_log";

export type DataConfidence = "real" | "imported" | "demo" | "pending";

export type KnowledgeSourceType = "url" | "markdown" | "docx" | "manual" | "auto_crawl";

export type TaskStatus =
  | "planned"
  | "confirmed"
  | "generated"
  | "qa_failed"
  | "pending_review"
  | "approved"
  | "queued"
  | "published"
  | "url_filled"
  | "measured";

export type ContentType = "brand" | "scenario" | "technical" | "faq" | "comparison" | "case";

export interface DraftQaIssue {
  severity: "blocker" | "warning";
  rule: string;
  location: string;
  failedText?: string;
  suggestedAction: string;
  allowedActions?: ("restore_previous" | "delete_failed_segment")[];
}

export interface DraftQaResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  summary?: string;
  issues?: DraftQaIssue[];
  editedSegments?: string[];
  failedSegments?: string[];
  copyAllowed?: boolean;
}

export interface WeeklyPlan {
  id: string;
  weekStart: string;
  weekEnd: string;
  targetTotalCount: number;
  status: "draft" | "confirmed" | "running" | "completed";
}

export interface WorkspaceSetting {
  id: string;
  defaultWeeklyDays: number;
  defaultDailyCount: number;
  enabledChannels: ChannelKey[];
  enabledProducts: ProductKey[];
  finalReviewMode: FinalReviewMode;
  geoPlatforms: GeoPlatformName[];
  logMode: LogMode;
  updatedAt?: string;
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
  sourceProblem?: string;
  officialLinkTarget?: string;
  status: TaskStatus;
  qaSummary?: string;
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
    generatedAt: string;
    status: "success" | "pending_config" | "failed";
  };
  updatedAt?: string;
}

export interface PublishRecord {
  id: string;
  draftId: string;
  channel: ChannelKey;
  title: string;
  publishStatus: "queued" | "published" | "url_filled" | "failed";
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

export interface KnowledgeChunk {
  id: string;
  knowledgeBaseId: string;
  sourceUrl?: string;
  sourceTitle: string;
  sectionPath: string;
  chunkTitle: string;
  content: string;
  tokenCount: number;
  contentHash: string;
  status: "enabled" | "disabled" | "needs_review";
}

export interface DistilledTerm {
  id: string;
  term: string;
  level: "core" | "scenario" | "product";
  source: string;
  validationStatus: "auto_validated" | "pending" | "disabled";
  modelConsensusCount: number;
  status: "active" | "watching" | "disabled";
  coveredContentTypes?: ContentType[];
  geoLift?: number;
  competitorOccupied?: boolean;
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
}

export interface GeoTestResult {
  id: string;
  platform: GeoPlatformName;
  promptGroup: "品牌认知" | "产品场景" | "对比" | "FAQ";
  distilledTermIds?: string[];
  prompt: string;
  mentionedJoto: boolean;
  mentionedWeike: boolean;
  citedOfficialUrl: boolean;
  citationLevel?: "official_site_direct" | "official_content" | "official_channel" | "non_official" | "none";
  competitorAppeared?: boolean;
  citedUrls?: string[];
  issueType?: string;
  suggestedAction?: string;
  accuracyStatus?: "accurate" | "needs_review" | "inaccurate";
  reviewStatus?: "auto_checked" | "manual_review_needed" | "manual_confirmed";
  answerSnapshot: string;
  manualOverride: boolean;
  dataConfidence?: DataConfidence;
  executionStatus?: "success" | "pending_config" | "failed";
  providerKey?: "deepseek" | "doubao" | "qwen";
  modelName?: string;
  testedAt?: string;
  errorMessage?: string;
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
  contentPreview?: string;
  chunks?: KnowledgeChunk[];
  autoCrawl?: {
    enabled: boolean;
    weekday: number;
    hour: number;
    lastCrawledAt?: string;
    nextCrawlAt?: string;
  };
}
