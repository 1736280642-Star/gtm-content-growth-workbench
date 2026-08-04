export const FREE_PRODUCTION_CHANNELS = ["official_website", "zhihu", "wechat_official_account"] as const;
export type FreeProductionChannel = (typeof FREE_PRODUCTION_CHANNELS)[number];

export const freeProductionChannelLabels: Record<FreeProductionChannel, string> = {
  official_website: "官网",
  zhihu: "知乎",
  wechat_official_account: "公众号"
};

export const FREE_EXPRESSION_PRESET_KEYS = [
  "product_release",
  "scenario_solution",
  "strategic_partnership",
  "event_recap",
  "industry_insight"
] as const;
export type FreeExpressionPresetKey = (typeof FREE_EXPRESSION_PRESET_KEYS)[number];
export type TitleStrategyKey = "pain_suspense" | "role_resonance" | "value_release" | "industry_question";
export type AudienceLensKey = "executive" | "business_owner" | "frontline_user" | "it_digital" | "security_compliance" | "procurement" | "ecosystem_partner";
export type VisualSuggestionMode = "off" | "placeholders";
export type FreeProductionSourceMode = "knowledge" | "facts" | "facts_with_meeting_text";
export type FreeContentExpressionTypeStatus = "draft" | "active" | "archived";
export type PromotionStrength = "restrained" | "moderate" | "explicit";
export type FreeProductionStatus = "draft" | "compiling" | "generating" | "checking" | "repairing" | "needs_input" | "ready_for_confirmation" | "blocked" | "publishing" | "published" | "generation_failed" | "publish_failed" | "cancelled";
export type RiskAndGapStatus = "ready" | "needs_input" | "needs_approval" | "warning" | "blocked";
export type SupplementInputType = "text" | "textarea" | "date" | "url" | "select" | "file";

export interface SupplementInputSchema {
  type: SupplementInputType;
  label: string;
  placeholder?: string;
  required: boolean;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  acceptedMimeTypes?: string[];
}

export interface RequiredExpressionInput {
  key: string;
  label: string;
  reason: string;
  defaultStatus: Exclude<RiskAndGapStatus, "ready" | "warning">;
  inputSchema: SupplementInputSchema;
  affectedSectionKeys: string[];
}

export interface FreeContentExpressionConfig {
  tone: string;
  narrativePerspective: string;
  professionalDepth: string;
  terminologyDensity: string;
  allowFirstPerson: boolean;
  allowIndustryJudgement: boolean;
  casePreference: string;
  sentenceLengthRange: [number, number];
  paragraphSentenceRange: [number, number];
}

export interface FreeContentPromotionConfig {
  strength: PromotionStrength;
  firstProductMentionRule: string;
  suggestedProductMentionCount: number;
  requireCoreCapability: boolean;
  allowCompetitorComparison: boolean;
  defaultCtaType: string;
}

export interface FreeContentEvidenceRequirements {
  requireKnowledgeBase: boolean;
  minimumEvidenceCount: number;
  preferredEvidenceTypes: string[];
  requireSourceForData: boolean;
  insufficientEvidenceAction: "block" | "safe_draft";
  allowGeneralKnowledge: boolean;
}

export interface FreeContentChannelBinding {
  channel: FreeProductionChannel;
  publishingConnectionId?: string;
  publishingDestination?: string;
  channelRuleVersionId: string;
  ctaType: string;
  requiredPublishAssetKeys: string[];
}

export interface FreeContentExpressionTypeVersion {
  freeContentExpressionTypeVersionId: string;
  typeId: string;
  version: number;
  presetKey: FreeExpressionPresetKey;
  name: string;
  description: string;
  scenario: string;
  contentGoal: string;
  defaultAudience: string;
  sourceMode: FreeProductionSourceMode;
  productId: string;
  productRuleResolutionPolicy: "active_product_rule";
  knowledgeSelectionPolicy: "all_product_ready_snapshots" | "selected_product_snapshots";
  knowledgeSnapshotIds: string[];
  applicableChannels: FreeProductionChannel[];
  channelBinding: FreeContentChannelBinding;
  publishPolicy: "automatic_after_confirmation";
  visualSuggestionMode: VisualSuggestionMode;
  structureModules: string[];
  optionalStructureModules: string[];
  requiredInputSchema: RequiredExpressionInput[];
  recommendedLength: { min: number; max: number };
  allowedTitleStrategyKeys: TitleStrategyKey[];
  defaultTitleStrategyKey: TitleStrategyKey;
  audienceLensPolicy: AudienceLensKey;
  expressionConfig: FreeContentExpressionConfig;
  promotionConfig: FreeContentPromotionConfig;
  evidenceRequirements: FreeContentEvidenceRequirements;
  qualityGateConfig: { requireHumanAiBoundary: boolean; maximumRepairCount: 1; productMentionMinimumRatio?: number };
  outputContractVersion: "content-draft-artifact.v1";
  sourceRuleDocumentId: string;
  sourceRuleVersion: string;
  sourceRuleDigest: string;
  systemManaged: boolean;
  defaultExpressionFocus: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  additionalWritingRequirements: string;
  status: FreeContentExpressionTypeStatus;
  snapshotHash: string;
  createdBy: string;
  createdAt: string;
  activatedAt?: string;
}

export interface FreeContentExpressionType {
  typeId: string;
  presetKey: FreeExpressionPresetKey;
  status: FreeContentExpressionTypeStatus;
  currentVersionId: string;
  activeVersionId?: string;
  version: number;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface FreeContentExpressionTypeSummary extends FreeContentExpressionType {
  currentVersion: FreeContentExpressionTypeVersion;
  activeVersion?: FreeContentExpressionTypeVersion;
}

export interface CreateFreeExpressionInput {
  name: string;
  baseTypeId: string;
  sourceMode: FreeProductionSourceMode;
  description: string;
  visualSuggestionMode: VisualSuggestionMode;
}

export interface FreeProductionFactInput {
  time: string;
  location: string;
  people: string;
  event: string;
  publicConfirmed: boolean;
}

export interface CreateFreeProductionInput {
  expectedVersion: number;
  auditReason: string;
  expressionTypeVersionId: string;
  productId?: string;
  knowledgeSnapshotIds: string[];
  expressionFocus: string;
  factItems: FreeProductionFactInput[];
  meetingText?: string;
}

export interface FreeProductionSourceExcerpt {
  id: string;
  sourceType: "knowledge" | "human_fact" | "meeting_text";
  excerpt: string;
  sourceSnapshotId?: string;
  sourceSnapshotHash?: string;
}

export type FreeContentExpressionTypeDraftInput = Omit<
  FreeContentExpressionTypeVersion,
  "freeContentExpressionTypeVersionId" | "typeId" | "version" | "status" | "snapshotHash" | "createdBy" | "createdAt" | "activatedAt"
>;

export interface ExpressionPlanEvidenceMapItem {
  sectionKey: string;
  knowledgeSnapshotId: string;
  evidenceSummary: string;
}

export interface VisualMaterialSuggestion {
  id: string;
  placementAnchor: string;
  assetType: "product_screenshot" | "workflow_comparison" | "event_photo" | "data_chart" | "scene_photo";
  recommendation: string;
  captionSuggestion: string;
  purpose: string;
  optional: true;
  boundAssetRef?: string;
}

export interface ExpressionPlan {
  id: string;
  batchId: string;
  channel: FreeProductionChannel;
  contentAngle: string;
  contentPositioning: string;
  audienceLensKey: AudienceLensKey;
  corePain: string;
  articleClaim: string;
  titleStrategyKey: TitleStrategyKey;
  titleCandidates: string[];
  selectedTitle?: string;
  outline: Array<{ sectionKey: string; purpose: string }>;
  evidenceMap: ExpressionPlanEvidenceMapItem[];
  missingClaims: string[];
  visualMaterialPlan: VisualMaterialSuggestion[];
  expectedCta: string;
  status: "compiled" | "needs_input" | "superseded";
  createdAt: string;
  version: number;
}

export interface ContentLayoutNode {
  id: string;
  type: "brand_bar" | "title" | "summary" | "section_heading" | "paragraph" | "emphasis" | "brand_footer";
  text: string;
  sectionKey?: string;
}

export interface DraftSection {
  sectionKey: string;
  heading: string;
  markdown: string;
  citations?: Array<{ claimText: string; sourceIds: string[] }>;
}

export interface ContentDraftArtifact {
  id: string;
  expressionPlanId: string;
  generationInputSnapshotId: string;
  titleCandidates: string[];
  selectedTitle: string;
  summary: string;
  sections: DraftSection[];
  articleBody: string;
  channelLayoutTree: ContentLayoutNode[];
  visualSuggestions: VisualMaterialSuggestion[];
  sourceExcerpts: FreeProductionSourceExcerpt[];
  sourceReview?: { artifactId: string; reviewedBy: string; reviewedAt: string };
  wechatPresentation?: {
    templateId: "joto-official-v1";
    previewHtml: string;
    publishHtml: string;
    htmlHash: string;
    validation: { passed: boolean; blockers: string[]; warnings: string[]; checkedAt: string };
  };
  factCheck: { supportedClaims: string[]; needsConfirmation: string[]; rejectedClaims: string[] };
  editorCheck: { deterministicResults: string[]; advisoryResults: string[] };
  riskAndGapSnapshot: RiskAndGapItem[];
  contentDigest: string;
  createdAt: string;
  version: number;
}

export interface RiskAndGapItem {
  id: string;
  key: string;
  title: string;
  reason: string;
  status: RiskAndGapStatus;
  inputSchema?: SupplementInputSchema;
  affectedSectionKeys: string[];
  value?: string;
  assetRef?: string;
  resolvedAt?: string;
}

export interface FreeProductionInputSnapshot {
  id: string;
  productExpressionRuleSnapshot: Record<string, unknown>;
  knowledgeSnapshots: Array<Record<string, unknown>>;
  brandExpressionBaselineSnapshot: Record<string, unknown>;
  freeContentExpressionPresetSnapshot: FreeContentExpressionTypeVersion;
  sourceRuleVersion: string;
  sourceRuleDigest: string;
  audienceLens: AudienceLensKey;
  titleStrategy: TitleStrategyKey;
  channelRuleSnapshot: FreeContentChannelBinding;
  supplementalFacts: Record<string, string>;
  expressionPlanId: string;
  createdAt: string;
  snapshotHash: string;
}

export interface FreeProductionBatch {
  id: string;
  monthlyPlanId: string;
  monthStart: string;
  monthEnd: string;
  productId: string;
  productName: string;
  productExpressionRulePackageVersionId: string;
  knowledgeSnapshotIds: string[];
  freeContentExpressionTypeVersionId: string;
  sourceMode: FreeProductionSourceMode;
  expressionFocus: string;
  factItems: FreeProductionFactInput[];
  meetingText?: string;
  sourceExcerpts: FreeProductionSourceExcerpt[];
  sourceReview?: { artifactId: string; reviewedBy: string; reviewedAt: string };
  supplementalMaterialRefs: string[];
  riskAndGapSummary: { ready: number; needsInput: number; needsApproval: number; warning: number; blocked: number };
  generationInputSnapshotId?: string;
  currentExpressionPlanId?: string;
  currentDraftArtifactId?: string;
  channelConfig: FreeContentChannelBinding;
  publishPolicy: "automatic_after_confirmation";
  status: FreeProductionStatus;
  repairCount: 0 | 1;
  risks: RiskAndGapItem[];
  expressionPlans: ExpressionPlan[];
  inputSnapshots: FreeProductionInputSnapshot[];
  draftArtifacts: ContentDraftArtifact[];
  confirmedContentDigest?: string;
  publishedAt?: string;
  publishedUrl?: string;
  externalRecordId?: string;
  failureCode?: string;
  failureMessage?: string;
  nextAction?: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface FreeProductionTask {
  id: string;
  batchId: string;
  monthlyPlanId: string;
  planningSource: "free_production";
  freeContentExpressionTypeVersionId: string;
  channel: FreeProductionChannel;
  status: FreeProductionStatus;
  title?: string;
  contentDigest?: string;
  publishedAt?: string;
  publishedUrl?: string;
  failureCode?: string;
  failureMessage?: string;
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FreeProductionCatalogProduct {
  productId: string;
  name: string;
  rulePackages: Array<{ id: string; name: string; version: number; status: "active" }>;
  knowledgeBases: Array<{ knowledgeBaseId: string; name: string; sourceSnapshotId: string; sourceSnapshotHash: string; status: "ready" }>;
}

export interface ChannelReadinessItem {
  channel: FreeProductionChannel;
  label: string;
  connected: boolean;
  accounts: Array<{ id: string; name: string }>;
  blockingReason?: string;
}

export interface FreeProductionCatalog {
  products: FreeProductionCatalogProduct[];
  expressionTypes: FreeContentExpressionTypeSummary[];
  channelReadiness: ChannelReadinessItem[];
  currentMonth: string;
}

export interface FreeProductionAuditEvent {
  auditId: string;
  action: string;
  objectId: string;
  actor: string;
  auditReason: string;
  createdAt: string;
  summary?: Record<string, unknown>;
}
