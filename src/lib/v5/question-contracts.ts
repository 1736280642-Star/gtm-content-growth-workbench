export type V5QuestionStatus = "available" | "observing" | "decision_required" | "archived";
export type V5KeywordStatus = "effective" | "observing" | "excluded";
export type V5QuestionConflictType = "semantic" | "business";
export type V5QuestionDecisionStatus = "open" | "resolved_by_suggestion" | "corrected" | "ignored";

export interface V5QuestionKnowledgeReadiness {
  subjectKnowledgeBaseId?: string;
  productExpressionRulePackageId?: string;
  factSourceMappingId?: string;
  hasProductExpressionRulePackage: boolean;
  hasFactSourceMapping: boolean;
}

export interface V5QuestionConflictAssessment {
  hasConflict: boolean;
  categories: V5QuestionConflictType[];
  conflictingQuestionIds: string[];
}

export interface V5AutomationTrace {
  source: string;
  sourceIds: string[];
  algorithmVersion: string;
  confidence: number;
  recordedAt: string;
}

export interface V5AuditRecord {
  auditId: string;
  action: string;
  objectType: string;
  objectId: string;
  actorId: string;
  actorRole: string;
  actorType: "human" | "system" | "agent" | "scheduler";
  reason: string;
  createdAt: string;
}

export interface V5QuestionVersion {
  questionVersionId: string;
  questionId: string;
  versionNumber: number;
  text: string;
  normalizedText: string;
  product?: string;
  entities: string[];
  relationship?: string;
  audience?: string;
  suggestedArticleTypes: string[];
  sourceSummary: Record<string, number>;
  trace: V5AutomationTrace;
  createdAt: string;
}

export interface V5QuestionSet {
  questionId: string;
  currentVersionId: string;
  status: V5QuestionStatus;
  keywordIds: string[];
  evidenceGap: boolean;
  knowledgeReadiness: V5QuestionKnowledgeReadiness;
  conflictAssessment: V5QuestionConflictAssessment;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface V5QuestionView extends V5QuestionSet {
  currentVersion: V5QuestionVersion;
  keywords: string[];
  openDecisionCount: number;
}

export interface V5SemanticKeyword {
  keywordId: string;
  text: string;
  normalizedText: string;
  status: V5KeywordStatus;
  relatedQuestionIds: string[];
  relatedEntities: string[];
  recallScore: number;
  trace: V5AutomationTrace;
  exclusionReason?: string;
  excludedAt?: string;
  rowVersion: number;
  updatedAt: string;
}

export interface V5QuestionDecisionException {
  exceptionId: string;
  questionId: string;
  questionVersionId: string;
  type: V5QuestionConflictType;
  title: string;
  explanation: string;
  suggestion: string;
  status: V5QuestionDecisionStatus;
  trace: V5AutomationTrace;
  resolutionReason?: string;
  resolvedAt?: string;
  rowVersion: number;
  createdAt: string;
}

export interface V5QuestionSignalInput {
  text: string;
  source: "site_search" | "sales_question" | "ai_observation" | "published_content" | "manual";
  sourceId: string;
  /** Source quality is retained for traceability only and never determines question status. */
  sourceConfidence?: number;
  /** @deprecated Use sourceConfidence. Retained for existing signal producers. */
  confidence?: number;
  product?: string;
  entities?: string[];
  relationship?: string;
  audience?: string;
  suggestedArticleTypes?: string[];
  keywords?: string[];
  knowledgeReadiness?: Partial<V5QuestionKnowledgeReadiness>;
  conflicts?: V5QuestionConflictType[];
  conflictingQuestionIds?: string[];
  evidenceGap?: boolean;
}

export interface V5MonthlyQuestionLock {
  lockId: string;
  month: string;
  questionId: string;
  questionVersionId: string;
  lockedAt: string;
  lockedBy: string;
}

export interface V5ContentCoverageRow {
  questionId: string;
  questionVersionId: string;
  question: string;
  articleType: string;
  publishedCount: number;
  plannedCount: number;
  evidenceGap?: string;
}
