export const productGeoGraphContractVersion = "product-geo-graph.v1" as const;

export type ProductGeoGraphExecutionMode = "shadow" | "active";
export type ProductGeoGraphStatus =
  | "running"
  | "awaiting_strategy_review"
  | "awaiting_sample_review"
  | "awaiting_research_config"
  | "awaiting_changes"
  | "completed"
  | "failed";

export interface HumanGraphDecision {
  decision: "approve" | "request_changes" | "reject";
  actorId: string;
  actorRole: string;
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
}

export interface ProductGeoGraphStateValue {
  contractVersion: typeof productGeoGraphContractVersion;
  workflowId: string;
  threadId: string;
  productId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  researchPolicyVersion: string;
  executionMode: ProductGeoGraphExecutionMode;
  providerRunIds: string[];
  researchEvidencePackId?: string;
  researchAttempt: number;
  supplementaryRound: number;
  researchDisposition?: "passed" | "needs_supplement" | "pending_config" | "failed";
  strategyPackId?: string;
  strategyDecision?: HumanGraphDecision;
  sampleTaskId?: string;
  sampleDraftId?: string;
  sampleDecision?: HumanGraphDecision;
  calibrationVersionId?: string;
  status: ProductGeoGraphStatus;
  currentNode?: string;
  exceptionCodes: string[];
  nodeHistory: string[];
}

export interface ProductGeoGraphResearchResult {
  disposition: "passed" | "needs_supplement" | "pending_config" | "failed";
  providerRunIds?: string[];
  researchEvidencePackId?: string;
  errorCode?: string;
}

export interface ProductGeoGraphPorts {
  ensureSourceSnapshot(state: ProductGeoGraphStateValue): Promise<{ sourceSnapshotId: string; sourceSnapshotHash: string }>;
  runResearch(state: ProductGeoGraphStateValue): Promise<ProductGeoGraphResearchResult>;
  compileStrategy(state: ProductGeoGraphStateValue): Promise<{ strategyPackId: string }>;
  applyStrategyDecision(state: ProductGeoGraphStateValue, decision: HumanGraphDecision): Promise<{ status: "approved" | "changes_requested" | "rejected" }>;
  generateSample(state: ProductGeoGraphStateValue): Promise<{ sampleTaskId: string; sampleDraftId: string }>;
  applySampleDecision(state: ProductGeoGraphStateValue, decision: HumanGraphDecision): Promise<{ status: "approved" | "changes_requested" | "rejected"; calibrationVersionId?: string }>;
  onNodeEvent?(event: {
    workflowId: string;
    threadId: string;
    nodeName: string;
    status: "completed" | "failed";
    inputRefs: Record<string, unknown>;
    outputRefs: Record<string, unknown>;
    durationMs: number;
    errorCode?: string;
  }): Promise<void>;
}

export function assertHumanGraphDecision(value: unknown): asserts value is HumanGraphDecision {
  const decision = value as Partial<HumanGraphDecision> | null;
  if (!decision || !["approve", "request_changes", "reject"].includes(String(decision.decision))) throw new Error("invalid_human_decision");
  for (const field of ["actorId", "actorRole", "reason", "idempotencyKey"] as const) {
    if (typeof decision[field] !== "string" || !decision[field]?.trim()) throw new Error(`invalid_human_decision_${field}`);
  }
  if (!Number.isInteger(decision.expectedVersion) || Number(decision.expectedVersion) < 1) throw new Error("invalid_human_decision_expected_version");
}
