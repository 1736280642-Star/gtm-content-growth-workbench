import type { V5GovernanceActor } from "../knowledge-governance-repository";
import { AUTOMATIC_KNOWLEDGE_POLICY_VERSION } from "./automatic-knowledge-production";
import { prepareAutomaticKnowledgeRefreshRecord } from "./knowledge-refresh-repository";
import { createRagIndexSnapshot, createRagManifest } from "./rag-service";

export async function runAutomaticKnowledgeRefresh(input: {
  productId: string;
  actor: V5GovernanceActor;
}) {
  const context = await prepareAutomaticKnowledgeRefreshRecord(input.productId, input.actor);
  const manifestResult = await createRagManifest({
    productId: context.productId,
    knowledgeBaseIds: context.knowledgeBaseIds,
    activeRulePackageVersionId: context.rulePackageVersionId,
    approvedSourceRevisionIds: context.approvedSourceRevisionIds,
    approvedClaimIds: context.approvedClaimIds,
    blockedClaimIds: context.blockedClaimIds,
    unresolvedConflictIds: [],
    authorityPolicyVersion: AUTOMATIC_KNOWLEDGE_POLICY_VERSION,
    monthlyProductionReadinessId: context.readinessId,
    matrixScopeVersion: context.matrixScopeVersion,
    status: "approved",
    approvedBy: input.actor.actorId,
    approvedAt: context.approvedAt,
    actor: input.actor
  });
  const manifest = manifestResult.manifest;
  const indexResult = await createRagIndexSnapshot({
    manifestId: manifest.manifestId,
    namespace: "production_public",
    language: "zh-CN",
    indexVersion: `auto-${context.sourceSnapshotHash.slice(0, 20)}`,
    chunkSchemaVersion: "claim-aware@1",
    chunkerVersion: "automatic-knowledge@1",
    retrievalPolicyVersion: "v5-hybrid@1",
    actor: input.actor
  });
  return { context, manifest: manifestResult, index: indexResult };
}
