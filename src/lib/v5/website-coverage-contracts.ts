export type WebsiteKnowledgeReadiness = "ready" | "partial" | "blocked";
export type WebsitePublicGeoReadiness = "pending_audit" | "ready" | "partial" | "blocked";
export type WebsiteTopicCoverageStatus = "sufficient" | "partial" | "missing" | "uncertain";

export type WebsiteCoverageTopic =
  | "core_service"
  | "provider_selection"
  | "capability_boundary"
  | "implementation_delivery"
  | "case_practice"
  | "faq";

export interface ProductWebsiteSourceStatus {
  id: string;
  productId: string;
  sourceId: string;
  sourceRevisionId: string;
  canonicalUrl: string;
  contentHash: string;
  ownershipStatus: "official" | "external" | "unverified";
  knowledgeReadiness: WebsiteKnowledgeReadiness;
  publicGeoReadiness: WebsitePublicGeoReadiness;
  siteAuditRunId?: string;
  auditRulesetVersion?: string;
  lastAuditedAt?: string;
  lastError?: string;
}

export interface WebsiteTopicCoverage {
  topic: WebsiteCoverageTopic;
  label: string;
  status: WebsiteTopicCoverageStatus;
  pageUrls: string[];
  sourceIds: string[];
  claimIds: string[];
  evidenceRequired: boolean;
  reason: string;
}

export interface ProductWebsiteCoverageProfile {
  id: string;
  productId: string;
  profileVersion: number;
  sourceSnapshotId?: string;
  latestSiteAuditRunId?: string;
  knowledgeReadiness: WebsiteKnowledgeReadiness;
  publicGeoReadiness: WebsitePublicGeoReadiness;
  officialSources: ProductWebsiteSourceStatus[];
  topicCoverage: WebsiteTopicCoverage[];
  criticalFindingCodes: string[];
  evidenceGaps: string[];
  profileHash: string;
  generatedAt: string;
}

export interface OfficialWebsiteImportCandidate {
  productId: string;
  sourceId: string;
  sourceRevisionId: string;
  canonicalUrl: string;
  contentHash: string;
  authorityLevel: string;
}
