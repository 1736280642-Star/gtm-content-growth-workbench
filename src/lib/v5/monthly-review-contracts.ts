import type { V5MutationContext } from "./observation-contracts";
import type { GeoQuestionMetric } from "./geo-monitoring-contracts";
import type { ProductGeoOptimizationSnapshot } from "./product-geo-optimization-contracts";

export interface MonthlyQuestionReview {
  id: string;
  month: string;
  questionKey: string;
  questionText: string;
  geoMonitoringApproved: boolean;
  monthlyPlanIds: string[];
  plannedContentCount: number;
  publishedContent: Array<{
    contentId: string;
    title: string;
    channel: string;
    publishedAt: string;
    publicUrl?: string;
    publishScheduleId?: string;
    liveness24h?: "pending" | "passed" | "failed";
    liveness72h?: "pending" | "passed" | "failed";
    removedAt?: string;
    hasMetricReturn?: boolean;
    metricSummary?: string;
  }>;
  captureTaskIds: string[];
  captureSummary: string;
  geoMetric?: GeoQuestionMetric;
  crossLineObservation?: string;
  lastRetestedAt?: string;
  confirmedGapCodes: string[];
  recommendationEvidenceRefs: string[];
  recommendation: string;
  dataStatus: "complete" | "partial" | "pending_config";
}

export interface NextMonthProposal {
  id: string;
  version: number;
  sourceMonthlyReviewId: string;
  sourceMonth: string;
  targetMonth: string;
  questionKey: string;
  recommendation: string;
  rationale: string;
  evidenceRefs: string[];
  status: "proposal" | "submitted_to_monthly_plan" | "dismissed";
  monthlyTaskCreated: false;
  quotaChanged: false;
  createdAt: string;
  createdBy: string;
}

export interface MonthlyReview {
  id: string;
  month: string;
  dataAsOf: string;
  source: "formal_adapter" | "fixture" | "pending_config";
  metrics: {
    plannedContent: number;
    publishedContent: number;
    effectiveMetricReturns: number;
    survival24hPassed: number;
    survival24hEligible: number;
    survival72hPassed: number;
    survival72hEligible: number;
    captureTasks: number;
    pendingGaps: number;
    activeMonitoringQuestions: number;
  };
  siteMonitoring: {
    source: "formal_database" | "pending_config" | "empty";
    latestRunId?: string;
    coreReadinessScore: number | null;
    openFindingCount: number;
    criticalFindingCount: number;
    newFindingCount: number;
    resolvedFindingCount: number;
    note: string;
  };
  questions: MonthlyQuestionReview[];
  productOptimizations: ProductGeoOptimizationSnapshot[];
  proposals: NextMonthProposal[];
  message?: string;
}

export interface CreateNextMonthProposalRequest extends V5MutationContext {
  questionReviewId: string;
  recommendation: string;
  rationale: string;
}
