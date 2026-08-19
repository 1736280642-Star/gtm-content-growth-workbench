import type { ProbeSetSnapshot } from './geo-probe-contracts';
import type { GeoResearchResultPack, ModelAnswerObservation } from './geo-research-result-contracts';

function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function records(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []; }

/** frontend_baseline aggregate.channelCitationStats → KPI 归因数据（被 AI 引用 URL 的渠道分布） */
function channelCitationStats(value: unknown): Array<Record<string, unknown>> {
  return records(value).flatMap((item) => {
    const channelKey = typeof item.channelKey === 'string' && item.channelKey.trim() ? item.channelKey.trim() : '';
    if (!channelKey) return [];
    const citedUrlCount = typeof item.citedUrlCount === 'number' && Number.isFinite(item.citedUrlCount) ? Math.max(0, Math.round(item.citedUrlCount)) : 0;
    const citedUrlShare = typeof item.citedUrlShare === 'number' && Number.isFinite(item.citedUrlShare) ? Math.max(0, Math.min(1, item.citedUrlShare)) : 0;
    const dominantContentTypes = Array.isArray(item.dominantContentTypes)
      ? item.dominantContentTypes.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, 8)
      : [];
    return [{ channelKey, citedUrlCount, citedUrlShare, dominantContentTypes }];
  });
}

export function buildGeoResearchResultPack(input: { productId: string; researchRunId: string; sourceSnapshotId: string; snapshot: ProbeSetSnapshot; observations: ModelAnswerObservation[]; structured?: Record<string, unknown>; generatedAt?: string }): GeoResearchResultPack {
  const observations = input.observations;
  const successful = observations.filter((item) => item.status === 'success');
  const providers = unique(observations.map((item) => item.provider));
  const objectives = unique(input.snapshot.probes.map((item) => item.objective));
  const roleCoverage = unique(input.snapshot.probes.map((item) => item.roleId));
  const scenarioCoverage = unique(input.snapshot.probes.map((item) => item.scenarioId));
  const mentioned = successful.filter((item) => item.mentionedEntities.length > 0).length;
  const cited = successful.filter((item) => item.visibleCitations.length > 0).length;
  const providerBreakdown = providers.map((provider) => { const rows = observations.filter((item) => item.provider === provider); const ok = rows.filter((item) => item.status === 'success'); return { provider, observationCount: rows.length, successCount: ok.length, targetMentionRate: ok.length ? ok.filter((item) => item.mentionedEntities.length > 0).length / ok.length : 0, citationRate: ok.length ? ok.filter((item) => item.visibleCitations.length > 0).length / ok.length : 0 }; });
  const roleScenarioInsights: Array<Record<string, unknown>> = [];
  const insightKeys = new Set<string>();
  for (const probe of input.snapshot.probes) {
    const key = probe.roleId + ':' + probe.scenarioId;
    if (insightKeys.has(key)) continue;
    insightKeys.add(key);
    roleScenarioInsights.push({ role: probe.roleId, scenario: probe.scenarioId, journeyStage: probe.journeyStage, decisions: [probe.decision], concerns: observations.filter((item) => item.probeId === probe.probeId && item.rawAnswer).map((item) => item.rawAnswer.slice(0, 280)), informationNeeds: [], evidenceNeeds: [probe.evidenceExpectation], confidence: observations.some((item) => item.probeId === probe.probeId && item.status === 'success') ? 0.6 : 0.2 });
  }
  const relationshipFindings = input.snapshot.probes.flatMap((probe) => probe.expectedRelations.map((relation) => { const rows = observations.filter((item) => item.probeId === probe.probeId && item.status === 'success'); return { expectedRelationship: relation.subjectEntityId + ':' + relation.relation + ':' + relation.objectEntityId, observedRelationship: rows.length ? 'observed_answer_requires_evidence_binding' : 'not_observed', status: rows.length ? 'ambiguous' : 'missing', observationIds: rows.map((item) => item.observationId), evidenceIds: [] }; }));
  const structuredRecord = input.structured || {};
  const contentGaps = records((structuredRecord.competitorLandscape as Record<string, unknown> | undefined)?.contentGaps || structuredRecord.contentGaps);
  return {
    metadata: { productId: input.productId, researchRunId: input.researchRunId, entityGraphVersion: input.snapshot.entityGraphVersion, roleScenarioMatrixVersion: input.snapshot.roleScenarioMatrixVersion, probeContractVersion: input.snapshot.probeContractVersion, sourceSnapshotId: input.sourceSnapshotId, generatedAt: input.generatedAt || new Date().toISOString() },
    researchCoverage: { probeCount: input.snapshot.probes.length, roleCoverage, scenarioCoverage, objectiveCoverage: objectives, providerCoverage: providers, status: successful.length ? (successful.length === observations.length ? 'ready' : 'partial') : 'blocked', gaps: successful.length ? [] : ['没有成功的模型回答观测'] },
    observations,
    aiVisibility: { observationCount: observations.length, successCount: successful.length, targetMentionRate: successful.length ? mentioned / successful.length : 0, citationRate: successful.length ? cited / successful.length : 0, providerBreakdown },
    roleScenarioInsights,
    entityRelationshipFindings: relationshipFindings,
    competitorLandscape: records((structuredRecord.competitorLandscape as Record<string, unknown> | undefined)?.competitors),
    citationLandscape: { citedDomains: unique(observations.flatMap((item) => item.visibleCitations.map((url) => { try { return new URL(url).hostname; } catch { return ''; } }))), channelCitationStats: channelCitationStats((structuredRecord.aggregate as Record<string, unknown> | undefined)?.channelCitationStats), ownedDomainCitationRate: 0, officialEvidenceCoverage: 0, unsupportedClaims: [], sourceGaps: [] },
    contentOpportunities: contentGaps.map((gap) => ({ ...gap, recommendedAction: 'monitor_only', evidenceReadiness: 'blocked', priority: 'low', reason: 'AI 观测缺口尚未经过真实需求和产品证据门禁' })),
    monitoringBaseline: { recommendedProbeIds: input.snapshot.probes.filter((probe) => probe.priority === 'P0').map((probe) => probe.probeId), targetEntities: [], expectedRelationships: relationshipFindings.map((item) => item.expectedRelationship), platforms: providers },
    decisionQueue: contentGaps.map((gap, index) => ({ decisionType: 'collect_missing_evidence', targetId: String(gap.id || gap.title || 'gap-' + index), reason: '结果包只生成候选，需人工确认后进入问题池或策略包' }))
  };
}
