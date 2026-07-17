import { createHash, randomUUID } from "node:crypto";
import { callEmbeddingProvider } from "@/lib/embedding-provider";
import type { KnowledgeEmbeddingModelProvider } from "@/lib/types";
import type { V5GovernanceActor } from "../knowledge-governance-repository";
import { RAG_NAMESPACES, type RagEvaluationSummary, type RagIndexSnapshot, type RagIngestionManifest, type RagNamespace, type RagRetrievalRequest } from "./contracts";
import { getRagInfrastructureStatus } from "./infrastructure";
import { HttpRagOpenSearchAdapter, buildRagIndexName } from "./opensearch-adapter";
import { createRagIndexSnapshotRecord, createRagManifestRecord, readActiveRagIndexSnapshotRecord, readRagIndexSnapshotRecord, readRagManifestRecord, readRagMatrixItemContextRecord, readRagRetrievalRunRecord, transitionRagIndexSnapshotRecord, validateRagManifestGovernanceRecord, writeEvidencePreviewRecord, writeFinalEvidencePackRecord, writeRagRetrievalRunRecord } from "./rag-repository";
import { getRagRetrievalRoute } from "./retrieval-route-registry";
import { inferEvidenceRoles, runHybridRetrieval } from "./retrieval-service";
import { assertRagIndexTransition } from "./state-machines";
import { buildEvidencePreview, buildFinalEvidencePack } from "./evidence-services";

export class RagServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly nextAction?: string, public readonly details?: string[]) { super(message); this.name = "RagServiceError"; }
}
function required(value: string, field: string) { if (!value.trim()) throw new RagServiceError(400, "invalid_contract", `缺少 ${field}。`, `补充 ${field} 后重试。`); }
function actor(actor: V5GovernanceActor) { required(actor.actorId, "actorId"); required(actor.actorRole, "actorRole"); required(actor.auditReason, "auditReason"); }
function human(actor: V5GovernanceActor) { actor && actor.actorType === "human" || (() => { throw new RagServiceError(403, "human_approval_required", "该操作必须由人工角色完成。", "由治理负责人执行并填写审计原因。") })(); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function createRagManifest(input: Omit<RagIngestionManifest, "manifestId" | "manifestHash" | "generatedAt"> & { actor: V5GovernanceActor }) {
  actor(input.actor); human(input.actor);
  if (input.status === "approved" && (!input.approvedBy || !input.approvedAt)) throw new RagServiceError(409, "approval_required", "approved Manifest 必须包含人工批准记录。");
  if (input.status === "approved" && input.approvedBy !== input.actor.actorId) throw new RagServiceError(409, "approval_actor_mismatch", "approvedBy 必须与当前人工操作者一致。" );
  if (input.status === "approved" && input.unresolvedConflictIds.length) throw new RagServiceError(409, "unresolved_conflicts", "存在未裁决冲突的 Manifest 不能批准。", "先完成冲突裁决，或将相关 Claim 放入 blockedClaimIds。" );
  if (!input.approvedSourceRevisionIds.length || !input.approvedClaimIds.length) throw new RagServiceError(422, "manifest_empty", "Manifest 缺少已批准 SourceRevision 或 Claim。", "先完成第二阶段知识治理与人工确认。" );
  if (!input.knowledgeBaseIds.length) throw new RagServiceError(422, "manifest_empty", "Manifest 缺少已确认知识库。", "先绑定产品知识库并完成人工确认。" );
  required(input.productId, "productId"); required(input.activeRulePackageVersionId, "activeRulePackageVersionId"); required(input.authorityPolicyVersion, "authorityPolicyVersion"); required(input.monthlyProductionReadinessId, "monthlyProductionReadinessId"); required(input.matrixScopeVersion, "matrixScopeVersion");
  const base = { ...input, actor: undefined };
  const manifest: RagIngestionManifest = { ...input, manifestId: `manifest-${randomUUID()}`, manifestHash: hash(base), generatedAt: new Date().toISOString() };
  if (input.status === "approved") await validateRagManifestGovernanceRecord(manifest);
  return createRagManifestRecord(manifest, input.actor);
}

export async function createRagIndexSnapshot(input: { manifestId: string; namespace: RagNamespace; language: string; indexVersion: string; chunkSchemaVersion: string; chunkerVersion: string; retrievalPolicyVersion: string; actor: V5GovernanceActor }) {
  actor(input.actor);
  required(input.manifestId, "manifestId"); required(input.language, "language"); required(input.indexVersion, "indexVersion");
  required(input.chunkSchemaVersion, "chunkSchemaVersion"); required(input.chunkerVersion, "chunkerVersion"); required(input.retrievalPolicyVersion, "retrievalPolicyVersion");
  if (!(RAG_NAMESPACES as readonly string[]).includes(input.namespace)) throw new RagServiceError(400, "invalid_namespace", "RAG namespace 不在允许列表中。" );
  const manifest = await readRagManifestRecord(input.manifestId); if (!manifest) throw new RagServiceError(404, "manifest_not_found", "RAG Manifest 不存在。");
  if (input.namespace.startsWith("production") && manifest.status !== "approved") throw new RagServiceError(409, "manifest_not_approved", "未批准 Manifest 不能构建生产索引。" );
  const infra = getRagInfrastructureStatus(); const indexName = buildRagIndexName(input.namespace, manifest.productId, input.language, input.indexVersion);
  const snapshot: RagIndexSnapshot = { indexSnapshotId: `index-${randomUUID()}`, manifestId: input.manifestId, namespace: input.namespace, productId: manifest.productId, language: input.language, indexVersion: input.indexVersion, indexName, indexAlias: buildRagIndexName(input.namespace, manifest.productId, input.language, "active"), status: infra.status === "ready" ? "building" : "pending_config", chunkSchemaVersion: input.chunkSchemaVersion, chunkerVersion: input.chunkerVersion, retrievalPolicyVersion: input.retrievalPolicyVersion, embeddingProvider: infra.embedding.provider, embeddingModel: infra.embedding.model, documentCount: 0, manifestHash: manifest.manifestHash, createdAt: new Date().toISOString() };
  return { ...(await createRagIndexSnapshotRecord(snapshot, input.actor)), infrastructure: infra };
}

export async function validateRagIndexSnapshot(id: string, summary: RagEvaluationSummary, actorInput: V5GovernanceActor) {
  actor(actorInput); const snapshot = await readRagIndexSnapshotRecord(id); if (!snapshot) throw new RagServiceError(404, "index_not_found", "IndexSnapshot 不存在。");
  assertRagIndexTransition(snapshot.status, summary.passed ? "ready" : "building");
  return transitionRagIndexSnapshotRecord({ id, from: snapshot.status, to: summary.passed ? "ready" : "building", validationSummary: summary, actor: actorInput, action: "validate" });
}

export async function activateRagIndexSnapshot(id: string, actorInput: V5GovernanceActor, previousActiveId?: string) {
  actor(actorInput); human(actorInput); const snapshot = await readRagIndexSnapshotRecord(id); if (!snapshot) throw new RagServiceError(404, "index_not_found", "IndexSnapshot 不存在。");
  if (!snapshot.validationSummary?.passed) throw new RagServiceError(409, "evaluation_failed", "评测未达标的 IndexSnapshot 不能激活。", "修复阻断指标并重新验证。", snapshot.validationSummary?.blockers);
  assertRagIndexTransition(snapshot.status, "active");
  const previous = await readActiveRagIndexSnapshotRecord({ productId: snapshot.productId, namespace: snapshot.namespace, language: snapshot.language });
  if (previousActiveId && previous?.indexSnapshotId !== previousActiveId) throw new RagServiceError(409, "active_snapshot_changed", "当前 active Snapshot 已变化，请刷新后重试。" );
  await new HttpRagOpenSearchAdapter().activateAlias(snapshot.indexAlias, snapshot.indexName, previous?.indexName);
  return transitionRagIndexSnapshotRecord({ id, from: snapshot.status, to: "active", previousActiveId: previous?.indexSnapshotId, actor: actorInput, action: "activate" });
}

export async function rollbackRagIndexSnapshot(currentId: string, targetId: string, actorInput: V5GovernanceActor) {
  actor(actorInput); human(actorInput);
  const [current, target] = await Promise.all([readRagIndexSnapshotRecord(currentId), readRagIndexSnapshotRecord(targetId)]);
  if (!current || !target) throw new RagServiceError(404, "index_not_found", "当前或目标 IndexSnapshot 不存在。");
  if (current.status !== "active") throw new RagServiceError(409, "active_index_required", "回滚起点必须是当前 active Snapshot。");
  if (!["superseded", "rollback_target"].includes(target.status)) throw new RagServiceError(409, "rollback_target_invalid", "回滚目标必须是已冻结的历史 Snapshot。");
  if (!target.validationSummary?.passed) throw new RagServiceError(409, "evaluation_failed", "回滚目标的历史评测未达标。");
  if (current.productId !== target.productId || current.namespace !== target.namespace || current.language !== target.language) {
    throw new RagServiceError(400, "rollback_partition_mismatch", "回滚目标不属于同一产品、命名空间和语言分区。");
  }
  if (target.status === "superseded") {
    assertRagIndexTransition("superseded", "rollback_target");
    await transitionRagIndexSnapshotRecord({ id: targetId, from: "superseded", to: "rollback_target", actor: actorInput, action: "mark_rollback_target" });
  }
  await new HttpRagOpenSearchAdapter().activateAlias(target.indexAlias, target.indexName, current.indexName);
  return transitionRagIndexSnapshotRecord({ id: targetId, from: "rollback_target", to: "active", previousActiveId: currentId, actor: actorInput, action: "rollback" });
}

export async function retrieveRag(input: { request: RagRetrievalRequest; indexSnapshotId: string; actor: V5GovernanceActor }) {
  actor(input.actor);
  const route = getRagRetrievalRoute(input.request.platformContentType);
  if (!route) throw new RagServiceError(400, "retrieval_route_not_found", "平台内容类型没有已登记 RetrievalRoute。" );
  const matrix = await readRagMatrixItemContextRecord(input.request.matrixItemId);
  if (!matrix) throw new RagServiceError(404, "matrix_item_not_found", "检索请求绑定的矩阵项不存在。" );
  const matrixMatches = input.request.productId === matrix.productId
    && input.request.title === matrix.title
    && input.request.channel === matrix.channel
    && input.request.contentType === matrix.contentType
    && input.request.platformContentType === matrix.platformContentType
    && input.request.rulePackageVersionId === matrix.rulePackageVersionId
    && (!input.request.taskId || input.request.taskId === matrix.matrixItemId)
    && (!input.request.taskVersion || input.request.taskVersion === matrix.currentTaskVersion);
  if (!matrixMatches) throw new RagServiceError(409, "matrix_snapshot_mismatch", "检索请求必须使用当前矩阵项冻结的产品、标题、渠道、内容类型和规则包。" );
  const snapshot = await readRagIndexSnapshotRecord(input.indexSnapshotId); if (!snapshot || snapshot.status !== "active") throw new RagServiceError(409, "active_index_required", "正式检索必须使用 active IndexSnapshot。" );
  if (snapshot.productId !== matrix.productId || snapshot.namespace !== input.request.namespace) throw new RagServiceError(400, "index_partition_mismatch", "检索请求与索引产品或命名空间不一致。" );
  const manifest = await readRagManifestRecord(snapshot.manifestId);
  if (!manifest || manifest.status !== "approved" || manifest.activeRulePackageVersionId !== matrix.rulePackageVersionId || manifest.manifestHash !== snapshot.manifestHash) {
    throw new RagServiceError(409, "manifest_snapshot_mismatch", "active Snapshot 的 Manifest 与当前矩阵规则包不一致。" );
  }
  const governanceRoles = new Set(["knowledge_manager", "product_owner", "security_owner", "privacy_owner", "legal_owner", "developer_admin", "rag_operator"]);
  const allowedPermissions = snapshot.namespace === "production_public" ? ["public"]
    : snapshot.namespace === "production_internal" ? ["public", "internal"]
    : governanceRoles.has(input.actor.actorRole) ? ["public", "internal", "restricted_customer", "confidential"] : [];
  if (!allowedPermissions.length) throw new RagServiceError(403, "namespace_access_denied", "当前角色无权访问该 RAG namespace。" );
  const lifecycleStatuses: RagRetrievalRequest["lifecycleStatuses"] = input.request.platformContentType === "explicit_launch_matrix"
    ? ["current", "beta", "planned", "unknown"]
    : ["current", "unknown"];
  const effectiveRequest: RagRetrievalRequest = {
    ...input.request,
    productId: matrix.productId,
    productName: matrix.productName,
    title: matrix.title,
    channel: matrix.channel,
    contentType: matrix.contentType,
    platformContentType: matrix.platformContentType as RagRetrievalRequest["platformContentType"],
    targetAudience: matrix.targetAudience,
    sourceProblem: matrix.sourceProblem,
    distilledTermIds: [matrix.primaryDistilledTermId, ...matrix.secondaryDistilledTermIds].filter(Boolean),
    rulePackageVersionId: matrix.rulePackageVersionId,
    permissionScope: allowedPermissions as RagRetrievalRequest["permissionScope"],
    lifecycleStatuses,
    requestedAt: new Date().toISOString()
  };
  const infra = getRagInfrastructureStatus(); if (infra.status !== "ready") throw new RagServiceError(503, "pending_config", "RAG 基础设施尚未完整配置。", "补齐 MySQL、OpenSearch 与真实 Embedding 配置。", [...infra.mysql.missingConfig, ...infra.opensearch.missingConfig, ...infra.embedding.missingConfig]);
  const provider = infra.embedding.provider as KnowledgeEmbeddingModelProvider; const embedding = await callEmbeddingProvider({ provider, input: `${effectiveRequest.title}\n${effectiveRequest.sourceProblem}` });
  if (!embedding.ok || !embedding.vectors?.[0]) throw new RagServiceError(embedding.status === "pending_config" ? 503 : 502, embedding.status, "真实 Embedding 调用失败。", embedding.status === "pending_config" ? "补齐 Embedding Provider 配置。" : "检查 Provider 状态后重试。", embedding.missingConfig || [embedding.errorMessage || "unknown"]);
  const adapter = new HttpRagOpenSearchAdapter();
  const [bm25, vector, relation, requiredHits] = await Promise.all([
    adapter.keywordSearch(snapshot.indexName, effectiveRequest, route.candidateLimits.bm25, route.forbiddenSupportModes),
    adapter.vectorSearch(snapshot.indexName, effectiveRequest, embedding.vectors[0], route.candidateLimits.vector, route.forbiddenSupportModes),
    adapter.relationSearch(snapshot.indexName, effectiveRequest, route.candidateLimits.relation, route.forbiddenSupportModes),
    adapter.requiredEvidenceSearch(snapshot.indexName, effectiveRequest, route.requiredSemanticTypes, route.candidateLimits.required, route.forbiddenSupportModes)
  ]);
  const required = requiredHits.map((hit) => ({ ...hit, evidenceRoles: inferEvidenceRoles(hit.chunk) }));
  const run = runHybridRetrieval({ request: effectiveRequest, route, indexSnapshotIds: [snapshot.indexSnapshotId], retrievalPolicyVersion: snapshot.retrievalPolicyVersion, pools: { bm25, vector, relation, required } });
  return writeRagRetrievalRunRecord({ ...effectiveRequest, requestHash: hash(effectiveRequest) }, run, input.actor.actorId);
}

export async function createEvidencePreview(input: { retrievalRunId: string; actor: V5GovernanceActor }) {
  actor(input.actor);
  const stored = await readRagRetrievalRunRecord(input.retrievalRunId);
  if (!stored) throw new RagServiceError(404, "retrieval_run_not_found", "RetrievalRun 不存在。" );
  const matrix = await readRagMatrixItemContextRecord(stored.request.matrixItemId);
  if (!matrix) throw new RagServiceError(404, "matrix_item_not_found", "RetrievalRun 绑定的矩阵项不存在。" );
  const snapshots = await Promise.all(stored.run.indexSnapshotIds.map(readRagIndexSnapshotRecord));
  if (!snapshots.length || snapshots.some((snapshot) => !snapshot || snapshot.status !== "active")) throw new RagServiceError(409, "active_index_required", "EvidencePreview 必须来自当前 active Snapshot。" );
  const sourceSnapshotHash = hash(snapshots.map((snapshot) => ({ id: snapshot!.indexSnapshotId, manifestHash: snapshot!.manifestHash })));
  const preview = buildEvidencePreview({ matrixItemId: matrix.matrixItemId, matrixVersionId: matrix.matrixVersionId, retrievalRun: stored.run, sourceSnapshotHash, infrastructure: getRagInfrastructureStatus() });
  return writeEvidencePreviewRecord(preview, input.actor);
}

export async function createFinalEvidencePack(input: { retrievalRunId: string; actor: V5GovernanceActor }) {
  actor(input.actor); human(input.actor);
  const stored = await readRagRetrievalRunRecord(input.retrievalRunId);
  if (!stored) throw new RagServiceError(404, "retrieval_run_not_found", "RetrievalRun 不存在。" );
  const matrix = await readRagMatrixItemContextRecord(stored.request.matrixItemId);
  if (!matrix) throw new RagServiceError(404, "matrix_item_not_found", "RetrievalRun 绑定的矩阵项不存在。" );
  if (matrix.matrixStatus !== "approved" || matrix.itemStatus !== "approved" || !matrix.matrixApprovedBy || !matrix.matrixApprovedAt) {
    throw new RagServiceError(409, "matrix_not_approved", "只有人工批准后的矩阵项才能冻结 Final EvidencePack。" );
  }
  if (!matrix.monthlyProductionReady || matrix.readinessStatus !== "approved" || matrix.ruleStatus !== "active" || !matrix.ruleImmutableAt) {
    throw new RagServiceError(409, "governance_not_ready", "矩阵项的规则包或 G6 月度生产准入已失效。" );
  }
  const requestMatches = stored.request.productId === matrix.productId
    && stored.request.matrixItemId === matrix.matrixItemId
    && stored.request.title === matrix.title
    && stored.request.channel === matrix.channel
    && stored.request.contentType === matrix.contentType
    && stored.request.platformContentType === matrix.platformContentType
    && stored.request.rulePackageVersionId === matrix.rulePackageVersionId
    && (!stored.request.taskId || stored.request.taskId === matrix.matrixItemId)
    && (!stored.request.taskVersion || stored.request.taskVersion === matrix.currentTaskVersion);
  if (!requestMatches) throw new RagServiceError(409, "frozen_snapshot_mismatch", "RetrievalRun 与当前批准矩阵项不一致，必须按最终标题重新检索。" );
  if (stored.run.indexSnapshotIds.length !== 1) throw new RagServiceError(409, "single_active_snapshot_required", "当前正式 Pack 只允许绑定一个产品分区的 active Snapshot。" );
  const snapshot = await readRagIndexSnapshotRecord(stored.run.indexSnapshotIds[0]);
  if (!snapshot || snapshot.status !== "active") throw new RagServiceError(409, "active_index_required", "Final EvidencePack 必须绑定 active Snapshot。" );
  const manifest = await readRagManifestRecord(snapshot.manifestId);
  if (!manifest || manifest.status !== "approved" || manifest.productId !== matrix.productId || manifest.activeRulePackageVersionId !== matrix.rulePackageVersionId) {
    throw new RagServiceError(409, "manifest_snapshot_mismatch", "active Snapshot 的 Manifest 与批准矩阵项不一致。" );
  }
  if (![matrix.matrixVersionId, String(matrix.matrixVersionNumber)].includes(manifest.matrixScopeVersion)) {
    throw new RagServiceError(409, "matrix_scope_mismatch", "Manifest 不覆盖当前批准矩阵版本。" );
  }
  const route = getRagRetrievalRoute(stored.request.platformContentType);
  if (!route) throw new RagServiceError(400, "retrieval_route_not_found", "平台内容类型没有已登记 RetrievalRoute。" );
  const nextTaskVersion = matrix.currentTaskVersion + 1;
  const rawChannelRule = matrix.platformExpressionSnapshot.channelRuleSnapshot || matrix.platformExpressionSnapshot.channelRule;
  const channelRuleSnapshot = rawChannelRule && typeof rawChannelRule === "object" && !Array.isArray(rawChannelRule)
    ? rawChannelRule as Record<string, unknown>
    : undefined;
  if (!channelRuleSnapshot
    || String(channelRuleSnapshot.channelRuleVersionId || "") !== matrix.channelRuleVersionId
    || String(channelRuleSnapshot.channel || "") !== matrix.channel
    || !Array.isArray(channelRuleSnapshot.requiredFormat)
    || !Array.isArray(channelRuleSnapshot.prohibitedPatterns)
    || !String(channelRuleSnapshot.ctaBoundary || "").trim()) {
    throw new RagServiceError(409, "channel_rule_snapshot_missing", "批准矩阵项缺少匹配的 ChannelRule 不可变快照。", "重新生成平台表达快照并完成矩阵人工批准。" );
  }
  const taskSnapshot = {
    monthlyPlanId: matrix.monthlyPlanId, strategyPackageVersionId: matrix.strategyPackageVersionId, matrixVersionId: matrix.matrixVersionId,
    matrixItemId: matrix.matrixItemId, taskId: matrix.matrixItemId, taskVersion: nextTaskVersion, productId: matrix.productId, productName: matrix.productName,
    channel: matrix.channel, contentType: matrix.contentType, platformContentType: matrix.platformContentType, title: matrix.title,
    targetAudience: matrix.targetAudience, sourceProblem: matrix.sourceProblem, primaryDistilledTermId: matrix.primaryDistilledTermId,
    secondaryDistilledTermIds: matrix.secondaryDistilledTermIds, knowledgeBaseIds: matrix.knowledgeBaseIds,
    rulePackageVersionId: matrix.rulePackageVersionId, promptGroupId: matrix.promptGroupId, promptGroupVersionId: matrix.promptGroupVersionId,
    channelRuleVersionId: matrix.channelRuleVersionId, channelRuleSnapshot, confirmedBy: matrix.matrixApprovedBy, confirmedAt: matrix.matrixApprovedAt
  };
  const governanceSnapshot = {
    manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, monthlyProductionReadinessId: matrix.readinessId,
    rulePackageVersionId: matrix.rulePackageVersionId, sourceSnapshotHash: matrix.sourceSnapshotHash,
    indexSnapshotId: snapshot.indexSnapshotId, indexVersion: snapshot.indexVersion, chunkSchemaVersion: snapshot.chunkSchemaVersion,
    chunkerVersion: snapshot.chunkerVersion, retrievalPolicyVersion: snapshot.retrievalPolicyVersion
  };
  const pack = buildFinalEvidencePack({
    monthlyPlanId: matrix.monthlyPlanId, matrixVersionId: matrix.matrixVersionId, matrixItemId: matrix.matrixItemId,
    taskId: matrix.matrixItemId, taskVersion: nextTaskVersion, request: stored.request, route, retrievalRun: stored.run,
    rulePackageVersionId: matrix.rulePackageVersionId, sourceSnapshotHash: matrix.sourceSnapshotHash || manifest.manifestHash,
    embeddingProvider: snapshot.embeddingProvider, embeddingModel: snapshot.embeddingModel, taskSnapshot, governanceSnapshot,
    infrastructure: getRagInfrastructureStatus()
  });
  return writeFinalEvidencePackRecord(pack, input.actor);
}
