export const WECHAT_VISUAL_PLAN_VERSION = "wechat-visual-plan.v1" as const;
export const WECHAT_VISUAL_PROMPT_VERSION = "joto-cc2image-cover.v1" as const;
export const CC2IMAGE_BASELINE_COMMIT = "33b18b399fcfc6a54a7c4cc2d137fa3dfd3afad8" as const;

export type WechatVisualPlanStatus = "generating" | "cover_selection" | "partial" | "pending_config" | "failed" | "applied" | "stale";
export type WechatVisualCandidateStatus = "generating" | "ready" | "pending_config" | "failed" | "selected";
export type WechatVisualRouteKey = "brand" | "system" | "hook";

export interface WechatVisualStyleRoute {
  routeKey: WechatVisualRouteKey;
  routeName: string;
  styleId: string;
  styleName: string;
  recommendation: string;
  visualIntent: string;
}

export interface WechatVisualAnchor {
  anchorId: string;
  sectionKey: string;
  sectionHeading: string;
  coreIdea: string;
  visualType: "comparison" | "workflow" | "system" | "path" | "metaphor";
  placementReason: string;
}

export interface WechatVisualCandidateRecord {
  candidateId: string;
  planId: string;
  role: "cover";
  variantIndex: 1 | 2 | 3;
  route: WechatVisualStyleRoute;
  status: WechatVisualCandidateStatus;
  prompt: string;
  promptHash: string;
  storageKey?: string;
  contentHash?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  byteSize?: number;
  provider?: string;
  model?: string;
  providerRequestId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WechatVisualPlanRecord {
  schemaVersion: typeof WECHAT_VISUAL_PLAN_VERSION;
  planId: string;
  batchId: string;
  productId: string;
  artifactId: string;
  sourceContentHash: string;
  articleTitle: string;
  articleSummary: string;
  targetAudience: string;
  coreJudgment: string;
  routes: WechatVisualStyleRoute[];
  anchors: WechatVisualAnchor[];
  candidates: WechatVisualCandidateRecord[];
  selectedCoverCandidateId?: string;
  status: WechatVisualPlanStatus;
  promptVersion: typeof WECHAT_VISUAL_PROMPT_VERSION;
  cc2imageCommit: typeof CC2IMAGE_BASELINE_COMMIT;
  providerStatus: "ready" | "pending_config";
  providerMissingConfig: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface WechatVisualCandidateView extends Omit<WechatVisualCandidateRecord, "prompt" | "storageKey" | "contentHash"> {
  contentUrl?: string;
}

export interface WechatVisualPlanView extends Omit<WechatVisualPlanRecord, "candidates"> {
  candidates: WechatVisualCandidateView[];
}

export interface WechatVisualWorkspace {
  applicable: boolean;
  plan?: WechatVisualPlanView;
  provider: {
    status: "ready" | "pending_config";
    label: string;
    missingConfig: string[];
  };
}
