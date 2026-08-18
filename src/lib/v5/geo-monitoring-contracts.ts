import type { V5MutationContext } from "./observation-contracts";

export type GeoMonitoringSelectionSource = "manual" | "geo_strategy_recommended" | "geo_research_confirmed" | "observation_promoted";
export type GeoMonitoringQuestionStatus = "active" | "paused" | "archived";

export interface GeoMonitoringQuestion {
  id: string;
  productId: string;
  questionVersionId?: string;
  questionText: string;
  targetEntityName?: string;
  expectedRelationship?: string;
  status: GeoMonitoringQuestionStatus;
  selectionSource: GeoMonitoringSelectionSource;
  strategyPackId?: string;
  priority: "high" | "medium" | "low";
  platforms: string[];
  locale: string;
  region?: string;
  ownedDomains: string[];
  targetSolutionUrls: string[];
  samplesPerMonth: number;
  activeFrom: string;
  activeTo?: string;
  approvedBy: string;
  approvedAt: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface GeoMonitoringRecommendation {
  productId: string;
  questionVersionId?: string;
  questionText: string;
  source: "geo_strategy_recommended" | "geo_research_confirmed";
  strategyPackId?: string;
  alreadyConfigured: boolean;
}

export interface GeoQuestionMetric {
  monitoringQuestionId: string;
  month: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  brandMentionCount: number;
  ownedCitationCount: number;
  categoryInclusionCount: number;
  relationshipAccurateCount: number;
  targetSolutionCitationCount: number;
  totalCitationCount: number;
  brandMentionRate: number | null;
  ownedCitationRate: number | null;
  categoryInclusionRate: number | null;
  relationshipAccuracyRate: number | null;
  targetSolutionCitationRate: number | null;
  brandMentionConfidence95: { lower: number; upper: number } | null;
  ownedCitationConfidence95: { lower: number; upper: number } | null;
  citationShareOfVoice: number | null;
  medianCitationRank: number | null;
  answerFailureRate: number | null;
  platformCoverageComplete: boolean;
  sampleStatus: "insufficient" | "directional" | "reliable";
  evidenceSource: "ui_capture_real";
  platformBreakdown: Array<{
    platform: string;
    successfulRuns: number;
    brandMentionRate: number | null;
    ownedCitationRate: number | null;
    categoryInclusionRate: number | null;
    relationshipAccuracyRate: number | null;
    targetSolutionCitationRate: number | null;
  }>;
}

export interface GeoMonitoringWorkspace {
  source: "formal_database" | "pending_config";
  questions: GeoMonitoringQuestion[];
  recommendations: GeoMonitoringRecommendation[];
  metrics: GeoQuestionMetric[];
  message?: string;
}

export interface CreateGeoMonitoringQuestionRequest extends V5MutationContext {
  productId: string;
  questionVersionId?: string;
  questionText: string;
  targetEntityName?: string;
  expectedRelationship?: string;
  selectionSource: GeoMonitoringSelectionSource;
  strategyPackId?: string;
  priority?: "high" | "medium" | "low";
  platforms: string[];
  locale?: string;
  region?: string;
  ownedDomains?: string[];
  targetSolutionUrls?: string[];
  samplesPerMonth?: number;
}

export interface UpdateGeoMonitoringQuestionRequest extends V5MutationContext {
  status?: GeoMonitoringQuestionStatus;
  priority?: "high" | "medium" | "low";
  platforms?: string[];
  locale?: string;
  region?: string;
  ownedDomains?: string[];
  samplesPerMonth?: number;
}
