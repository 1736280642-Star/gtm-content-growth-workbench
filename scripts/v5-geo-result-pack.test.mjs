import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGeoResearchResultPack } from '../src/lib/v5/geo-research-result-pack.ts';
import { buildGeoResearchDownstreamCandidates } from '../src/lib/v5/geo-research-downstream.ts';
import { overrideGeoProbeSetQuestions } from '../src/lib/v5/geo-probe-compiler.ts';
import { evaluateTargetChannelRuleCoverage } from '../src/lib/v5/geo-channel-rule-pack.ts';

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
  assert.equal(candidates.questionPool[0].faqBoard, 'uncategorized');
  assert.equal(candidates.strategyPack[0].status, 'candidate');
  assert.deepEqual(candidates.strategyPack[0].channelDistribution, []);
  assert.equal(candidates.websiteRemediation[0].disposition, 'hold');
  assert.equal(candidates.monitoring[0].probeId, 'probe-1');
  assert.equal(candidates.monitoring[0].retestAligned, false);
  assert.deepEqual(candidates.contentCluster, []);
});

test('channel-aware downstream candidates carry faqBoard, channelDistribution, clusters, and retest alignment', () => {
  const pack = buildGeoResearchResultPack({
    productId: 'product-1', researchRunId: 'run-1', sourceSnapshotId: 'source', snapshot,
    observations: [
      { observationId: 'o1', probeId: 'probe-1', provider: 'zhipu', model: 'm1', rawAnswer: 'answer', visibleCitations: [], mentionedEntities: [], searchedAt: new Date().toISOString(), status: 'success' }
    ],
    structured: {
      contentGaps: [{ opportunityId: 'gap-1', informationGap: 'missing proof', recommendedAction: 'collect_evidence', recommendedArticleTypes: ['FAQ'], priority: 'high', evidenceReadiness: 'blocked' }],
      aggregate: { channelCitationStats: [
        { channelKey: 'csdn', citedUrlCount: 4, citedUrlShare: 0.5, dominantContentTypes: ['hands-on tutorial'] },
        { channelKey: '', citedUrlCount: 9, citedUrlShare: 9 }
      ] }
    }
  });
  assert.equal(pack.citationLandscape.channelCitationStats.length, 1);
  const candidates = buildGeoResearchDownstreamCandidates({
    snapshot,
    resultPack: pack,
    faqBoardByQuestion: new Map([['企业如何选择知识助手', 'selection']]),
    contentClusterPlan: [{ clusterTheme: '选型对比集群', memberArticleTypes: ['FAQ', '对比'], internalLinkRationale: '共享选型意图' }],
    retestBaselineQuestions: ['企业如何选择知识助手？', '复测独有问题？']
  });
  assert.equal(candidates.questionPool[0].faqBoard, 'selection');
  assert.deepEqual(candidates.strategyPack[0].channelDistribution, [{ channelKey: 'csdn', citedUrlCount: 4, citedUrlShare: 0.5 }]);
  assert.equal(candidates.contentCluster.length, 1);
  assert.equal(candidates.contentCluster[0].clusterTheme, '选型对比集群');
  assert.equal(candidates.contentCluster[0].memberArticleTypes.length, 2);
  assert.equal(candidates.contentCluster[0].status, 'candidate');
  assert.equal(candidates.humanApprovalRequired, true);
  // P0 探针命中复测基线 → retestAligned；复测独有问题补充为监控候选
  assert.equal(candidates.monitoring[0].retestAligned, true);
  assert.equal(candidates.monitoring.length, 2);
  assert.equal(candidates.monitoring[1].questionText, '复测独有问题？');
  assert.equal(candidates.monitoring[1].retestAligned, true);
  assert.equal(candidates.monitoring[1].status, 'candidate');
});

test('retest probe set override rebuilds snapshot with P0 mention probes', () => {
  const retestSnapshot = overrideGeoProbeSetQuestions({
    snapshot,
    questions: ['企业如何选择知识助手？', '', '  腾讯云ADP和WorkBuddy怎么选？ ']
  });
  assert.equal(retestSnapshot.probes.length, 2);
  assert.equal(retestSnapshot.probes[0].questionText, '企业如何选择知识助手？');
  assert.equal(retestSnapshot.probes[1].questionText, '腾讯云ADP和WorkBuddy怎么选？');
  for (const probe of retestSnapshot.probes) {
    assert.equal(probe.priority, 'P0');
    assert.equal(probe.observationMode, 'scenario_anchored');
    assert.deepEqual(probe.scoringDimensions, ['target_mentioned']);
    assert.equal(probe.evidenceExpectation, 'ai_observation_only');
  }
  // 快照哈希重算，探针集 ID 与原快照不同
  assert.notEqual(retestSnapshot.snapshotHash, snapshot.snapshotHash);
  assert.notEqual(retestSnapshot.probeSetId, snapshot.probeSetId);
  assert.equal(retestSnapshot.productId, snapshot.productId);
  assert.equal(retestSnapshot.targetProviders, snapshot.targetProviders);
  assert.throws(() => overrideGeoProbeSetQuestions({ snapshot, questions: [] }));
  assert.throws(() => overrideGeoProbeSetQuestions({ snapshot, questions: ['  '] }));
});

test('target channel rule coverage blocks platform channels without an activated rule pack', () => {
  const pack = {
    rulePackVersionId: 'pack-v1',
    channels: [
      { channelKey: 'csdn', displayName: 'CSDN', domains: ['csdn.net'], inclusionPatterns: [], structureRequirements: [] },
      { channelKey: 'zhihu', displayName: '知乎', domains: ['zhihu.com'], inclusionPatterns: [], structureRequirements: [] }
    ]
  };
  // 自有渠道不依赖规则包：通过（含未激活规则包时）
  assert.equal(evaluateTargetChannelRuleCoverage({ targetChannels: ['wechat', 'official_website'], pack: undefined }), undefined);
  assert.equal(evaluateTargetChannelRuleCoverage({ targetChannels: [], pack: undefined }), undefined);
  // 平台渠道被规则包覆盖：通过
  assert.equal(evaluateTargetChannelRuleCoverage({ targetChannels: ['wechat', 'csdn', 'zhihu'], pack }), undefined);
  // 平台渠道存在但规则包未激活：blocked（fail-closed）
  assert.match(
    evaluateTargetChannelRuleCoverage({ targetChannels: ['wechat', 'csdn'], pack: undefined }),
    /尚未激活渠道规则包/
  );
  // 平台渠道未包含在已激活规则包：blocked 并列出缺失渠道
  const missing = evaluateTargetChannelRuleCoverage({ targetChannels: ['csdn', 'xiaohongshu'], pack });
  assert.match(missing, /xiaohongshu/);
  assert.match(missing, /pack-v1/);
  // 规则包解析失败：blocked
  assert.match(
    evaluateTargetChannelRuleCoverage({ targetChannels: ['csdn'], pack: undefined, packError: new Error('坏 JSON') }),
    /渠道规则包配置非法/
  );
});
