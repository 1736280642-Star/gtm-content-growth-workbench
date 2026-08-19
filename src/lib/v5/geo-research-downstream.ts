import type { GeoResearchFinding } from "./geo-research-contracts";
import type { GeoProbe, ProbeSetSnapshot } from "./geo-probe-contracts";
import type { GeoResearchResultPack, ModelAnswerObservation } from "./geo-research-result-contracts";

type CandidateStatus = "candidate";

export interface GeoChannelDistributionEntry {
  channelKey: string;
  citedUrlCount: number;
  citedUrlShare: number;
}

export interface GeoResearchDownstreamCandidates {
  source: "geo_research_result_pack";
  sourceRunId: string;
  sourceArtifactId?: string;
  humanApprovalRequired: true;
  questionPool: Array<{
    candidateId: string;
    probeId: string;
    questionText: string;
    objective: GeoProbe["objective"];
    roleId: string;
    scenarioId: string;
    journeyStage: GeoProbe["journeyStage"];
    decision: string;
    faqBoard: string;
    observationCount: number;
    successfulObservationCount: number;
    evidenceStatus: "unverified" | "ai_observation_only";
    status: CandidateStatus;
    reason: string;
  }>;
  strategyPack: Array<{
    candidateId: string;
    opportunityId: string;
    informationGap: string;
    recommendedAction: string;
    recommendedArticleTypes: string[];
    priority: string;
    evidenceReadiness: string;
    websiteCoverageDisposition?: string;
    channelDistribution: GeoChannelDistributionEntry[];
    status: CandidateStatus;
    reason: string;
  }>;
  websiteRemediation: Array<{
    candidateId: string;
    opportunityId: string;
    disposition: "new_content" | "refresh_existing" | "hold";
    action: string;
    informationGap: string;
    priority: string;
    status: CandidateStatus;
    reason: string;
  }>;
  contentCluster: Array<{
    candidateId: string;
    clusterTheme: string;
    memberArticleTypes: string[];
    internalLinkRationale: string;
    status: CandidateStatus;
    reason: string;
  }>;
  monitoring: Array<{
    candidateId: string;
    probeId: string;
    questionText: string;
    priority: GeoProbe["priority"];
    targetEntityIds: string[];
    expectedRelationships: string[];
    providers: string[];
    retestAligned: boolean;
    status: CandidateStatus;
    reason: string;
  }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function normalizeQuestionText(value: string) {
  return value.toLowerCase().replace(/[\s，。！？、：；“”"'（）()\-—_]/g, "");
}

function readChannelDistribution(resultPack: GeoResearchResultPack): GeoChannelDistributionEntry[] {
  const landscape = record(resultPack.citationLandscape);
  if (!Array.isArray(landscape.channelCitationStats)) return [];
  return landscape.channelCitationStats.flatMap((item) => {
    const entry = record(item);
    const channelKey = typeof entry.channelKey === "string" && entry.channelKey.trim() ? entry.channelKey.trim() : "";
    if (!channelKey) return [];
    const citedUrlCount = typeof entry.citedUrlCount === "number" && Number.isFinite(entry.citedUrlCount) ? Math.max(0, Math.round(entry.citedUrlCount)) : 0;
    const citedUrlShare = typeof entry.citedUrlShare === "number" && Number.isFinite(entry.citedUrlShare) ? Math.max(0, Math.min(1, entry.citedUrlShare)) : 0;
    return [{ channelKey, citedUrlCount, citedUrlShare }];
  });
}

function observationSummary(probeId: string, observations: ModelAnswerObservation[]) {
  const rows = observations.filter((item) => item.probeId === probeId);
  const successful = rows.filter((item) => item.status === "success");
  const hasCitation = successful.some((item) => item.visibleCitations.length > 0);
  return {
    observationCount: rows.length,
    successfulObservationCount: successful.length,
    evidenceStatus: hasCitation ? "unverified" as const : "ai_observation_only" as const
  };
}

function relationshipText(probe: GeoProbe) {
  return probe.expectedRelations.map((relation) => `${relation.subjectEntityId}:${relation.relation}:${relation.objectEntityId}`);
}

export function buildGeoResearchDownstreamCandidates(input: {
  snapshot: ProbeSetSnapshot;
  resultPack: GeoResearchResultPack;
  findings?: GeoResearchFinding[];
  sourceArtifactId?: string;
  /** live_question_discovery 输出的问题板块映射（归一化问题文本 → faqBoard） */
  faqBoardByQuestion?: Map<string, string>;
  /** 蓝图 contentClusterPlan（内链集群，人工批准前仅作候选） */
  contentClusterPlan?: unknown;
  /** 蓝图 retestBaseline.questions（提及率 KPI 复测探针集） */
  retestBaselineQuestions?: string[];
}): GeoResearchDownstreamCandidates {
  const observations = input.resultPack.observations || [];
  const faqBoardFor = (questionText: string) => {
    const board = input.faqBoardByQuestion?.get(normalizeQuestionText(questionText));
    return board && board.trim() ? board.trim() : "uncategorized";
  };
  const questionPool = input.snapshot.probes
    .map((probe) => ({ probe, summary: observationSummary(probe.probeId, observations) }))
    .filter(({ summary }) => summary.successfulObservationCount > 0)
    .map(({ probe, summary }) => ({
      candidateId: `geo-question-candidate:${input.snapshot.researchRunId}:${probe.probeId}`,
      probeId: probe.probeId,
      questionText: probe.questionText,
      objective: probe.objective,
      roleId: probe.roleId,
      scenarioId: probe.scenarioId,
      journeyStage: probe.journeyStage,
      decision: probe.decision,
      faqBoard: faqBoardFor(probe.questionText),
      ...summary,
      status: "candidate" as const,
      reason: "Probe observation is not a confirmed user-demand signal; human review is required before question-pool import."
    }));

  const channelDistribution = readChannelDistribution(input.resultPack);
  const strategyPack = input.resultPack.contentOpportunities.map((raw, index) => {
    const item = record(raw);
    const opportunityId = typeof item.opportunityId === "string" && item.opportunityId.trim()
      ? item.opportunityId.trim()
      : `opportunity-${index + 1}`;
    return {
      candidateId: `geo-strategy-candidate:${input.snapshot.researchRunId}:${opportunityId}`,
      opportunityId,
      informationGap: typeof item.informationGap === "string" ? item.informationGap : "",
      recommendedAction: typeof item.recommendedAction === "string" ? item.recommendedAction : "monitor_only",
      recommendedArticleTypes: strings(item.recommendedArticleTypes),
      priority: typeof item.priority === "string" ? item.priority : "low",
      evidenceReadiness: typeof item.evidenceReadiness === "string" ? item.evidenceReadiness : "blocked",
      websiteCoverageDisposition: typeof item.websiteCoverageDisposition === "string" ? item.websiteCoverageDisposition : undefined,
      channelDistribution,
      status: "candidate" as const,
      reason: "Result-pack opportunity is a research hypothesis and cannot activate a strategy pack automatically."
    };
  });

  const websiteRemediation = strategyPack
    .filter((item) => item.websiteCoverageDisposition)
    .map((item) => ({
      candidateId: `geo-site-remediation:${input.snapshot.researchRunId}:${item.opportunityId}`,
      opportunityId: item.opportunityId,
      disposition: (item.websiteCoverageDisposition === "new_content" || item.websiteCoverageDisposition === "refresh_existing" || item.websiteCoverageDisposition === "hold"
        ? item.websiteCoverageDisposition
        : "hold") as "new_content" | "refresh_existing" | "hold",
      action: item.recommendedAction,
      informationGap: item.informationGap,
      priority: item.priority,
      status: "candidate" as const,
      reason: "Website action remains a candidate until the official coverage audit and a human content decision agree."
    }));

  const contentCluster = (Array.isArray(input.contentClusterPlan) ? input.contentClusterPlan : [])
    .flatMap((raw, index) => {
      const item = record(raw);
      const clusterTheme = typeof item.clusterTheme === "string" ? item.clusterTheme.trim() : "";
      const memberArticleTypes = strings(item.memberArticleTypes);
      if (!clusterTheme && !memberArticleTypes.length) return [];
      return [{
        candidateId: `geo-content-cluster:${input.snapshot.researchRunId}:${clusterTheme || `cluster-${index + 1}`}`,
        clusterTheme: clusterTheme || `cluster-${index + 1}`,
        memberArticleTypes,
        internalLinkRationale: typeof item.internalLinkRationale === "string" ? item.internalLinkRationale : "",
        status: "candidate" as const,
        reason: "Blueprint internal-link cluster is a draft hypothesis; cluster activation requires human strategy approval."
      }];
    });

  const retestQuestionSet = new Set((input.retestBaselineQuestions || []).map((question) => normalizeQuestionText(question)));
  const probeQuestionSet = new Set(input.snapshot.probes.map((probe) => normalizeQuestionText(probe.questionText)));
  const monitoring = input.snapshot.probes
    .filter((probe) => probe.priority === "P0")
    .map((probe) => ({
      candidateId: `geo-monitor-candidate:${input.snapshot.researchRunId}:${probe.probeId}`,
      probeId: probe.probeId,
      questionText: probe.questionText,
      priority: probe.priority,
      targetEntityIds: [...new Set([...probe.scoringOnlyEntityIds, ...probe.promptVisibleEntityIds, ...probe.expectedRelations.flatMap((relation) => [relation.subjectEntityId, relation.objectEntityId])])],
      expectedRelationships: relationshipText(probe),
      providers: input.resultPack.monitoringBaseline.platforms.length ? input.resultPack.monitoringBaseline.platforms : input.snapshot.targetProviders,
      retestAligned: retestQuestionSet.has(normalizeQuestionText(probe.questionText)),
      status: "candidate" as const,
      reason: "P0 probe is suitable for monitoring, but monitoring activation requires human confirmation and platform configuration."
    }));
  // 蓝图 retestBaseline 中未被任何探针覆盖的问题补充为监控候选，保证提及率复测探针集完整对齐
  for (const question of input.retestBaselineQuestions || []) {
    const normalized = normalizeQuestionText(question);
    if (!normalized || probeQuestionSet.has(normalized)) continue;
    monitoring.push({
      candidateId: `geo-monitor-retest:${input.snapshot.researchRunId}:${normalized.slice(0, 60)}`,
      probeId: `retest:${normalized.slice(0, 60)}`,
      questionText: question,
      priority: "P0" as const,
      targetEntityIds: [],
      expectedRelationships: [],
      providers: input.resultPack.monitoringBaseline.platforms.length ? input.resultPack.monitoringBaseline.platforms : input.snapshot.targetProviders,
      retestAligned: true,
      status: "candidate" as const,
      reason: "Retest question from the draft blueprint baseline; monitoring activation requires human confirmation."
    });
  }

  return {
    source: "geo_research_result_pack",
    sourceRunId: input.snapshot.researchRunId,
    sourceArtifactId: input.sourceArtifactId,
    humanApprovalRequired: true,
    questionPool,
    strategyPack,
    websiteRemediation,
    contentCluster,
    monitoring
  };
}
