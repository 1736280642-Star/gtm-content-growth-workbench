import type { V5MutationContext } from "./observation-contracts";

export type SiteAuditStatus = "queued" | "running" | "completed" | "failed" | "pending_config";
export type SiteAuditFindingStatus = "open" | "remediation_created" | "fixing" | "pending_review" | "resolved" | "ignored";

export interface SiteAuditRun {
  id: string;
  version: number;
  scopeUrl: string;
  sitemapUrl?: string;
  status: SiteAuditStatus;
  auditedUrlCount: number;
  failedUrlCount: number;
  startedAt?: string;
  completedAt?: string;
  executorVersion?: string;
  failureReason?: string;
  source: "site_audit_runner" | "pending_config";
  createdAt: string;
  createdBy: string;
}

export interface SiteAuditFinding {
  id: string;
  runId: string;
  version: number;
  url: string;
  category: "technical" | "schema" | "content" | "citability";
  severity: "critical" | "high" | "medium" | "low";
  code: string;
  title: string;
  detectionEvidence: string;
  userImpact: string;
  recommendedRemediation: string;
  claimIds: string[];
  publishedContentIds: string[];
  status: SiteAuditFindingStatus;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SiteRemediationTask {
  id: string;
  findingId: string;
  version: number;
  assignee?: string;
  dueDate?: string;
  note: string;
  status: "open" | "in_progress" | "pending_review" | "closed";
  createdAt: string;
  createdBy: string;
}

export interface SiteAuditDiff {
  id: string;
  baselineRunId: string;
  comparisonRunId: string;
  newFindingIds: string[];
  persistentFindingIds: string[];
  resolvedFindingIds: string[];
  recurringFindingIds: string[];
  createdAt: string;
}

export interface SiteAuditWorkspace {
  source: "persisted" | "empty";
  runs: SiteAuditRun[];
  findings: SiteAuditFinding[];
  remediationTasks: SiteRemediationTask[];
  diffs: SiteAuditDiff[];
  score: null;
}

export interface CreateSiteAuditRequest extends V5MutationContext {
  scopeUrl: string;
  sitemapUrl?: string;
}

export interface CreateSiteRemediationRequest extends V5MutationContext {
  assignee?: string;
  dueDate?: string;
  note: string;
}
