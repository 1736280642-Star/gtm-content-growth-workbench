export type SingleArticleOperationStatus = "running" | "completed" | "blocked" | "pending_config" | "failed";

export interface SingleArticleActor {
  actorId: string;
  actorRole: "workbench_operator" | "developer_admin";
  actorType: "human";
  auditReason: string;
}

export interface FactTrace {
  sentence: string;
  evidenceItemId: string;
  claimId: string;
  sourceRevisionId: string;
}

export interface HardRuleResult {
  passed: boolean;
  blockers: string[];
  checkedRuleCount: number;
  traceableFactCount: number;
  technicalRetryCount?: number;
  automaticRepairCount?: number;
}

export interface FormalGenerationRun {
  generationRunId: string;
  taskId: string;
  taskVersion: number;
  matrixItemId: string;
  finalEvidencePackId: string;
  provider: string;
  model?: string;
  status: "running" | "completed" | "pending_config" | "failed";
  correlationId: string;
  hardRuleResult: HardRuleResult;
  failureCode?: string;
  failureMessage?: string;
  nextAction?: string;
  testOnly: false;
  startedAt: string;
  completedAt?: string;
}

export interface FormalDraftVersion {
  draftVersionId: string;
  generationRunId: string;
  taskId: string;
  taskVersion: number;
  matrixItemId: string;
  finalEvidencePackId: string;
  rulePackageVersionId: string;
  versionNumber: number;
  title: string;
  markdown: string;
  factTraces: FactTrace[];
  hardRuleResult: HardRuleResult;
  copyAllowed: boolean;
  testOnly: false;
  createdBy: string;
  createdAt: string;
}

export interface SingleArticleResult {
  operationId: string;
  correlationId: string;
  replayed: boolean;
  retrievalRunId: string;
  evidencePreviewId?: string;
  finalEvidencePackId: string;
  evidenceDecision: "generatable";
  generationRun: FormalGenerationRun;
  draftVersion: FormalDraftVersion;
}

export interface SingleArticleFailure {
  code: string;
  message: string;
  nextAction: string;
  details?: string[];
}
