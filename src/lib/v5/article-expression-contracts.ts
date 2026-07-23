export type V5ArticleExpressionProfileStatus = "draft" | "active" | "archived";

export interface V5ArticleExpressionStructureModule {
  moduleId: string;
  label: string;
  guidance: string;
  required: boolean;
}

export interface V5ArticleExpressionProfileVersion {
  profileVersionId: string;
  profileId: string;
  versionNumber: number;
  status: V5ArticleExpressionProfileStatus;
  targetAudience: string;
  writingGoal: "selection" | "explain" | "implementation";
  readerAwareness: "initial" | "comparing" | "implementing";
  tones: string[];
  structureModules: V5ArticleExpressionStructureModule[];
  requiredTopics: string[];
  forbiddenStyles: string[];
  minLength: number;
  maxLength: number;
  cta: string;
  notes: string;
  evidenceWarning: boolean;
  createdAt: string;
  createdBy: string;
}

export interface V5ArticleExpressionProfile {
  profileId: string;
  name: string;
  applicableArticleTypes: string[];
  applicableChannels: string[];
  currentVersionId: string;
  defaultProfile: boolean;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface V5ArticleExpressionProfileView extends V5ArticleExpressionProfile {
  currentVersion: V5ArticleExpressionProfileVersion;
}

export interface V5ConfigurationStatusItem {
  key: string;
  label: string;
  purpose: string;
  category: "model" | "publish_connection" | "observation_connection";
  status: "ready" | "pending_config" | "failed";
  accountAlias?: string;
  lastCheckedAt?: string;
  nextAction: string;
}
