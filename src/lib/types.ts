export type ChannelKey = "wechat" | "csdn" | "juejin" | "zhihu_toutiao_general";

export type ProductKey = "joto_brand" | "weike_guardrails";

export type FinalReviewMode = "default_final" | "manual_review";

export type LogMode = "demo_csv" | "csv_import" | "nginx_log" | "cdn_log";

export type DataConfidence = "real" | "imported" | "demo" | "pending";

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

export interface MonthlyPlan {
  id: string;
  monthStart: string;
  monthEnd: string;
  targetTotalCount: number;
  status: "draft" | "confirmed" | "running" | "completed";
}

export interface WorkspaceSetting {
  id: string;
  defaultPublishDays: number;
  defaultDailyCount: number;
  enabledChannels: ChannelKey[];
  enabledProducts: ProductKey[];
  finalReviewMode: FinalReviewMode;
  logMode: LogMode;
  updatedAt?: string;
}

export interface ContentTask {
  id: string;
  monthlyPlanId: string;
  publishDate: string;
  channel: ChannelKey;
  product: ProductKey;
  title: string;
  contentType: ContentType;
  targetKeywords: string[];
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
  qaResult: {
    passed: boolean;
    blockers: string[];
    warnings: string[];
  };
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
  type: "brand" | "product" | "official_blog" | "channel_history" | "competitor" | "source_site";
  trustLevel: "highest" | "high" | "medium" | "reference";
  status: "enabled" | "disabled";
  usageScope: string;
  lastSyncedAt?: string;
}
