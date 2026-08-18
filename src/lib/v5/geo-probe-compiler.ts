import { createHash } from 'node:crypto';
import type { GeoProbe, GeoProbeCompilerInput, GeoProbePriority, GeoResearchObjective, GeoObservationMode, ProbeSetSnapshot, GeoProbeContract, ProductEntityGraph, RoleScenarioMatrix } from './geo-probe-contracts';

const DEFAULT_OBJECTIVES: GeoResearchObjective[] = ['public_cognition', 'competitive_alternatives', 'decision_concerns', 'information_evidence_demand'];
const DEFAULT_MODES: GeoObservationMode[] = ['blind', 'scenario_anchored', 'relationship_verification'];

export const defaultGeoProbeContract: GeoProbeContract = {
  contractVersion: 'geo-probe.v1',
  objectives: DEFAULT_OBJECTIVES,
  allowedObservationModes: DEFAULT_MODES,
  minProbes: 8,
  maxProbes: 15,
  defaultProviders: ['openai', 'anthropic', 'google'],
  locale: 'zh-CN',
  region: 'CN',
  evidencePolicy: 'balanced'
};

function unique(values: string[]): string[] { return [...new Set(values)]; }
function hash(value: unknown): string { return createHash('sha256').update(stableSerialize(value)).digest('hex'); }
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  return '{' + Object.keys(value as Record<string, unknown>).sort().map(key => JSON.stringify(key) + ':' + stableSerialize((value as Record<string, unknown>)[key])).join(',') + '}';
}
function priority(value: 'high' | 'medium' | 'low' | undefined): GeoProbePriority { return value === 'high' ? 'P0' : value === 'medium' ? 'P1' : 'P2'; }
function entityName(graph: ProductEntityGraph, id: string): string { return graph.entities.find(entity => entity.entityId === id)?.canonicalName || (graph.targetEntity.entityId === id ? graph.targetEntity.displayName : id); }
function relationExpected(graph: ProductEntityGraph, relation: ProductEntityGraph['relations'][number]) { return [{ subjectEntityId: relation.subjectEntityId, relation: relation.relation, objectEntityId: relation.objectEntityId }]; }
function makeQuestion(graph: ProductEntityGraph, objective: GeoResearchObjective, mode: GeoObservationMode, product: string, role: string, scenario: RoleScenarioMatrix['scenarios'][number], decision: string, relation?: ProductEntityGraph['relations'][number]): string {
  if (mode === 'relationship_verification' && relation) return `公开资料如何描述 ${entityName(graph, relation.subjectEntityId)} 与 ${entityName(graph, relation.objectEntityId)} 的关系？请区分产品、品牌方、提供方和实施服务商，并列出可核验的交付或能力证据。`;
  if (mode === 'blind') {
    if (objective === 'competitive_alternatives') return `企业在“${scenario.name}”时通常会比较哪些产品、平台或实施方案？请说明各自适用条件和主要取舍。`;
    if (relation) return `企业在“${scenario.name}”中选择产品及实施伙伴时，通常会考虑哪些主体、关系和交付证据？`;
    return `企业在“${scenario.name}”时通常会如何识别可选产品，并判断它们是否适合完成“${scenario.jobToBeDone}”？`;
  }
  const prefix = `作为${role}，在“${scenario.name}”阶段使用 ${product}`;
  if (objective === 'decision_concerns') return `${prefix}时，需要重点评估哪些问题？请围绕“${decision}”说明风险、约束和验收标准。`;
  if (objective === 'information_evidence_demand') return `${prefix}时，用户需要看到哪些信息和公开证据，才能判断“${decision}”是否可行？`;
  if (objective === 'competitive_alternatives') return `${prefix}时，通常会与哪些替代方案比较？请按能力、实施和适用条件说明差异。`;
  return `${prefix}时，如何判断产品是否适合“${scenario.jobToBeDone}”？`;
}

export function validateGeoProbeContract(contract: GeoProbeCompilerInput['contract']): void {
  if (!contract.contractVersion.trim()) throw new Error('GeoProbeContract.contractVersion is required');
  if (!contract.minProbes || contract.minProbes < 1 || contract.maxProbes < contract.minProbes) throw new Error('GeoProbeContract probe bounds are invalid');
  if (!contract.objectives.length || !contract.allowedObservationModes.length) throw new Error('GeoProbeContract must declare objectives and observation modes');
  if (!contract.allowedObservationModes.includes('blind') || !contract.allowedObservationModes.includes('relationship_verification')) throw new Error('GeoProbeContract must support blind and relationship_verification modes for P0 relations');
}

export function compileGeoProbeSet(input: GeoProbeCompilerInput): ProbeSetSnapshot {
  validateGeoProbeContract(input.contract);
  if (input.entityGraph.productId !== input.productId || input.roleScenarioMatrix.productId !== input.productId) throw new Error('GeoProbe inputs must belong to the same product');
  const graph = input.entityGraph;
  const matrix = input.roleScenarioMatrix;
  const targetName = graph.targetEntity.displayName || graph.targetEntity.canonicalName;
  const activeRoles = new Map(matrix.roles.filter(role => role.status === 'active').map(role => [role.roleId, role]));
  const activeScenarios = new Map(matrix.scenarios.filter(scenario => scenario.status === 'active').map(scenario => [scenario.scenarioId, scenario]));
  const links = matrix.roleScenarioLinks.filter(link => activeRoles.has(link.roleId) && activeScenarios.has(link.scenarioId) && link.decisions.length > 0)
    .sort((a, b) => priority(a.priority).localeCompare(priority(b.priority)) || a.roleId.localeCompare(b.roleId) || a.scenarioId.localeCompare(b.scenarioId));
  if (!links.length) throw new Error('RoleScenarioMatrix has no active decision links');
  const probes: GeoProbe[] = [];
  const seenQuestions = new Set<string>();
  const add = (probe: Omit<GeoProbe, 'probeId'>) => { const normalized = probe.questionText.trim().replace(/\s+/g, ' '); if (!normalized) return; const existing = probes.find(item => item.questionText === normalized); if (existing) { existing.expectedRelations = [...existing.expectedRelations, ...probe.expectedRelations].filter((item, index, items) => items.findIndex(candidate => candidate.subjectEntityId === item.subjectEntityId && candidate.relation === item.relation && candidate.objectEntityId === item.objectEntityId) === index); existing.scoringOnlyEntityIds = unique([...existing.scoringOnlyEntityIds, ...probe.scoringOnlyEntityIds]); return; } seenQuestions.add(normalized); probes.push({ ...probe, questionText: normalized, probeId: 'pending' }); };
  const confirmedRelations = graph.relations.filter(relation => (relation.status === 'confirmed' || relation.status === 'conditional') && relation.evidenceIds.length > 0);
  const p0Relations = confirmedRelations.filter(relation => relation.status === 'confirmed' && ['owned_by', 'provided_by', 'implemented_by', 'competes_with'].includes(relation.relation));
  const firstLink = links[0];
  const makeBase = (objective: GeoResearchObjective, mode: GeoObservationMode, link: typeof firstLink, relation?: ProductEntityGraph['relations'][number]): Omit<GeoProbe, 'probeId'> => {
    const role = activeRoles.get(link.roleId)!;
    const scenario = activeScenarios.get(link.scenarioId)!;
    const decision = link.decisions[0];
    const visible = mode === 'blind' ? [] : mode === 'relationship_verification' && relation ? [relation.subjectEntityId, relation.objectEntityId] : [graph.targetEntity.entityId];
    const scoringOnly = mode === 'blind' ? unique([graph.targetEntity.entityId, ...(relation ? [relation.objectEntityId] : [])]) : [];
    return { objective, roleId: role.roleId, scenarioId: scenario.scenarioId, journeyStage: link.journeyStage, decision, observationMode: mode, questionText: makeQuestion(graph, objective, mode, targetName, role.name, scenario, decision, relation), promptVisibleEntityIds: visible, scoringOnlyEntityIds: scoringOnly, expectedRelations: relation ? relationExpected(graph, relation) : [], evidenceExpectation: mode === 'relationship_verification' ? 'official_source_required' : objective === 'information_evidence_demand' ? 'public_source_required' : 'ai_observation_only', scoringDimensions: [...new Set<GeoProbe['scoringDimensions'][number]>(['target_mentioned', objective === 'competitive_alternatives' ? 'competitor_relevance' : 'category_included', relation ? 'relationship_accuracy' : 'uncertainty_expressed'])], priority: priority(link.priority) };
  };
  if (input.contract.objectives.includes('public_cognition')) add(makeBase('public_cognition', 'blind', firstLink));
  if (input.contract.objectives.includes('competitive_alternatives')) add(makeBase('competitive_alternatives', 'blind', links[1] || firstLink));
  for (const link of links) {
    if (probes.length >= Math.min(input.contract.maxProbes, 8)) break;
    if (input.contract.objectives.includes('decision_concerns')) add(makeBase('decision_concerns', 'scenario_anchored', link));
    if (input.contract.objectives.includes('information_evidence_demand') && probes.length < Math.min(input.contract.maxProbes, 8)) add(makeBase('information_evidence_demand', 'scenario_anchored', link));
  }
  for (const relation of p0Relations) {
    const link = links.find(candidate => candidate.journeyStage === 'selection' || candidate.journeyStage === 'evaluation') || firstLink;
    if (input.contract.allowedObservationModes.includes('blind')) add(makeBase('public_cognition', 'blind', link, relation));
    if (input.contract.allowedObservationModes.includes('relationship_verification')) add(makeBase('information_evidence_demand', 'relationship_verification', link, relation));
  }
  for (const relation of confirmedRelations) {
    if (probes.length >= input.contract.maxProbes) break;
    if (!p0Relations.includes(relation) && relation.relation === 'competes_with') add(makeBase('competitive_alternatives', 'relationship_verification', firstLink, relation));
  }
  const bounded = probes.slice(0, input.contract.maxProbes);
  const probePayload = bounded.map((probe, index) => ({ ...probe, probeId: `geo-probe-${String(index + 1).padStart(3, '0')}` }));
  const snapshotCore = { productId: input.productId, researchRunId: input.researchRunId, entityGraphVersion: graph.version, roleScenarioMatrixVersion: matrix.version, probeContractVersion: input.contract.contractVersion, websiteCoverageProfileHash: input.websiteCoverageProfileHash || '', sourceSnapshotId: input.sourceSnapshotId || '', probes: probePayload, targetProviders: unique(input.contract.defaultProviders), locale: input.contract.locale, region: input.contract.region };
  const snapshotHash = hash(snapshotCore);
  const snapshot: ProbeSetSnapshot = { ...snapshotCore, probeSetId: `geo-probe-set-${snapshotHash.slice(0, 16)}`, compiledAt: new Date().toISOString(), snapshotHash };
  if (snapshot.probes.length < input.contract.minProbes) throw new Error(`Compiled ${snapshot.probes.length} probes; minimum is ${input.contract.minProbes}`);
  return snapshot;
}
