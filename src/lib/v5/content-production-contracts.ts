import { createHash } from "node:crypto";

export type CTAIntent =
  | "none"
  | "learn_more"
  | "product_evaluation"
  | "implementation_assessment"
  | "solution_comparison"
  | "contact_service";

export type PromotionArticleScope = "single_product" | "multi_product" | "comparison" | "brand";
export type PromotionProfileStatus = "draft" | "active" | "superseded";

export interface PromotionCtaVariant {
  ctaVariantId: string;
  channel: string | "*";
  label: string;
  publicUrl: string;
  identityClaimIds: string[];
  serviceClaimIds: string[];
  allowedRenderModes: string[];
  status: "active" | "disabled";
}

export interface PromotionProfileVersion {
  promotionProfileVersionId: string;
  version: number;
  status: PromotionProfileStatus;
  targetEntityIds: string[];
  excludedEntityIds: string[];
  applicableProductGroups: string[];
  articleScope: PromotionArticleScope;
  promotionGoal: string;
  ctaIntent: CTAIntent | "any";
  applicableContentTypes: string[];
  applicableTitleCategories: string[];
  allowMultiProduct: boolean;
  requiresPrimaryEntity: boolean;
  priority: number;
  validFrom?: string;
  validUntil?: string;
  variants: PromotionCtaVariant[];
  approvedBy?: string;
  approvedAt?: string;
}

export interface ContentTaskSnapshot {
  taskId: string;
  taskVersion: number;
  title: string;
  channel: string;
  contentType: string;
  titleCategory?: string;
  targetAudience: string;
  coreProblem: string;
  coreJudgment: string;
  targetEntityIds: string[];
  primaryEntityId?: string;
  productGroupIds?: string[];
  promotionGoal: string;
  ctaIntent: CTAIntent;
  promotionRequired: boolean;
}

export interface ResolvedCtaVariant {
  promotionProfileVersionId: string;
  ctaVariantId: string;
  targetEntityId: string;
  label: string;
  publicUrl: string;
  identityClaimIds: string[];
  serviceClaimIds: string[];
  renderMode: string;
}

export interface CTAPlan {
  promotionProfileVersionIds: string[];
  targetEntityIds: string[];
  selectedVariants: ResolvedCtaVariant[];
  renderMode: string;
  maxCtaCount: number;
  selectionReasons: string[];
  planHash: string;
}

export type EvidenceDecision =
  | "generatable"
  | "generatable_with_downgrade"
  | "needs_material"
  | "needs_review"
  | "blocked"
  | "pending_config";

export interface ProductionEvidenceItem {
  evidenceItemId: string;
  claimIds: string[];
  primaryClaimId?: string;
  sourceRevisionId: string;
  originalQuote: string;
  summary: string;
  canonicalUrl?: string;
  allowedUsage: string[];
  forbiddenUsage: string[];
  conditions: string[];
  limitations: string[];
  lifecycleStatus: "current" | "planned" | "deprecated" | "unknown";
  visibility: "public" | "internal" | "restricted" | "confidential";
  status: "active" | "review_required" | "blocked" | "superseded" | "expired" | "isolated";
}

export interface FinalEvidencePackSnapshot {
  evidencePackId: string;
  snapshotHash: string;
  sourceSnapshotHash: string;
  decision: EvidenceDecision;
  evidenceItems: ProductionEvidenceItem[];
  gaps: string[];
  conflicts: string[];
  outdatedEvidence: string[];
  unverifiedClaims: string[];
}

export interface ProductRuleSnapshot {
  rulePackageVersionId: string;
  sourceSnapshotHash: string;
  allowedExpressions: string[];
  conditionalExpressions: string[];
  blockedExpressions: string[];
  requiredEvidenceRoles: string[];
}

export interface ContentTypeRuleSnapshot {
  articleTypeProfileVersionId: string;
  promptConstraintSnapshotHash: string;
  ctaIntent: CTAIntent;
  minLength: number;
  maxLength: number;
  requiredSections: string[];
  requiredArtifacts: ProductionArtifact[];
  requiredEvidenceRoles: string[];
  promptDirectives: string[];
}

export type ProductionArtifact = "table" | "list" | "state_flow" | "code_block";

export interface ChannelRuleSnapshot {
  channelRuleVersionId: string;
  channel: string;
  minLength?: number;
  maxLength?: number;
  requiredSections: string[];
  requiredArtifacts: ProductionArtifact[];
  prohibitedTerms: string[];
  maxCtaCount: number;
  ctaRenderMode: string;
  allowedCtaRenderModes: string[];
  requireCtaAtEnd: boolean;
  crossChannelSimilarityThreshold: number;
  promptDirectives: string[];
}

export interface ExpressionRuleSnapshot {
  expressionProfileVersionId: string;
  prohibitedTerms: string[];
  humanizerDirectives: string[];
}

export interface ProductionValidatorPolicy {
  minTraceableFactCount: number;
  requireHumanBoundary: boolean;
  allowedUrls: string[];
  prohibitedTerms: string[];
  requiredSections: string[];
  requiredArtifacts: ProductionArtifact[];
  minLength: number;
  maxLength: number;
  maxCtaCount: number;
  requireCtaAtEnd: boolean;
  crossChannelSimilarityThreshold: number;
}

export interface ProductionContractSnapshot {
  contractVersion: "content-production.v1";
  contractHash: string;
  task: ContentTaskSnapshot;
  evidencePack: FinalEvidencePackSnapshot;
  productRule: ProductRuleSnapshot;
  contentTypeRule: ContentTypeRuleSnapshot;
  channelRule: ChannelRuleSnapshot;
  expressionRule: ExpressionRuleSnapshot;
  ctaPlan: CTAPlan;
  validatorPolicy: ProductionValidatorPolicy;
  allowedExpressions: string[];
  conditionalExpressions: string[];
  promptDirectives: string[];
  compiledAt: string;
}

export interface ProductionFactTrace {
  sentence: string;
  evidenceItemId: string;
  claimId: string;
  sourceRevisionId: string;
}

export interface ProductionProviderOutput {
  markdown: string;
  factTraces: ProductionFactTrace[];
}

export type ProductionValidationCode =
  | "title_mismatch"
  | "length_out_of_range"
  | "required_section_missing"
  | "required_artifact_missing"
  | "prohibited_term"
  | "fact_trace_invalid"
  | "traceable_fact_count_low"
  | "human_boundary_missing"
  | "cta_missing"
  | "cta_modified"
  | "cta_limit_exceeded"
  | "cta_position_invalid"
  | "url_not_allowed"
  | "sensitive_output"
  | "duplicate_paragraph"
  | "chat_residue"
  | "cross_channel_similarity";

export interface ProductionValidationIssue {
  code: ProductionValidationCode;
  message: string;
  repairable: boolean;
  details?: string[];
}

export interface ProductionValidationResult {
  passed: boolean;
  issues: ProductionValidationIssue[];
  measuredLength: number;
  traceableFactCount: number;
  maxCrossChannelSimilarity: number;
}

export interface ProductionSiblingDraft {
  draftId: string;
  channel: string;
  markdown: string;
}

export type ProductionDomainErrorCode =
  | "invalid_task"
  | "evidence_missing"
  | "evidence_not_generatable"
  | "rule_conflict"
  | "promotion_required_missing"
  | "promotion_conflict"
  | "promotion_claim_missing"
  | "promotion_url_invalid";

export class ProductionDomainError extends Error {
  constructor(
    public readonly code: ProductionDomainErrorCode,
    message: string,
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "ProductionDomainError";
  }
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForStableJson(item)])
    );
  }
  return value;
}

export function stableJson(value: unknown) {
  return JSON.stringify(normalizeForStableJson(value));
}

export function hashProductionValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
