export type SampleFeedbackCategory = "expression" | "structure" | "fact" | "strategy";

export interface SampleFeedbackIssue {
  category: SampleFeedbackCategory;
  segment: string;
  instruction: string;
}

export interface SampleArticleFeedbackInput {
  decision: "approved" | "changes_requested";
  ratings: {
    scenarioAuthenticity: number;
    boundaryClarity: number;
    factualReliability: number;
    readability: number;
    productFit: number;
  };
  strengths: string[];
  issues: SampleFeedbackIssue[];
  expressionDirectives: string[];
  reason: string;
}

export interface SampleArticleReviewState {
  eligible: boolean;
  productId?: string;
  productStrategyPackId?: string;
  strategyStatus?: string;
  productionContractId?: string;
  productionContractHash?: string;
  latestDecision?: SampleArticleFeedbackInput["decision"];
  latestFeedback?: SampleArticleFeedbackInput;
  latestDecidedBy?: string;
  latestDecidedAt?: string;
  calibrationVersionId?: string;
}

export const sampleRatingKeys = [
  "productFit",
  "scenarioAuthenticity",
  "readability",
  "boundaryClarity",
  "factualReliability"
] as const satisfies ReadonlyArray<keyof SampleArticleFeedbackInput["ratings"]>;

export function assertSampleArticleFeedback(input: SampleArticleFeedbackInput) {
  if (!input || !["approved", "changes_requested"].includes(input.decision)) throw new Error("sample_decision_invalid");
  if (!input.ratings || Object.keys(input.ratings).length !== sampleRatingKeys.length
    || sampleRatingKeys.some((key) => !Object.prototype.hasOwnProperty.call(input.ratings, key))) {
    throw new Error("sample_ratings_incomplete");
  }
  for (const value of sampleRatingKeys.map((key) => input.ratings[key])) {
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("sample_rating_invalid");
  }
  if (!input.reason?.trim() || input.reason.trim().length > 500) throw new Error("sample_reason_invalid");
  if (!Array.isArray(input.strengths) || !Array.isArray(input.issues) || !Array.isArray(input.expressionDirectives)) throw new Error("sample_feedback_invalid");
  if (input.strengths.length > 12 || input.issues.length > 20 || input.expressionDirectives.length > 12) throw new Error("sample_feedback_too_large");
  for (const issue of input.issues) {
    if (!issue || !["expression", "structure", "fact", "strategy"].includes(issue.category)
      || !issue.segment?.trim() || !issue.instruction?.trim()) throw new Error("sample_issue_invalid");
  }
  if (input.decision === "approved") {
    if (sampleRatingKeys.some((key) => input.ratings[key] < 4)) throw new Error("sample_approval_rating_too_low");
    if (input.issues.some((issue) => issue.category !== "expression")) throw new Error("sample_approval_has_domain_issue");
  }
}
