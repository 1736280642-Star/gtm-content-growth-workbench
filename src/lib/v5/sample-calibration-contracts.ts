export interface SampleArticleFeedbackInput {
  decision: "approved" | "changes_requested";
  revisionInstruction?: string;
}

export interface SampleArticleReviewState {
  eligible: boolean;
  productId?: string;
  productStrategyPackId?: string;
  articleTypeVersionId?: string;
  taskId?: string;
  strategyStatus?: string;
  reviewStatus?: string;
  productionContractId?: string;
  productionContractHash?: string;
  latestDecision?: SampleArticleFeedbackInput["decision"];
  latestFeedback?: SampleArticleFeedbackInput;
  latestDecidedBy?: string;
  latestDecidedAt?: string;
  calibrationVersionId?: string;
}

export function assertSampleArticleFeedback(input: SampleArticleFeedbackInput) {
  if (!input || !["approved", "changes_requested"].includes(input.decision)) throw new Error("sample_decision_invalid");
  const instruction = String(input.revisionInstruction || "").trim();
  if (input.decision === "changes_requested" && !instruction) throw new Error("sample_revision_instruction_required");
  if (instruction.length > 1200) throw new Error("sample_revision_instruction_too_long");
}
