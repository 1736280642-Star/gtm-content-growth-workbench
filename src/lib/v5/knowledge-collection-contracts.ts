export type V5KnowledgeCollectionSourceType = "site" | "wechat_account";
export type V5KnowledgeCollectionRunStatus = "running" | "success" | "partial" | "failed";
export type V5KnowledgeCollectionItemStatus = "collected" | "updated" | "unchanged" | "failed";
export type V5KnowledgeCollectionGovernanceStatus = "archived" | "queued" | "indexed" | "pending_config" | "failed";
export type V5KnowledgeEntityType = "product" | "service" | "other";

export interface V5KnowledgeCollectionSource {
  sourceId: string;
  name: string;
  sourceType: V5KnowledgeCollectionSourceType;
  entryUrl?: string;
  accountId?: string;
  defaultKnowledgeBaseId: string;
  defaultProductId?: string;
  defaultProductName?: string;
  publicUseConfirmed: boolean;
  enabled: boolean;
  scheduleHour: number;
  lastStatus?: V5KnowledgeCollectionRunStatus;
  lastError?: string;
  lastCollectedAt?: string;
  nextCollectAt: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface V5KnowledgeCollectionRun {
  runId: string;
  sourceId?: string;
  status: V5KnowledgeCollectionRunStatus;
  discoveredCount: number;
  collectedCount: number;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface V5KnowledgeCollectionSnapshot {
  snapshotId: string;
  runId: string;
  sourceId: string;
  sourceName: string;
  sourceType: V5KnowledgeCollectionSourceType;
  title: string;
  url: string;
  contentHash?: string;
  content: string;
  excerpt: string;
  entityType: V5KnowledgeEntityType;
  entityName: string;
  productId?: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  classificationConfidence: number;
  classificationReasons: string[];
  classifierVersion: string;
  collectionStatus: V5KnowledgeCollectionItemStatus;
  governanceStatus: V5KnowledgeCollectionGovernanceStatus;
  governanceMessage?: string;
  materialId?: string;
  collectedAt: string;
}

export interface V5KnowledgeCollectionWorkspace {
  sources: V5KnowledgeCollectionSource[];
  todaySnapshots: V5KnowledgeCollectionSnapshot[];
  latestRuns: V5KnowledgeCollectionRun[];
  stateVersion: number;
}
