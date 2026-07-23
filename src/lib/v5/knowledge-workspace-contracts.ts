import type { V5AutomationTrace } from "./question-contracts";

export type V5KnowledgeVisibility = "internal_only" | "conditional_public" | "public";
export type V5KnowledgeMaterialStatus = "processing" | "ready" | "failed";
export type V5KnowledgeActionType = "critical_evidence_missing" | "public_scope_uncertain" | "unrecoverable_source_failure";
export type V5KnowledgeActionStatus = "open" | "resolved" | "dismissed";

export interface V5KnowledgeMaterialView {
  materialId: string;
  knowledgeBaseId: string;
  title: string;
  kind: "url" | "document" | "text";
  status: V5KnowledgeMaterialStatus;
  importedAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface V5KnowledgeUnderstandingItem {
  understandingId: string;
  summary: string;
  evidenceExcerpt: string;
  materialId: string;
  materialTitle: string;
  sourceOwner: string;
  visibility: V5KnowledgeVisibility;
  limitation?: string;
  trace: V5AutomationTrace;
}

export interface V5KnowledgeActionItem {
  actionItemId: string;
  knowledgeBaseId: string;
  type: V5KnowledgeActionType;
  title: string;
  description: string;
  recommendedAction: string;
  affectsProduction: boolean;
  affectedExpression?: string;
  status: V5KnowledgeActionStatus;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface V5KnowledgeBaseWorkspace {
  knowledgeBaseId: string;
  name: string;
  focus: string;
  defaultVisibility: V5KnowledgeVisibility;
  productionStatus: "ready" | "limited" | "empty";
  dataSource: "demo" | "imported" | "real";
  sourceSnapshotHash: string;
  sourceSnapshotVersion: number;
  materialCount: number;
  openActionCount: number;
  productionBlockingActionCount: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface V5KnowledgeBaseDetail extends V5KnowledgeBaseWorkspace {
  materials: V5KnowledgeMaterialView[];
  understanding: V5KnowledgeUnderstandingItem[];
  actionItems: V5KnowledgeActionItem[];
}
