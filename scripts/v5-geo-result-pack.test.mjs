import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGeoResearchResultPack } from '../src/lib/v5/geo-research-result-pack.ts';
import { buildGeoResearchDownstreamCandidates } from '../src/lib/v5/geo-research-downstream.ts';

const snapshot = {
  probeSetId: 'probe-set', productId: 'product-1', researchRunId: 'run-1', entityGraphVersion: 2, roleScenarioMatrixVersion: 3, probeContractVersion: 'geo-probe.v1', websiteCoverageProfileHash: 'coverage', sourceSnapshotId: 'source', targetProviders: ['zhipu', 'doubao'], locale: 'zh-CN', region: 'CN', compiledAt: new Date().toISOString(), snapshotHash: 'hash',
  probes: [
    { probeId: 'probe-1', objective: 'public_cognition', roleId: 'it', scenarioId: 'integration', journeyStage: 'evaluation', decision: '如何集成', observationMode: 'blind', questionText: '企业如何选择知识助手？', promptVisibleEntityIds: [], scoringOnlyEntityIds: ['product-1'], expectedRelations: [], evidenceExpectation: 'ai_observation_only', scoringDimensions: ['target_mentioned'], priority: 'P0' },
    { probeId: 'probe-2', objective: 'decision_concerns', roleId: 'it', scenarioId: 'integration', journeyStage: 'evaluation', decision: '如何验收', observationMode: 'scenario_anchored', questionText: '如何验收？', promptVisibleEntityIds: ['product-1'], scoringOnlyEntityIds: [], expectedRelations: [], evidenceExpectation: 'public_source_required', scoringDimensions: ['uncertainty_expressed'], priority: 'P1' }
  ]
};

test('result pack keeps observation metrics separate from downstream decisions', () => {
  const pack = buildGeoResearchResultPack({
    productId: 'product-1', researchRunId: 'run-1', sourceSnapshotId: 'source', snapshot,
    observations: [
      { observationId: 'o1', probeId: 'probe-1', provider: 'zhipu', model: 'm1', rawAnswer: 'answer https://example.com/a', visibleCitations: ['https://example.com/a'], mentionedEntities: ['Acme Assist'], searchedAt: new Date().toISOString(), status: 'success' },
      { observationId: 'o2', probeId: 'probe-1', provider: 'doubao', model: 'm2', rawAnswer: '', visibleCitations: [], mentionedEntities: [], searchedAt: new Date().toISOString(), status: 'failed' }
    ]
  });
  assert.equal(pack.metadata.entityGraphVersion, 2);
  assert.equal(pack.researchCoverage.status, 'partial');
  assert.equal(pack.aiVisibility.targetMentionRate, 1);
  assert.deepEqual(pack.monitoringBaseline.recommendedProbeIds, ['probe-1']);
  assert.equal(pack.decisionQueue.length, 0);
  assert.deepEqual(pack.citationLandscape.citedDomains, ['example.com']);
});

test('downstream projection keeps every destination human-gated', () => {
  const pack = buildGeoResearchResultPack({
    productId: 'product-1', researchRunId: 'run-1', sourceSnapshotId: 'source', snapshot,
    observations: [
      { observationId: 'o1', probeId: 'probe-1', provider: 'zhipu', model: 'm1', rawAnswer: 'answer', visibleCitations: [], mentionedEntities: [], searchedAt: new Date().toISOString(), status: 'success' }
    ],
    structured: { contentGaps: [{ opportunityId: 'gap-1', informationGap: 'missing proof', recommendedAction: 'collect_evidence', recommendedArticleTypes: ['FAQ'], priority: 'high', evidenceReadiness: 'blocked', websiteCoverageDisposition: 'hold' }] }
  });
  const candidates = buildGeoResearchDownstreamCandidates({ snapshot, resultPack: pack, sourceArtifactId: 'artifact-1' });
  assert.equal(candidates.humanApprovalRequired, true);
  assert.equal(candidates.questionPool.length, 1);
  assert.equal(candidates.questionPool[0].evidenceStatus, 'ai_observation_only');
  assert.equal(candidates.strategyPack[0].status, 'candidate');
  assert.equal(candidates.websiteRemediation[0].disposition, 'hold');
  assert.equal(candidates.monitoring[0].probeId, 'probe-1');
});
