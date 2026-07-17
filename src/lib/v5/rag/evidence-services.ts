import { createHash, randomUUID } from "node:crypto";
import type {
  RagClaimPlan,
  RagEvidenceDecision,
  RagEvidenceItem,
  RagEvidencePreview,
  RagFinalEvidencePack,
  RagInfrastructureStatus,
  RagKnowledgeChunk,
  RagRetrievalRequest,
  RagRetrievalRoute,
  RagRetrievalRun
} from "./contracts";

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function evidenceItem(chunk: RagKnowledgeChunk, selectionReason: string[], evidenceRoles: string[]): RagEvidenceItem {
  return {
    evidenceItemId: `evidence-${chunk.chunkId}`,
    chunkId: chunk.chunkId,
    primaryClaimId: chunk.primaryClaimId,
    claimIds: chunk.claimIds,
    sourceId: chunk.sourceId,
    sourceRevisionId: chunk.sourceRevisionId,
    sourceLocator: chunk.sourceLocator,
    title: chunk.chunkTitle,
    summary: chunk.summary,
    originalQuote: chunk.originalQuote,
    canonicalUrl: chunk.canonicalUrl,
    documentType: chunk.documentType,
    authorityLevel: chunk.authorityLevel,
    supportMode: chunk.supportMode,
    claimScope: chunk.claimScope,
    status: chunk.status,
    version: chunk.chunkerVersion,
    conditions: chunk.conditions,
    limitations: chunk.limitations,
    validity: { validFrom: chunk.validFrom, validUntil: chunk.validUntil, lifecycleStatus: chunk.lifecycleStatus, capabilityStatus: chunk.capabilityStatus },
    selectionReason,
    allowedUsage: evidenceRoles,
    forbiddenUsage: chunk.supportMode === "background_only"
      ? ["current_product_capability", "performance_result", "privacy_commitment"]
      : chunk.limitations.length ? ["unqualified_claim"] : []
  };
}

export function buildEvidencePreview(input: {
  matrixItemId: string;
  matrixVersionId: string;
  retrievalRun: RagRetrievalRun;
  sourceSnapshotHash: string;
  infrastructure: RagInfrastructureStatus;
}): RagEvidencePreview {
  const selected = input.retrievalRun.candidates.filter((candidate) => candidate.selected);
  const conflicts = selected.filter((candidate) => candidate.chunk.conflictGroupIds.length).flatMap((candidate) => candidate.chunk.conflictGroupIds);
  const status = input.infrastructure.status !== "ready" ? "pending_config"
    : conflicts.length ? "blocked"
    : input.retrievalRun.missingEvidenceRoles.length ? "needs_material"
    : input.retrievalRun.status === "failed" ? "needs_review" : "preview_ready";
  return {
    evidencePreviewId: `preview-${randomUUID()}`,
    matrixItemId: input.matrixItemId,
    matrixVersionId: input.matrixVersionId,
    retrievalRunId: input.retrievalRun.retrievalRunId,
    status,
    coreClaims: selected.flatMap((candidate) => candidate.chunk.primaryClaimId ? [candidate.chunk.primaryClaimId] : []),
    provableAngles: selected.filter((candidate) => candidate.chunk.supportMode !== "background_only").map((candidate) => candidate.chunk.summary),
    conditionalCapabilities: selected.filter((candidate) => candidate.chunk.conditions.length || candidate.chunk.limitations.length).map((candidate) => candidate.chunk.summary),
    officialCitations: selected.filter((candidate) => candidate.chunk.semanticType === "official_citation").map((candidate) => evidenceItem(candidate.chunk, candidate.selectionReasons, candidate.evidenceRoles)),
    forbiddenTitleClaims: selected.filter((candidate) => candidate.chunk.supportMode === "background_only" || candidate.chunk.conditions.length).map((candidate) => candidate.chunk.summary),
    gaps: input.retrievalRun.missingEvidenceRoles,
    conflicts,
    sourceSnapshotHash: input.sourceSnapshotHash,
    createdAt: new Date().toISOString()
  };
}

export function buildClaimPlan(route: RagRetrievalRoute, run: RagRetrievalRun): RagClaimPlan {
  const selected = run.candidates.filter((candidate) => candidate.selected);
  const slots = route.requiredEvidenceRoles.map((role) => {
    const matching = selected.filter((candidate) => candidate.evidenceRoles.includes(role));
    return {
      slotId: `${route.routeId}:${role}`,
      evidenceRole: role,
      required: true,
      minItems: 1,
      allowedSemanticTypes: route.requiredSemanticTypes,
      selectedEvidenceItemIds: matching.map((candidate) => `evidence-${candidate.chunk.chunkId}`),
      status: matching.length ? "satisfied" as const : "missing" as const
    };
  });
  return {
    claimPlanVersion: "v5-claim-plan@1",
    platformContentType: route.platformContentType,
    requiredClaimIds: selected.flatMap((candidate) => candidate.chunk.primaryClaimId ? [candidate.chunk.primaryClaimId] : []),
    forbiddenClaimIds: run.candidates.filter((candidate) => candidate.exclusionReasons.some((reason) => ["unresolved_conflict", "lifecycle_mismatch", "product_mismatch"].includes(reason))).flatMap((candidate) => candidate.chunk.claimIds),
    slots
  };
}

export function buildFinalEvidencePack(input: {
  monthlyPlanId: string;
  matrixVersionId: string;
  matrixItemId: string;
  taskId: string;
  taskVersion: number;
  request: RagRetrievalRequest;
  route: RagRetrievalRoute;
  retrievalRun: RagRetrievalRun;
  rulePackageVersionId: string;
  sourceSnapshotHash: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  taskSnapshot: Record<string, unknown>;
  governanceSnapshot: Record<string, unknown>;
  infrastructure: RagInfrastructureStatus;
  supersedesPackId?: string;
}): RagFinalEvidencePack {
  const claimPlan = buildClaimPlan(input.route, input.retrievalRun);
  const selected = input.retrievalRun.candidates.filter((candidate) => candidate.selected);
  const items = selected.map((candidate) => evidenceItem(candidate.chunk, candidate.selectionReasons, candidate.evidenceRoles));
  const missingSlots = claimPlan.slots.filter((slot) => slot.status !== "satisfied").map((slot) => slot.evidenceRole);
  const conflicts = selected.filter((candidate) => candidate.chunk.conflictGroupIds.length).flatMap((candidate) => candidate.chunk.conflictGroupIds);
  const outdatedEvidence = selected.filter((candidate) => candidate.chunk.lifecycleStatus !== "current" || candidate.chunk.status !== "active").map((candidate) => candidate.chunk.chunkId);
  const decision: RagEvidenceDecision = input.infrastructure.status !== "ready" || !input.embeddingProvider || !input.embeddingModel ? "pending_config"
    : conflicts.length ? "blocked"
    : missingSlots.length ? "needs_material"
    : outdatedEvidence.length ? "needs_review"
    : items.some((item) => item.conditions.length || item.limitations.length) ? "generatable_with_downgrade"
    : "generatable";
  const now = new Date().toISOString();
  const base = {
    monthlyPlanId: input.monthlyPlanId, matrixVersionId: input.matrixVersionId, matrixItemId: input.matrixItemId,
    taskId: input.taskId, taskVersion: input.taskVersion, retrievalRunId: input.retrievalRun.retrievalRunId,
    indexSnapshotIds: input.retrievalRun.indexSnapshotIds, routeId: input.route.routeId, routeVersion: input.route.routeVersion,
    retrievalPolicyVersion: input.retrievalRun.retrievalPolicyVersion, embeddingProvider: input.embeddingProvider || "pending_config",
    embeddingModel: input.embeddingModel || "pending_config", rulePackageVersionId: input.rulePackageVersionId,
    taskSnapshot: input.taskSnapshot, governanceSnapshot: input.governanceSnapshot,
    retrievalSnapshot: { request: input.request, selectedChunkIds: input.retrievalRun.selectedChunkIds, candidates: input.retrievalRun.candidates.map((candidate) => ({ chunkId: candidate.chunk.chunkId, channels: candidate.channels, rawScores: candidate.rawScores, rrfScore: candidate.rrfScore, rerankScore: candidate.rerankScore, selected: candidate.selected, exclusionReasons: candidate.exclusionReasons, selectionReasons: candidate.selectionReasons })) },
    claimPlan, evidenceGroups: Object.fromEntries(input.route.requiredEvidenceRoles.map((role) => [role, items.filter((item) => item.allowedUsage.includes(role))])),
    evidenceItems: items, gaps: missingSlots, conflicts, outdatedEvidence, unverifiedClaims: claimPlan.forbiddenClaimIds,
    decision, sourceSnapshotHash: input.sourceSnapshotHash, supersedesPackId: input.supersedesPackId, immutableAt: now, createdAt: now
  };
  return { evidencePackId: `pack-${randomUUID()}`, packVersion: 1, ...base, snapshotHash: hash(base) };
}

export function assertFinalEvidencePackUsable(pack: RagFinalEvidencePack, expected: { taskId: string; taskVersion: number; rulePackageVersionId: string; activeIndexSnapshotIds: string[] }) {
  const issues: string[] = [];
  if (!(["generatable", "generatable_with_downgrade"] as string[]).includes(pack.decision)) issues.push(`decision=${pack.decision}`);
  if (pack.invalidatedAt) issues.push("pack_invalidated");
  if (pack.taskId !== expected.taskId || pack.taskVersion !== expected.taskVersion) issues.push("task_snapshot_mismatch");
  if (pack.rulePackageVersionId !== expected.rulePackageVersionId) issues.push("rule_package_mismatch");
  if (!pack.indexSnapshotIds.length) issues.push("index_snapshot_missing");
  if (pack.indexSnapshotIds.some((id) => !expected.activeIndexSnapshotIds.includes(id))) issues.push("index_snapshot_inactive");
  if (!pack.immutableAt || !pack.snapshotHash) issues.push("immutable_snapshot_missing");
  if (issues.length) throw new Error(`Final EvidencePack 不可用于正式生成：${issues.join(", ")}`);
}
