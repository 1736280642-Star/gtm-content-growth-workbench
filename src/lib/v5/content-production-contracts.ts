import { createHash } from "node:crypto";
import type { GeoArticleMissionContract, GeoEvidenceUsage } from "./geo-article-mission-contracts";

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
  evidenceUsage?: GeoEvidenceUsage;
  subjectEntityIds?: string[];
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
  argumentOrder?: string[];
  promptDirectives: string[];
}

export type ArticleArgumentRole = "answer" | "criterion" | "mechanism" | "evidence" | "decision";

export interface ArticleArgumentSection {
  sectionId: string;
  role: ArticleArgumentRole;
  sectionQuestion: string;
  sectionClaim: string;
  because: string;
  evidenceClaimIds: string[];
  decisionImplication: string;
  transitionToNext?: string;
}

export interface ArticleArgumentPlan {
  planVersion: "article-argument-plan.v1";
  centralJudgment: string;
  causalChain: string[];
  sections: ArticleArgumentSection[];
  promotionSubjectSectionRequirement?: {
    requiredInEveryCoreSection: true;
    literalSubjectNameRequired: true;
    narrativeSubjectName: string;
    eligibleActionClaimIds: string[];
    eligibleActionCategories: PromotionCapabilityCategory[];
    decisionImplicationRequired: true;
  };
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
  calibrationVersionId?: string;
  calibrationDirectives?: string[];
}

export interface RequiredFixedExpression {
  text: string;
  positions: Array<"opening" | "body" | "ending">;
  channel: string;
}

export interface ProductionEntityIdentitySnapshot {
  productId: string;
  canonicalName: string;
  displayName: string;
  aliases: string[];
  brandName?: string;
  officialEntity?: string;
  entityRelationship?: string;
}

export interface ProductionGovernanceSnapshot {
  productId: string;
  productStrategyPackId: string;
  productStrategyVersion: number;
  productStrategyHash: string;
  articleTypeVersionId: string;
  articleTypeDefinitionHash: string;
  expressionCalibrationVersionId?: string;
  promptCompilerVersion: "production-contract-compiler.v2" | "production-contract-compiler.v3";
  geoIntentHash: string;
  entityGraphHash: string;
  productionMode: "sample" | "batch" | "single";
}

export type PromotionCapabilityCategory =
  | "diagnosis_consulting"
  | "solution_design"
  | "integration_delivery"
  | "training_operations";

export interface PromotionCapabilityClaimPlan {
  claimId: string;
  evidenceItemId: string;
  category: PromotionCapabilityCategory;
}

export interface PromotionSubjectPlan {
  enabled: boolean;
  platformEntityId: string;
  promotionSubjectEntityId: string;
  narrativeSubjectName: string;
  narrativeSubjectRole: "target_product" | "service_provider";
  identityStatement?: string;
  identityClaimIds: string[];
  serviceCapabilityClaims: PromotionCapabilityClaimPlan[];
  minimumServiceCapabilityClaims: number;
  minimumServiceCapabilityCategories: number;
  minimumBodySubjectMentions: number;
  requiredSectionCoverageRatio: number;
}

export type GovernedFaqTopic =
  | "entity_relationship"
  | "service_capability"
  | "scenario_applicability"
  | "implementation_deployment"
  | "responsibility_boundary"
  | "security_governance"
  | "product_mechanism";

export interface GovernedFaqEvidenceCandidate {
  topic: GovernedFaqTopic;
  suggestedQuestion: string;
  evidenceItemId: string;
  claimId: string;
  sourceRevisionId: string;
}

export interface GovernedFaqPlan {
  enabled: boolean;
  required: boolean;
  heading: "常见问题";
  placement: "before_cta";
  minimumItems: number;
  maximumItems: number;
  allowedQuestionOrigins: Array<"search_intent" | "knowledge_simulation" | "human_confirmed">;
  evidenceCandidates: GovernedFaqEvidenceCandidate[];
  planHash: string;
}

export interface ProductionValidatorPolicy {
  requiredCoreClaimIds: string[];
  entityIdentity: ProductionEntityIdentitySnapshot;
  allowedUrls: string[];
  prohibitedTerms: string[];
  requiredSections: string[];
  requiredArtifacts: ProductionArtifact[];
  minLength: number;
  maxLength: number;
  maxCtaCount: number;
  requireCtaAtEnd: boolean;
  crossChannelSimilarityThreshold: number;
  promotionSubjectPlan: PromotionSubjectPlan;
  faqPlan: GovernedFaqPlan;
}

export interface ProductionContractSnapshot {
  contractVersion: "content-production.v2";
  contractHash: string;
  governance: ProductionGovernanceSnapshot;
  geoMission: GeoArticleMissionContract;
  promotionSubjectPlan: PromotionSubjectPlan;
  faqPlan: GovernedFaqPlan;
  argumentPlan: ArticleArgumentPlan;
  task: ContentTaskSnapshot;
  evidencePack: FinalEvidencePackSnapshot;
  productRule: ProductRuleSnapshot;
  contentTypeRule: ContentTypeRuleSnapshot;
  channelRule: ChannelRuleSnapshot;
  expressionRule: ExpressionRuleSnapshot;
  ctaPlan: CTAPlan;
  fixedExpressions?: RequiredFixedExpression[];
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
  | "core_claim_missing"
  | "entity_relationship_invalid"
  | "cta_missing"
  | "cta_modified"
  | "cta_limit_exceeded"
  | "cta_position_invalid"
  | "fixed_expression_missing"
  | "fixed_expression_position_invalid"
  | "fixed_expression_count_invalid"
  | "url_not_allowed"
  | "sensitive_output"
  | "duplicate_paragraph"
  | "chat_residue"
  | "human_writing_style"
  | "title_heading_punctuation"
  | "meta_opening"
  | "pronoun_before_entity"
  | "sentence_fragment"
  | "argument_discontinuity"
  | "promotion_subject_missing"
  | "promotion_subject_section_coverage"
  | "service_capability_coverage"
  | "role_responsibility_unclear"
  | "faq_required_missing"
  | "faq_item_count_invalid"
  | "faq_question_format_invalid"
  | "faq_answer_untraced"
  | "faq_topic_misaligned"
  | "faq_duplicate"
  | "faq_position_invalid"
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
