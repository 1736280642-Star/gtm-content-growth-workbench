import type { V5MutationContext } from "./observation-contracts";

export type SiteAuditStatus = "queued" | "running" | "completed" | "failed" | "pending_config";
export type SiteAuditFindingStatus = "open" | "remediation_created" | "fixing" | "pending_review" | "resolved" | "ignored";
export type GeoEvidenceSource = "page_audit_deterministic" | "ui_capture_real" | "grounded_api" | "server_log" | "llm_derived" | "manual";
export type SiteAuditPageType = "privacy_policy" | "terms" | "article" | "product_service" | "general" | "technical_resource";

export interface SiteAuditRemediationGuidance {
  pageType: SiteAuditPageType;
  pageContext: string;
  targetLocations: string[];
  actions: string[];
  suggestedCopy: string[];
  acceptanceCriteria: string[];
}

export interface SiteAuditRun {
  id: string;
  version: number;
  productId?: string;
  scopeUrl: string;
  sitemapUrl?: string;
  scopeMode: "single_page" | "site";
  status: SiteAuditStatus;
  auditedUrlCount: number;
  failedUrlCount: number;
  startedAt?: string;
  completedAt?: string;
  executorVersion?: string;
  rulesetVersion: string;
  coreReadinessScore?: number;
  technicalReadinessScore?: number;
  contentCitabilityScore?: number;
  platformComplianceScore?: number;
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
  category: "technical" | "schema" | "content" | "citability" | "compliance";
  severity: "critical" | "high" | "medium" | "low";
  code: string;
  title: string;
  detectionEvidence: string;
  evidenceSource: Extract<GeoEvidenceSource, "page_audit_deterministic">;
  userImpact: string;
  recommendedRemediation: string;
  remediationGuidance?: SiteAuditRemediationGuidance;
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
  source: "formal_database" | "pending_config" | "empty";
  runs: SiteAuditRun[];
  findings: SiteAuditFinding[];
  remediationTasks: SiteRemediationTask[];
  diffs: SiteAuditDiff[];
  score: number | null;
  experimentalSignals: Array<{ code: string; status: "present" | "missing" | "unknown"; note: string }>;
}

export interface CreateSiteAuditRequest extends V5MutationContext {
  productId?: string;
  scopeUrl: string;
  sitemapUrl?: string;
  scopeMode?: "single_page" | "site";
}

export interface SiteAuditPageSnapshot {
  id: string;
  runId: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  renderMode: "raw_html" | "browser_rendered";
  contentHash: string;
  evidence: Record<string, unknown>;
  fetchedAt: string;
}

export interface CreateSiteRemediationRequest extends V5MutationContext {
  assignee?: string;
  dueDate?: string;
  note: string;
}
