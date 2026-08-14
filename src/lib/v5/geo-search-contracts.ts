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
  matchedIdentityAnchors?: string[];
}

export interface MultiSearchEvidencePack {
  contractVersion: "geo-multi-search-evidence.v2";
  queries: GeoSearchQuery[];
  providerRuns: GeoSearchProviderRun[];
  candidates: GeoSearchEvidenceCandidate[];
  gate: {
    decision: "passed" | "blocked";
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
