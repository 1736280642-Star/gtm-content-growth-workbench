import type { ObservationGapCode, ObservationGapRecommendedAction, ObservationGapRootCause } from "./observation-contracts";
import type { WebsitePublicGeoReadiness } from "./website-coverage-contracts";

export type ProductGeoOptimizationStatus = "collecting" | "ready" | "blocked";
export type ProductGeoOptimizationPriority = "P0" | "P1" | "P2" | "hold";

export interface ProductGeoOptimizationGap {
  code: ObservationGapCode;
  rootCause: ObservationGapRootCause;
  recommendedAction: ObservationGapRecommendedAction;
  reason: string;
  evidenceRefs: string[];
}

export interface ProductGeoOptimizationAction {
  action: ObservationGapRecommendedAction | "hold";
  priority: ProductGeoOptimizationPriority;
  title: string;
  rationale: string;
  target: "official_website" | "existing_content" | "content_candidate_pool" | "knowledge_base" | "monitoring";
  candidateDestination: "current_month_candidate_pool" | "next_month_candidate_pool" | "none";
  articleTypePortfolioItemId?: string;
  articleTypeVersionId?: string;
  evidenceRefs: string[];
  automaticExecutionAllowed: false;
}

export interface ProductGeoOptimizationSnapshot {
  id: string;
  productId: string;
  productName: string;
  month: string;
  matrixVersionId?: string;
  strategyPackId?: string;
  batchKey: string;
  status: ProductGeoOptimizationStatus;
  priority: ProductGeoOptimizationPriority;
  batchClosed: boolean;
  inputEvidenceHash: string;
  websiteReadiness: WebsitePublicGeoReadiness | "unknown";
  signals: {
    plannedContentCount: number;
    publishedContentCount: number;
    stablePublishedContentCount: number;
    captureTaskCount: number;
    successfulCaptureCount: number;
    targetMentionRate: number | null;
    ownedCitationRate: number | null;
    targetSolutionCitationRate: number | null;
    relationshipAccuracyRate: number | null;
  };
  gaps: ProductGeoOptimizationGap[];
  actions: ProductGeoOptimizationAction[];
  publishedContentIds: string[];
  captureTaskIds: string[];
  sourceSiteAuditRunId?: string;
  generatedAt: string;
}

export interface ProductGeoOptimizationWorkspace {
  source: "formal_database" | "pending_config";
  products: ProductGeoOptimizationSnapshot[];
  generatedAt: string;
  message?: string;
}
