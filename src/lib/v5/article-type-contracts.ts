export type ArticleTypeProfileStatus = "draft" | "active" | "disabled";
export type ArticleTypeVersionStatus = "draft" | "active" | "superseded";
export type ArticleTypeFieldSource = "user_input" | "ai_suggested" | "user_confirmed" | "template_inherited";
export type ArticleTypeFitLevel = "high" | "medium" | "possible";
export type TypeSelectionStatus = "suggested" | "accepted" | "rejected" | "manual_added";
export type TypeSelectionSource = "ai_recommended" | "user_selected";

export interface ArticleTypeLengthRange {
  min: number;
  max: number;
  unit: "字";
}
export interface ArticleTypeProfileVersion {
  profileVersionId: string;
  profileId: string;
  version: number;
  name: string;
  semanticDescription: string;
  suitableQuestionDescription: string;
  unsuitableQuestionDescription: string;
  targetAudience: string[];
  contentGoal: string;
  structureModules: string[];
  requiredSections: string[];
  cta: string;
  lengthRange: ArticleTypeLengthRange;
  styleTraits: string[];
  caseUsage: string;
  evidencePreferences: string[];
  channelHints: string[];
  exampleQuestions: string[];
  promptConstraintSnapshot: string;
  promptConstraintSnapshotHash: string;
  fieldSources: Record<string, ArticleTypeFieldSource>;
  aiSupplementRunId?: string;
  status: ArticleTypeVersionStatus;
  createdBy: string;
  createdAt: string;
}

export interface ArticleTypeProfile {
  profileId: string;
  revision: number;
  origin: "system_template" | "workspace_custom" | "template_copy";
  status: ArticleTypeProfileStatus;
  currentVersionId: string;
  activeVersionId?: string;
  monthlyUsageCount: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ArticleTypeProfileSummary extends ArticleTypeProfile {
  currentVersion: ArticleTypeProfileVersion;
  activeVersion?: ArticleTypeProfileVersion;
}

export interface ArticleTypeProfileDraftInput {
  name: string;
  semanticDescription: string;
  suitableQuestionDescription: string;
  unsuitableQuestionDescription?: string;
  targetAudience?: string[];
  contentGoal?: string;
  structureModules?: string[];
  requiredSections?: string[];
  cta?: string;
  lengthRange?: Partial<ArticleTypeLengthRange>;
  styleTraits?: string[];
  caseUsage?: string;
  evidencePreferences?: string[];
  channelHints?: string[];
  exampleQuestions?: string[];
  fieldSources?: Record<string, ArticleTypeFieldSource>;
  aiSupplementRunId?: string;
}

export interface ArticleTypeSupplementSuggestion {
  field: keyof ArticleTypeProfileDraftInput;
  value: string | string[] | ArticleTypeLengthRange;
  reason: string;
  source: "ai_suggested";
}

export interface ArticleTypeSupplementResult {
  runId: string;
  status: "success" | "partial" | "pending_config" | "failed";
  provider?: string;
  promptVersion: string;
  suggestions: ArticleTypeSupplementSuggestion[];
  overlaps: Array<{ profileVersionId: string; name: string; reason: string }>;
  missingInformation: string[];
  message: string;
}

export interface QuestionTypeSuggestion {
  suggestionId: string;
  questionVersionId: string;
  question: string;
  articleTypeProfileVersionId: string;
  articleTypeName: string;
  fitLevel: ArticleTypeFitLevel;
  semanticScore: number;
  reason: string;
  matchedFacets: string[];
  missingInformation: string[];
  conflictProfileVersionIds: string[];
  selectionStatus: TypeSelectionStatus;
  selectionSource: TypeSelectionSource;
}

export interface QuestionTypeMatchRun {
  matchRunId: string;
  month: string;
  revision: number;
  status: "draft" | "confirmed" | "pending_config" | "failed";
  questionVersionIds: string[];
  provider?: string;
  providerModel?: string;
  promptVersion: string;
  suggestions: QuestionTypeSuggestion[];
  confirmedAt?: string;
  confirmedBy?: string;
  createdAt: string;
  createdBy: string;
  auditReason: string;
}

export interface ArticleTypeWriteRequest {
  expectedVersion: number;
  auditReason: string;
  input: ArticleTypeProfileDraftInput;
  copyFromProfileId?: string;
}

export interface ArticleTypePatchRequest extends ArticleTypeWriteRequest {
  action?: "new_version" | "disable";
}

export interface ArticleTypeActivateRequest {
  expectedVersion: number;
  profileVersionId: string;
  auditReason: string;
}

export interface ArticleTypeSupplementRequest {
  expectedVersion: number;
  profileVersionId: string;
  auditReason: string;
}

export interface QuestionTypeMatchRequest {
  expectedVersion: number;
  questionVersionIds: string[];
  auditReason: string;
}

export interface QuestionTypeMatchConfirmRequest {
  expectedVersion: number;
  matchRunId: string;
  selections: Array<{
    questionVersionId: string;
    articleTypeProfileVersionId: string;
    selectionStatus: "accepted" | "rejected" | "manual_added";
  }>;
  auditReason: string;
}
