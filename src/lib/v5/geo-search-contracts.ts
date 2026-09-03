export type GeoSearchProviderKey = "zhipu" | "doubao" | "qwen";

export interface GeoSearchQuery {
  queryId: string;
  query: string;
  intent: string;
  expectedEvidenceRole: string;
  freshnessRequirement: "day" | "week" | "month" | "year" | "no_limit";
  stopCondition: string;
  round: number;
  identityAnchors: string[];
  candidateAcceptanceRule: string;
  candidateRejectionRule: string;
  /** 平台感知查询绑定的渠道（来自渠道规则包，无规则包时为空） */
  channelKey?: string;
}

export interface GeoSearchQueryPlan {
  contractVersion: "geo-search-query-plan.v2";
  productId: string;
  researchTask: string;
  queries: GeoSearchQuery[];
  maximumSupplementaryRounds: 2;
  plannedBy: "identity_compiler";
  compiledAt: string;
}

export interface GeoSearchProviderRun {
  runId: string;
  provider: GeoSearchProviderKey;
  queryId: string;
  query: string;
  status: "success" | "failed" | "pending_config";
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  model: string;
  endpoint: string;
  round: number;
  parameters: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export type GeoSearchEntityClassification =
  | "target_match"
  | "verified_competitor"
  | "category_related"
  | "user_demand"
  | "homonym"
  | "unrelated"
  | "insufficient_evidence";

export type GeoSearchEvidenceUsage =
  | "product_fact"
  | "competitor_fact"
  | "demand_signal"
  | "research_observation";

export interface GeoSearchEvidenceCandidate {
  candidateId: string;
  canonicalUrl: string;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  excerpt?: string;
  excerptHash?: string;
  contentHash?: string;
  retrievedAt: string;
  retrievalStatus: "retrieved";
  sourceType: "official" | "research" | "media" | "community" | "unknown";
  authority: "high" | "medium" | "low";
  providerKeys: GeoSearchProviderKey[];
  queryIds: string[];
  queries: string[];
  providerRunIds: string[];
  rawResponseRefs: string[];
  entityClassification?: Exclude<GeoSearchEntityClassification, "homonym" | "unrelated" | "insufficient_evidence">;
  /** 实体分类后的用途边界；需求与研究观察不得升级为产品事实。 */
  evidenceUsage?: GeoSearchEvidenceUsage;
  matchedIdentityAnchors?: string[];
  /** 候选 URL 命中的目标渠道（来自渠道规则包域名匹配；非目标平台来源为空） */
  channelKey?: string;
}

export interface GeoSearchChannelStats {
  /** 该渠道命中的候选来源总数 */
  candidateCount: number;
  /** 其中通过实体校验（保留在 pack.candidates 中）的数量 */
  verifiedCount: number;
}

export interface MultiSearchEvidencePack {
  contractVersion: "geo-multi-search-evidence.v2";
  queries: GeoSearchQuery[];
  providerRuns: GeoSearchProviderRun[];
  candidates: GeoSearchEvidenceCandidate[];
  /** 各目标渠道的证据分布（配置渠道规则包后才有值）——"该平台在收录什么"的原始答案 */
  channelStats?: Record<string, GeoSearchChannelStats>;
  gate: {
    decision: "passed" | "blocked";
    degraded?: boolean;
    failedProviders?: GeoSearchProviderKey[];
    entityResolution?: {
      inputCandidateCount: number;
      attemptedCandidateCount: number;
      resolvedCandidateCount: number;
      droppedCandidateCount: number;
      failedBatchCount: number;
    };
    successfulProviders: GeoSearchProviderKey[];
    configuredProviders: GeoSearchProviderKey[];
    independentSourceCount: number;
    requiredSuccessfulProviders: number;
    requiredIndependentSources: number;
    gaps: string[];
  };
  compiledAt: string;
  supplementaryRounds: number;
}

export interface GeoClaimAssessment {
  claim: string;
  stance: "supports" | "opposes" | "conditional";
  sourceUrls: string[];
  confidence: number;
}

export interface GeoEvidenceVerification {
  decision: "passed" | "blocked";
  citedUrls: string[];
  invalidUrls: string[];
  missingCitationPaths: string[];
  verifiedClaims: Array<GeoClaimAssessment & {
    normalizedClaim: string;
    status: "supported" | "opposed" | "conditional" | "conflicted";
  }>;
  gaps: string[];
}
