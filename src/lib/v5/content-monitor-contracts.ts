export type ContentMonitorPlatform = "wechat" | "csdn" | "juejin" | "zhihu";

export type ContentMonitorMetricKey = "publications" | "views" | "likes" | "favorites";

export type ContentMonitorSyncStatus = "ready" | "syncing" | "stale" | "auth_required" | "failed" | "never_synced";

export interface ContentMonitorMetricValues {
  views?: number;
  likes?: number;
  favorites?: number;
}

export interface ContentMonitorPublishedItem {
  publishResultId: string;
  matrixItemId: string;
  title: string;
  platform: ContentMonitorPlatform;
  publicUrl?: string;
  externalContentId?: string;
  publishedAt: string;
  latestMetrics: ContentMonitorMetricValues;
  latestCapturedAt?: string;
}

export interface ContentMonitorSnapshot extends ContentMonitorMetricValues {
  publishResultId: string;
  platform: ContentMonitorPlatform;
  metricDate: string;
  capturedAt: string;
}

export interface ContentMonitorPlatformSync {
  platform: ContentMonitorPlatform;
  status: ContentMonitorSyncStatus;
  lastSyncedAt?: string;
  nextSyncAt?: string;
  message?: string;
}

export interface ContentMonitorTrendPoint {
  date: string;
  totals: Record<ContentMonitorMetricKey, number>;
  platforms: Record<ContentMonitorPlatform, Record<ContentMonitorMetricKey, number>>;
}

export interface ContentMonitorMetricSummary {
  key: ContentMonitorMetricKey;
  value: number;
  previousValue: number;
  changeRate?: number;
  coveredContent: number;
  totalContent: number;
}

export interface ContentMonitorPlatformSummary extends ContentMonitorMetricValues {
  platform: ContentMonitorPlatform;
  publications: number;
  coveredContent: number;
  sync: ContentMonitorPlatformSync;
}

export interface ContentMonitorOverview {
  rangeDays: number;
  rangeStart: string;
  rangeEnd: string;
  previousRangeStart: string;
  dataAsOf: string;
  source: "formal_database" | "formal_workspace" | "local_adapter" | "pending_config";
  metrics: Record<ContentMonitorMetricKey, ContentMonitorMetricSummary>;
  trend: ContentMonitorTrendPoint[];
  platforms: ContentMonitorPlatformSummary[];
  content: ContentMonitorPublishedItem[];
  message?: string;
}

export interface ContentMonitorSyncResult {
  accepted: boolean;
  status: "completed" | "partial" | "pending_config" | "failed";
  syncedPlatforms: ContentMonitorPlatform[];
  capturedItems: number;
  message: string;
}

export type ContentMonitorFailureAlertKind = "publish_retry" | "removed_after_publish";

export interface ContentMonitorFailureAlert {
  id: string;
  kind: ContentMonitorFailureAlertKind;
  title: string;
  platform: ContentMonitorPlatform;
  occurredAt: string;
  reason: string;
  nextAction: string;
  retryCount?: number;
  publicUrl?: string;
}
