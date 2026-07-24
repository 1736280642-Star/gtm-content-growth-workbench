export const WECHAT_LAYOUT_TEMPLATE_IDS = [
  "official-command",
  "official-blueprint",
  "official-cobalt",
  "official-graphite",
  "natural-fieldnotes",
  "natural-notebook",
  "natural-column",
  "natural-calm"
] as const;

export type WechatLayoutTemplateId = typeof WECHAT_LAYOUT_TEMPLATE_IDS[number];
export type WechatLayoutFamily = "official" | "natural";
export type WechatPresentationReviewStatus = "pending_review" | "approved" | "rejected" | "stale";
export type WechatPresentationSelectionStatus = "selected" | "selection_blocked";

export interface WechatPresentationInput {
  draftVersionId: string;
  title: string;
  markdown: string;
  platformContentType: string;
  titleCategory: string;
  targetAudience: string;
  articleStructureTags: string[];
  ctaType: string;
  approvedImageRoles: string[];
  coverImageRef?: string;
}

export interface WechatLayoutCandidateScore {
  templateId: WechatLayoutTemplateId;
  family: WechatLayoutFamily;
  score: number;
  matchedRules: string[];
}

export interface WechatLayoutSelection {
  status: WechatPresentationSelectionStatus;
  selectorVersion: string;
  selectedTemplateId?: WechatLayoutTemplateId;
  family?: WechatLayoutFamily;
  selectedScore?: number;
  runnerUpScore?: number;
  businessReason: string;
  candidates: WechatLayoutCandidateScore[];
}

export interface WechatHtmlValidationResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  checkedAt: string;
}

export interface WechatPresentationArtifact {
  artifactId: string;
  draftVersionId: string;
  sourceContentHash: string;
  selectorVersion: string;
  selectionStatus: WechatPresentationSelectionStatus;
  templateId?: WechatLayoutTemplateId;
  templateFamily?: WechatLayoutFamily;
  selectedScore?: number;
  runnerUpScore?: number;
  businessReason: string;
  html?: string;
  htmlHash?: string;
  validation: WechatHtmlValidationResult;
  reviewStatus: WechatPresentationReviewStatus;
  coverImageRef?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
  publishStatus?: "not_sent" | "sending" | "draft_created" | "failed";
  externalDraftId?: string;
  draftUrl?: string;
  publishError?: string;
  publishedAt?: string;
}
