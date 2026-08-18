import type { GeoResearchFinding } from "./geo-research-contracts";
import type { GeoProbe, ProbeSetSnapshot } from "./geo-probe-contracts";
import type { GeoResearchResultPack, ModelAnswerObservation } from "./geo-research-result-contracts";

type CandidateStatus = "candidate";

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
  monitoring: Array<{
    candidateId: string;
    probeId: string;
    questionText: string;
    priority: GeoProbe["priority"];
    targetEntityIds: string[];
    expectedRelationships: string[];
    providers: string[];
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
}): GeoResearchDownstreamCandidates {
  const observations = input.resultPack.observations || [];
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
      ...summary,
      status: "candidate" as const,
      reason: "Probe observation is not a confirmed user-demand signal; human review is required before question-pool import."
    }));

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
      status: "candidate" as const,
      reason: "P0 probe is suitable for monitoring, but monitoring activation requires human confirmation and platform configuration."
    }));

  return {
    source: "geo_research_result_pack",
    sourceRunId: input.snapshot.researchRunId,
    sourceArtifactId: input.sourceArtifactId,
    humanApprovalRequired: true,
    questionPool,
    strategyPack,
    websiteRemediation,
    monitoring
  };
}
