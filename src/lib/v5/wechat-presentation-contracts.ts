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
export type WechatTemplateSelectionStatus = "selected" | "superseded" | "stale";
export type WechatPlatformKey = "weixin";

export function resolveWechatPlatformKey(channel: string | undefined): WechatPlatformKey | undefined {
  const normalized = String(channel || "").trim().toLowerCase();
  return normalized === "wechat" ? "weixin" : undefined;
}

export interface WechatLayoutTemplateDefinition {
  templateId: WechatLayoutTemplateId;
  version: string;
  family: WechatLayoutFamily;
  name: string;
  description: string;
  bestFor: string;
  active: boolean;
}

export interface WechatLayoutTemplateOption extends WechatLayoutTemplateDefinition {
  previewHtml: string;
}

export interface WechatPresentationInput {
  draftVersionId: string;
  title: string;
  markdown: string;
  platformKey: WechatPlatformKey;
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

export interface WechatTemplateRecommendation {
  status: "recommended" | "recommendation_unavailable";
  recommenderVersion: string;
  recommendedTemplateId?: WechatLayoutTemplateId;
  family?: WechatLayoutFamily;
  businessReason: string;
  candidates: WechatLayoutCandidateScore[];
}

export interface WechatTemplateSelection {
  selectionId: string;
  draftVersionId: string;
  sourceContentHash: string;
  platformKey: WechatPlatformKey;
  recommendedTemplateId?: WechatLayoutTemplateId;
  selectedTemplateId: WechatLayoutTemplateId;
  templateVersion: string;
  selectionSource: "human";
  selectionReason?: string;
  status: WechatTemplateSelectionStatus;
  selectedBy: string;
  selectedAt: string;
}

export interface WechatHtmlValidationResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  checkedAt: string;
}

export interface WechatPresentationArtifact {
  artifactId: string;
  selectionId: string;
  draftVersionId: string;
  sourceContentHash: string;
  templateId: WechatLayoutTemplateId;
  templateVersion: string;
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

export interface WechatTemplateWorkspace {
  applicable: true;
  platformKey: WechatPlatformKey;
  sourceContentHash: string;
  recommendation: Omit<WechatTemplateRecommendation, "candidates">;
  templates: WechatLayoutTemplateOption[];
  selection?: WechatTemplateSelection;
}

export interface WechatPresentationState {
  applicable: true;
  platformKey: WechatPlatformKey;
  selection?: WechatTemplateSelection;
  artifact?: WechatPresentationArtifact;
}
