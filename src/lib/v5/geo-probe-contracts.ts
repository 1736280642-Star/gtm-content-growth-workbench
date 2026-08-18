import type { ProductGeoStrategyPackRecord } from './product-strategy-pack-contracts';

export type GeoResearchObjective = 'public_cognition' | 'competitive_alternatives' | 'decision_concerns' | 'information_evidence_demand';
export type GeoObservationMode = 'blind' | 'scenario_anchored' | 'relationship_verification';
export type GeoProbePriority = 'P0' | 'P1' | 'P2';
export type GeoProbeEvidenceExpectation = 'ai_observation_only' | 'public_source_required' | 'official_source_required' | 'multi_source_required';
export type GeoProbeScoringDimension = 'target_mentioned' | 'category_included' | 'relationship_accuracy' | 'competitor_relevance' | 'owned_source_cited' | 'target_page_cited' | 'uncertainty_expressed';

export interface ProductEntityGraph {
  graphId: string;
  productId: string;
  version: number;
  targetEntity: { entityId: string; entityType: 'product'; canonicalName: string; displayName: string; aliases: string[]; officialDomain?: string; category?: string };
  entities: Array<{ entityId: string; entityType: 'brand' | 'owner' | 'service_provider' | 'implementation_partner' | 'competitor' | 'category' | 'platform'; canonicalName: string; aliases: string[]; status: 'confirmed' | 'candidate' | 'rejected' }>;
  relations: Array<{ subjectEntityId: string; relation: 'owned_by' | 'provided_by' | 'implemented_by' | 'integrates_with' | 'belongs_to_category' | 'serves_audience' | 'supports_scenario' | 'competes_with'; objectEntityId: string; conditions: string[]; limitations: string[]; evidenceIds: string[]; status: 'confirmed' | 'conditional' | 'candidate' | 'rejected' }>;
  claims: Array<{ claimId: string; claimType: 'positioning' | 'capability' | 'scenario' | 'boundary'; text: string; evidenceIds: string[]; status: 'supported' | 'conditional' }>;
}

export interface RoleScenarioMatrix {
  matrixId: string;
  productId: string;
  version: number;
  roles: Array<{ roleId: string; name: string; roleType: 'business_decider' | 'technical_evaluator' | 'procurement' | 'security_compliance' | 'implementation_owner' | 'end_user' | 'operations_owner'; responsibilities: string[]; decisionInfluence: 'decision' | 'evaluation' | 'execution' | 'usage'; sourceIds: string[]; status: 'active' | 'candidate' | 'excluded' }>;
  scenarios: Array<{ scenarioId: string; name: string; trigger: string; jobToBeDone: string; expectedOutcome: string; constraints: string[]; relatedCapabilityClaimIds: string[]; priority: 'high' | 'medium' | 'low'; sourceIds: string[]; status: 'active' | 'candidate' | 'excluded' }>;
  roleScenarioLinks: Array<{ roleId: string; scenarioId: string; journeyStage: 'awareness' | 'selection' | 'evaluation' | 'procurement' | 'implementation' | 'acceptance' | 'operation'; decisions: string[]; informationNeeds: string[]; evidenceNeeds: string[]; priority: 'high' | 'medium' | 'low' }>;
}

export interface GeoProbeContract {
  contractVersion: string;
  objectives: GeoResearchObjective[];
  allowedObservationModes: GeoObservationMode[];
  minProbes: number;
  maxProbes: number;
  defaultProviders: string[];
  locale: string;
  region: string;
  evidencePolicy: 'strict' | 'balanced' | 'observational';
}

export interface GeoProbe {
  probeId: string;
  objective: GeoResearchObjective;
  roleId: string;
  scenarioId: string;
  journeyStage: RoleScenarioMatrix['roleScenarioLinks'][number]['journeyStage'];
  decision: string;
  observationMode: GeoObservationMode;
  questionText: string;
  promptVisibleEntityIds: string[];
  scoringOnlyEntityIds: string[];
  expectedRelations: Array<{ subjectEntityId: string; relation: ProductEntityGraph['relations'][number]['relation']; objectEntityId: string }>;
  evidenceExpectation: GeoProbeEvidenceExpectation;
  scoringDimensions: GeoProbeScoringDimension[];
  priority: GeoProbePriority;
}

export interface ProbeSetSnapshot {
  probeSetId: string;
  productId: string;
  researchRunId: string;
  entityGraphVersion: number;
  roleScenarioMatrixVersion: number;
  probeContractVersion: string;
  websiteCoverageProfileHash: string;
  sourceSnapshotId: string;
  probes: GeoProbe[];
  targetProviders: string[];
  locale: string;
  region: string;
  compiledAt: string;
  snapshotHash: string;
}

export interface GeoProbeCompilerInput {
  productId: string;
  researchRunId: string;
  entityGraph: ProductEntityGraph;
  roleScenarioMatrix: RoleScenarioMatrix;
  contract: GeoProbeContract;
  strategyPack?: ProductGeoStrategyPackRecord;
  websiteCoverageProfileHash?: string;
  sourceSnapshotId?: string;
}
