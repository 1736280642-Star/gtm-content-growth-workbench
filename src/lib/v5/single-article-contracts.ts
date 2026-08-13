export type SingleArticleOperationStatus = "running" | "completed" | "blocked" | "pending_config" | "failed";

export interface SingleArticleActor {
  actorId: string;
  actorRole: "workbench_operator" | "developer_admin" | "knowledge_production_worker";
  actorType: "human" | "system" | "scheduler";
  auditReason: string;
}

export interface FactTrace {
  sentence: string;
  evidenceItemId: string;
  claimId: string;
  sourceRevisionId: string;
  originalQuote?: string;
  sourceLocator?: {
    headingPath: string[];
    pageNumber?: number;
    paragraphIndex?: number;
    characterRange?: [number, number];
    tableCell?: string;
  };
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
  productionContractId: string;
  productionContractHash: string;
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
  productionContractId: string;
  productionContractHash: string;
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
  evidenceDecision: "generatable" | "generatable_with_downgrade";
  generationRun: FormalGenerationRun;
  draftVersion: FormalDraftVersion;
}

export interface SingleArticleFailure {
  code: string;
  message: string;
  nextAction: string;
  details?: string[];
}
