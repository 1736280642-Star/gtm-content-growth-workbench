import type { V5MutationContext } from "./observation-contracts";

export interface MonthlyQuestionReview {
  id: string;
  month: string;
  questionKey: string;
  questionText: string;
  monthlyPlanIds: string[];
  plannedContentCount: number;
  publishedContent: Array<{
    contentId: string;
    title: string;
    channel: string;
    publishedAt: string;
    metricSummary?: string;
  }>;
  captureTaskIds: string[];
  captureSummary: string;
  confirmedGapCodes: string[];
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
    captureTasks: number;
    pendingGaps: number;
  };
  questions: MonthlyQuestionReview[];
  proposals: NextMonthProposal[];
  message?: string;
}

export interface CreateNextMonthProposalRequest extends V5MutationContext {
  questionReviewId: string;
  recommendation: string;
  rationale: string;
}
