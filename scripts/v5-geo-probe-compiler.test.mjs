import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGeoProbeSet, defaultGeoProbeContract } from '../src/lib/v5/geo-probe-compiler.ts';

const graph = {
  graphId: 'graph-1', productId: 'product-1', version: 3,
  targetEntity: { entityId: 'product-1', entityType: 'product', canonicalName: 'Acme Assist', displayName: 'Acme Assist', aliases: [], officialDomain: 'https://acme.example' , category: 'enterprise knowledge assistant' },
  entities: [
    { entityId: 'brand-1', entityType: 'brand', canonicalName: 'Acme', aliases: [], status: 'confirmed' },
    { entityId: 'provider-1', entityType: 'service_provider', canonicalName: 'JOTO', aliases: [], status: 'confirmed' },
    { entityId: 'competitor-1', entityType: 'competitor', canonicalName: 'Other Assist', aliases: [], status: 'candidate' }
  ],
  relations: [
    { subjectEntityId: 'product-1', relation: 'provided_by', objectEntityId: 'provider-1', conditions: [], limitations: [], evidenceIds: ['e-1'], status: 'confirmed' },
    { subjectEntityId: 'product-1', relation: 'owned_by', objectEntityId: 'brand-1', conditions: [], limitations: [], evidenceIds: ['e-2'], status: 'confirmed' }
  ],
  claims: []
};
const matrix = {
  matrixId: 'matrix-1', productId: 'product-1', version: 2,
  roles: [
    { roleId: 'it', name: '负责系统接入的 IT 负责人', roleType: 'technical_evaluator', responsibilities: ['集成和部署评估'], decisionInfluence: 'evaluation', sourceIds: ['s-1'], status: 'active' },
    { roleId: 'buyer', name: '采购负责人', roleType: 'procurement', responsibilities: ['供应商选择'], decisionInfluence: 'decision', sourceIds: ['s-2'], status: 'active' },
    { roleId: 'excluded', name: '无关角色', roleType: 'end_user', responsibilities: [], decisionInfluence: 'usage', sourceIds: [], status: 'excluded' }
  ],
  scenarios: [
    { scenarioId: 'integration', name: '建设内部知识助手并接入现有系统', trigger: '项目启动', jobToBeDone: '完成权限隔离和系统集成', expectedOutcome: '稳定上线', constraints: ['权限'], relatedCapabilityClaimIds: [], priority: 'high', sourceIds: ['s-1'], status: 'active' },
    { scenarioId: 'selection', name: '评估实施伙伴并准备采购', trigger: '采购前', jobToBeDone: '选择可交付的实施方案', expectedOutcome: '可验收交付', constraints: ['预算'], relatedCapabilityClaimIds: [], priority: 'medium', sourceIds: ['s-2'], status: 'active' },
    { scenarioId: 'excluded', name: '无关场景', trigger: '', jobToBeDone: '', expectedOutcome: '', constraints: [], relatedCapabilityClaimIds: [], priority: 'low', sourceIds: [], status: 'excluded' }
  ],
  roleScenarioLinks: [
    { roleId: 'it', scenarioId: 'integration', journeyStage: 'evaluation', decisions: ['系统如何集成和部署'], informationNeeds: ['接口和权限'], evidenceNeeds: ['官方技术资料'], priority: 'high' },
    { roleId: 'buyer', scenarioId: 'selection', journeyStage: 'selection', decisions: ['如何选择实施伙伴'], informationNeeds: ['交付范围'], evidenceNeeds: ['服务商正式资料'], priority: 'high' },
    { roleId: 'it', scenarioId: 'selection', journeyStage: 'evaluation', decisions: ['如何验收交付'], informationNeeds: ['验收标准'], evidenceNeeds: ['案例和合同边界'], priority: 'medium' },
    { roleId: 'excluded', scenarioId: 'excluded', journeyStage: 'awareness', decisions: ['不要生成'], informationNeeds: [], evidenceNeeds: [], priority: 'low' }
  ]
};

function input() { return { productId: 'product-1', researchRunId: 'run-1', entityGraph: graph, roleScenarioMatrix: matrix, contract: { ...defaultGeoProbeContract }, websiteCoverageProfileHash: 'coverage-1', sourceSnapshotId: 'source-1' }; }

test('compiler creates a bounded immutable snapshot with stable hash', () => {
  const first = compileGeoProbeSet(input());
  const second = compileGeoProbeSet(input());
  assert.ok(first.probes.length >= 8 && first.probes.length <= 15);
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(first.probeSetId, second.probeSetId);
  assert.equal(first.entityGraphVersion, 3);
  assert.equal(first.roleScenarioMatrixVersion, 2);
});

test('blind probes do not expose target or relationship entities in prompt', () => {
  const snapshot = compileGeoProbeSet(input());
  for (const probe of snapshot.probes.filter(item => item.observationMode === 'blind')) {
    assert.deepEqual(probe.promptVisibleEntityIds, []);
    assert.doesNotMatch(probe.questionText, /Acme Assist|JOTO|Acme/);
  }
});

test('each P0 confirmed relationship gets blind and verification probes', () => {
  const snapshot = compileGeoProbeSet(input());
  for (const relation of graph.relations) {
    const probes = snapshot.probes.filter(probe => probe.expectedRelations.some(expected => expected.objectEntityId === relation.objectEntityId && expected.relation === relation.relation));
    assert.ok(probes.some(probe => probe.observationMode === 'blind'));
    assert.ok(probes.some(probe => probe.observationMode === 'relationship_verification'));
  }
});

test('excluded roles and scenarios never enter the compiled set', () => {
  const snapshot = compileGeoProbeSet(input());
  assert.equal(snapshot.probes.some(probe => probe.roleId === 'excluded' || probe.scenarioId === 'excluded'), false);
});
