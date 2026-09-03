import { randomUUID } from "node:crypto";
import type { RagKnowledgeChunk, RagRetrievalCandidate, RagRetrievalRequest, RagRetrievalRoute, RagRetrievalRun } from "./contracts";

export interface RagRecallPools {
  bm25: Array<{ chunk: RagKnowledgeChunk; score: number }>;
  vector: Array<{ chunk: RagKnowledgeChunk; score: number }>;
  relation: Array<{ chunk: RagKnowledgeChunk; score: number }>;
  required: Array<{ chunk: RagKnowledgeChunk; score: number; evidenceRoles: string[] }>;
}

export function inferEvidenceRoles(chunk: RagKnowledgeChunk) {
  const roles = new Set<string>();
  if (chunk.semanticType === "limitation_chunk" || chunk.limitations.length) roles.add("human_boundary");
  if (chunk.semanticType === "official_citation"
    || (["A1", "A2"].includes(chunk.authorityLevel) && Boolean(chunk.originalQuote.trim())
      && (chunk.sourceLocator.headingPath.length > 0 || chunk.sourceLocator.paragraphIndex !== undefined || Boolean(chunk.sourceLocator.characterRange)))) {
    roles.add("official_citation");
  }
  if (chunk.semanticType === "claim_chunk" && chunk.supportMode !== "background_only") roles.add("product_mechanism");
  if (["release", "change_history", "launch_or_release_fact"].includes(chunk.semanticType)) roles.add("launch_or_release_fact");
  if (["method_step", "integration", "deployment", "faq"].includes(chunk.semanticType)) roles.add("method_step");
  if (chunk.semanticType === "first_person_experience") roles.add("first_person_experience");
  if (chunk.semanticType === "industry_background") roles.add("trend_signal");
  if (chunk.scenarioTags.length || chunk.problemTags.length || chunk.supportMode === "background_only"
    || /问题|痛点|场景|挑战|需求|目标|适合/.test(`${chunk.summary}\n${chunk.content}`)) roles.add("problem_context");
  return [...roles];
}

function hardFilter(chunk: RagKnowledgeChunk, request: RagRetrievalRequest, route: RagRetrievalRoute) {
  const reasons: string[] = [];
  if (chunk.namespace !== request.namespace) reasons.push("namespace_mismatch");
  if (chunk.productId !== request.productId) reasons.push("product_mismatch");
  const evidenceUsage = chunk.evidenceUsage || (chunk.documentType === "geo_research_document" ? "research_observation" : "product_fact");
  if (request.allowedEvidenceUsages?.length && !request.allowedEvidenceUsages.includes(evidenceUsage)) reasons.push("evidence_usage_forbidden");
  const subjectEntityIds = chunk.subjectEntityIds?.length ? chunk.subjectEntityIds : [chunk.productId];
  if (request.primaryEntityId && evidenceUsage === "product_fact" && !subjectEntityIds.includes(request.primaryEntityId)) reasons.push("primary_entity_mismatch");
  if (request.forbiddenEntityIds?.some((entityId) => subjectEntityIds.includes(entityId))) reasons.push("forbidden_entity_hit");
  if (chunk.status !== "active") reasons.push("inactive_chunk");
  if (!request.permissionScope.includes(chunk.visibility)) reasons.push("visibility_denied");
  if (!request.lifecycleStatuses.includes(chunk.lifecycleStatus) || !request.lifecycleStatuses.includes(chunk.capabilityStatus)) reasons.push("lifecycle_mismatch");
  if (chunk.capabilityStatus === "unknown" && chunk.supportMode !== "background_only") reasons.push("unknown_capability_status");
  if (["planned", "beta"].includes(chunk.capabilityStatus) && request.platformContentType !== "explicit_launch_matrix") reasons.push("planned_capability_not_allowed");
  if (chunk.conflictGroupIds.length) reasons.push("unresolved_conflict");
  if (chunk.rulePackageVersionId !== request.rulePackageVersionId) reasons.push("rule_package_mismatch");
  if (route.forbiddenSupportModes.includes(chunk.supportMode)) reasons.push("support_mode_forbidden");
  const now = new Date(request.requestedAt).getTime();
  if (chunk.validFrom && new Date(chunk.validFrom).getTime() > now) reasons.push("not_yet_valid");
  if (chunk.validUntil && new Date(chunk.validUntil).getTime() < now) reasons.push("expired");
  return reasons;
}

function authorityBonus(level: RagKnowledgeChunk["authorityLevel"]) {
  return ({ A1: 0.22, A2: 0.2, B1: 0.12, B2: 0.08, C1: 0.03, C2: 0.02, D: 0, E: -0.1 })[level];
}

const promotionCapabilityPatterns = [
  /(?:场景|需求|业务).{0,8}(?:诊断|咨询|梳理|评估)|可行性评估/,
  /(?:方案|架构|原型|知识库|工作流|智能体).{0,8}(?:设计|封装|搭建|配置|编排)|垂直解决方案/,
  /(?:系统|数据|流程).{0,8}(?:集成|接入|接通|打通)|(?:实施|部署|交付).{0,6}(?:服务|支持|工作|动作)?/,
  /(?:交付)?培训|(?:持续|长期|后续).{0,8}(?:运营|优化|支持|陪跑)|运营陪跑/
];

function promotionProviderName(request: RagRetrievalRequest) {
  return request.geoMission?.entityGraph.nodes.find((item) => item.role === "service_provider")?.name;
}

function promotionCapabilityCategories(chunk: RagKnowledgeChunk, providerName: string) {
  const text = `${chunk.summary} ${chunk.content} ${chunk.originalQuote}`;
  if (!text.toLocaleLowerCase().includes(providerName.toLocaleLowerCase())) return [];
  return promotionCapabilityPatterns.flatMap((pattern, index) => pattern.test(text) ? [index] : []);
}

export function runHybridRetrieval(input: { request: RagRetrievalRequest; route: RagRetrievalRoute; indexSnapshotIds: string[]; retrievalPolicyVersion: string; pools: RagRecallPools }): RagRetrievalRun {
  const { request, route } = input;
  const byChunk = new Map<string, RagRetrievalCandidate>();
  const channels = Object.entries(input.pools) as Array<[keyof RagRecallPools, RagRecallPools[keyof RagRecallPools]]>;
  for (const [channel, pool] of channels) {
    pool.forEach((item, index) => {
      const existing = byChunk.get(item.chunk.chunkId) || { chunk: item.chunk, channels: [], rawScores: {}, rrfScore: 0, rerankScore: 0, selected: false, exclusionReasons: [], selectionReasons: [], evidenceRoles: [] };
      if (!existing.channels.includes(channel)) existing.channels.push(channel);
      existing.rawScores[channel] = item.score;
      existing.rrfScore += 1 / (60 + index + 1);
      if (channel === "required") existing.evidenceRoles.push(...((item as RagRecallPools["required"][number]).evidenceRoles));
      byChunk.set(item.chunk.chunkId, existing);
    });
  }

  const candidates = [...byChunk.values()];
  for (const candidate of candidates) {
    candidate.evidenceRoles = Array.from(new Set([...candidate.evidenceRoles, ...inferEvidenceRoles(candidate.chunk)]));
    candidate.exclusionReasons = hardFilter(candidate.chunk, request, route);
    const routeMatch = route.requiredSemanticTypes.includes(candidate.chunk.semanticType) ? 0.18 : 0;
    const limitationBonus = candidate.chunk.semanticType === "limitation_chunk" ? 0.16 : 0;
    const citationBonus = candidate.chunk.semanticType === "official_citation" ? 0.12 : 0;
    const riskPenalty = candidate.chunk.authorityLevel.startsWith("C") ? 0.08 : 0;
    const requiredClaimBonus = request.requiredClaimIds?.some((claimId) => candidate.chunk.claimIds.includes(claimId)) ? 0.4 : 0;
    candidate.rerankScore = candidate.rrfScore + authorityBonus(candidate.chunk.authorityLevel) + routeMatch + limitationBonus + citationBonus + requiredClaimBonus - riskPenalty;
    if (!candidate.exclusionReasons.length) candidate.selectionReasons = ["hard_filter_passed", ...candidate.channels.map((channel) => `recalled_by_${channel}`)];
  }

  const eligible = candidates.filter((candidate) => !candidate.exclusionReasons.length).sort((a, b) => b.rerankScore - a.rerankScore);
  const clusterCount = new Map<string, number>();
  const sourceCount = new Map<string, number>();
  const selected: RagRetrievalCandidate[] = [];
  const select = (candidate: RagRetrievalCandidate) => {
    if (candidate.selected) return false;
    if ((clusterCount.get(candidate.chunk.duplicateClusterId) || 0) >= route.duplicateClusterLimit) {
      candidate.exclusionReasons.push("duplicate_cluster_quota");
      return false;
    }
    if ((sourceCount.get(candidate.chunk.sourceId) || 0) >= route.sourcePageLimit) {
      candidate.exclusionReasons.push("source_page_quota");
      return false;
    }
    candidate.selected = true;
    selected.push(candidate);
    clusterCount.set(candidate.chunk.duplicateClusterId, (clusterCount.get(candidate.chunk.duplicateClusterId) || 0) + 1);
    sourceCount.set(candidate.chunk.sourceId, (sourceCount.get(candidate.chunk.sourceId) || 0) + 1);
    return true;
  };
  for (const role of route.requiredEvidenceRoles) {
    const candidate = eligible.find((item) => !item.selected && item.evidenceRoles.includes(role));
    if (candidate) select(candidate);
  }
  const providerName = promotionProviderName(request);
  const selectedPromotionCategories = new Set<number>();
  if (providerName) {
    for (let category = 0; category < promotionCapabilityPatterns.length; category += 1) {
      const candidate = eligible.find((item) =>
        !item.selected && promotionCapabilityCategories(item.chunk, providerName).includes(category)
      );
      if (candidate && select(candidate)) selectedPromotionCategories.add(category);
      if (selectedPromotionCategories.size >= 3) break;
    }
  }
  for (const candidate of eligible) {
    select(candidate);
    if (selected.length >= route.candidateLimits.final) break;
  }
  const selectedRoles = new Set(selected.flatMap((candidate) => candidate.evidenceRoles));
  const missingEvidenceRoles = [
    ...route.requiredEvidenceRoles.filter((role) => !selectedRoles.has(role)),
    ...(providerName && selectedPromotionCategories.size < 2 ? ["promotion_service_capability"] : [])
  ];
  const status = missingEvidenceRoles.length ? "needs_material" : "completed";
  const now = new Date().toISOString();
  return { retrievalRunId: `retrieval-${randomUUID()}`, retrievalRequestId: request.retrievalRequestId, indexSnapshotIds: input.indexSnapshotIds,
    routeId: route.routeId, routeVersion: route.routeVersion, retrievalPolicyVersion: input.retrievalPolicyVersion, status,
    candidates, selectedChunkIds: selected.map((candidate) => candidate.chunk.chunkId), missingEvidenceRoles, startedAt: now, completedAt: now };
}
