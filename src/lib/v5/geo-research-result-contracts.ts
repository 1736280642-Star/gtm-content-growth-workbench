import type { GeoProbe, ProbeSetSnapshot } from './geo-probe-contracts';

export interface ModelAnswerObservation {
  observationId: string;
  probeId: string;
  provider: string;
  model: string;
  rawAnswer: string;
  visibleCitations: string[];
  mentionedEntities: string[];
  searchedAt: string;
  status: 'success' | 'failed' | 'unsupported';
}

export interface GeoResearchResultPack {
  metadata: {
    productId: string;
    researchRunId: string;
    entityGraphVersion: number;
    roleScenarioMatrixVersion: number;
    probeContractVersion: string;
    sourceSnapshotId: string;
    generatedAt: string;
  };
  researchCoverage: {
    probeCount: number;
    roleCoverage: string[];
    scenarioCoverage: string[];
    objectiveCoverage: string[];
    providerCoverage: string[];
    status: 'ready' | 'partial' | 'blocked';
    gaps: string[];
  };
  observations: ModelAnswerObservation[];
  aiVisibility: Record<string, unknown>;
  roleScenarioInsights: Array<Record<string, unknown>>;
  entityRelationshipFindings: Array<Record<string, unknown>>;
  competitorLandscape: Array<Record<string, unknown>>;
  citationLandscape: Record<string, unknown>;
  contentOpportunities: Array<Record<string, unknown>>;
  monitoringBaseline: {
    recommendedProbeIds: string[];
    targetEntities: string[];
    expectedRelationships: string[];
    platforms: string[];
  };
  decisionQueue: Array<Record<string, unknown>>;
}

export interface GeoResearchObservationInput {
  snapshot: ProbeSetSnapshot;
  probes: GeoProbe[];
  observations: ModelAnswerObservation[];
}
