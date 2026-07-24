import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "../knowledge-governance-repository";
import type { RagEvidencePreview, RagFinalEvidencePack, RagIndexSnapshot, RagIngestionManifest, RagRetrievalRequest, RagRetrievalRun } from "./contracts";

function date(value: unknown) { return value instanceof Date ? value.toISOString() : value ? String(value) : undefined; }

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export async function validateRagManifestGovernanceRecord(manifest: RagIngestionManifest) {
  const pool = getV5GovernancePool();
  const approvedRevisionIds = unique(manifest.approvedSourceRevisionIds);
  const approvedClaimIds = unique(manifest.approvedClaimIds);
  const blockedClaimIds = unique(manifest.blockedClaimIds);
  if (approvedRevisionIds.length !== manifest.approvedSourceRevisionIds.length || approvedClaimIds.length !== manifest.approvedClaimIds.length || blockedClaimIds.length !== manifest.blockedClaimIds.length) {
    throw new V5GovernanceRepositoryError("manifest_duplicate_ids", "Manifest 中存在重复 SourceRevision 或 Claim ID。", 400);
  }
  if (approvedClaimIds.some((id) => blockedClaimIds.includes(id))) {
    throw new V5GovernanceRepositoryError("manifest_claim_overlap", "同一 Claim 不能同时进入 approvedClaimIds 与 blockedClaimIds。", 400);
  }
  const [productRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM product_entity WHERE id = ? AND status = 'active' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL LIMIT 1",
    [manifest.productId]
  );
  if (!productRows[0]) throw new V5GovernanceRepositoryError("product_entity_not_confirmed", "Manifest 产品实体不存在或缺少人工确认。", 409);

  const [knowledgeBaseRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM knowledge_base WHERE id IN (?) AND status = 'active'",
    [unique(manifest.knowledgeBaseIds)]
  );
  if (knowledgeBaseRows.length !== unique(manifest.knowledgeBaseIds).length) {
    throw new V5GovernanceRepositoryError("knowledge_base_not_ready", "Manifest 包含不存在或未激活的知识库。", 409);
  }
  const [linkRows] = await pool.query<RowDataPacket[]>(
    `SELECT knowledge_base_id FROM knowledge_base_product_link
     WHERE knowledge_base_id IN (?) AND product_id = ? AND relation_type = 'supporting' AND status = 'active'
       AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL`,
    [unique(manifest.knowledgeBaseIds), manifest.productId]
  );
  if (linkRows.length !== unique(manifest.knowledgeBaseIds).length) {
    throw new V5GovernanceRepositoryError("knowledge_base_product_link_not_confirmed", "Manifest 知识库与产品缺少完整人工确认关联。", 409);
  }

  const [ruleRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, product_id, status, source_snapshot_hash FROM rule_package_version
     WHERE id = ? AND product_id = ? AND status = 'active' AND immutable_at IS NOT NULL LIMIT 1`,
    [manifest.activeRulePackageVersionId, manifest.productId]
  );
  const rule = ruleRows[0];
  if (!rule) throw new V5GovernanceRepositoryError("active_rule_package_required", "Manifest 必须绑定同产品的 active 不可变规则包。", 409);

  const [readinessRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM monthly_production_readiness
     WHERE id = ? AND product_id = ? AND rule_package_version_id = ? AND monthly_production_ready = TRUE
       AND status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL LIMIT 1`,
    [manifest.monthlyProductionReadinessId, manifest.productId, manifest.activeRulePackageVersionId]
  );
  const readiness = readinessRows[0];
  if (!readiness) throw new V5GovernanceRepositoryError("monthly_readiness_required", "Manifest 未通过 G6 月度生产准入。", 409);
  if (readiness.source_snapshot_hash && String(readiness.source_snapshot_hash) !== String(rule.source_snapshot_hash)) {
    throw new V5GovernanceRepositoryError("readiness_snapshot_mismatch", "G6 准入快照与 active 规则包快照不一致。", 409);
  }

  const [revisionRows] = await pool.query<RowDataPacket[]>(
    `SELECT sr.id, sr.source_id, sr.parse_status, sa.primary_knowledge_base_id, sa.product_candidates, sa.status, sa.safety_status
     FROM source_revision sr JOIN source_asset sa ON sa.id = sr.source_id WHERE sr.id IN (?)`,
    [approvedRevisionIds]
  );
  if (revisionRows.length !== approvedRevisionIds.length) {
    throw new V5GovernanceRepositoryError("source_revision_missing", "Manifest 中存在无法读取的 SourceRevision。", 409);
  }
  for (const revision of revisionRows) {
    const productCandidates = parseV5Json<string[]>(revision.product_candidates, []);
    if (String(revision.parse_status) !== "parsed"
      || String(revision.status) !== "approved_for_claim_extraction"
      || !["passed", "restricted_approved"].includes(String(revision.safety_status))
      || !manifest.knowledgeBaseIds.includes(String(revision.primary_knowledge_base_id))
      || !productCandidates.includes(manifest.productId)) {
      throw new V5GovernanceRepositoryError("source_revision_not_approved", `SourceRevision ${revision.id} 未通过产品、解析、安全或人工分类准入。`, 409);
    }
  }

  const [claimRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, product_id, source_revision_id, review_status, conflict_group_id
     FROM product_claim WHERE id IN (?)`,
    [approvedClaimIds]
  );
  if (claimRows.length !== approvedClaimIds.length) {
    throw new V5GovernanceRepositoryError("approved_claim_missing", "Manifest 中存在无法读取的 approved Claim。", 409);
  }
  for (const claim of claimRows) {
    if (String(claim.product_id) !== manifest.productId
      || !approvedRevisionIds.includes(String(claim.source_revision_id))
      || !["supported", "conditional"].includes(String(claim.review_status))
      || (claim.conflict_group_id && manifest.unresolvedConflictIds.includes(String(claim.conflict_group_id)))) {
      throw new V5GovernanceRepositoryError("claim_not_approved", `Claim ${claim.id} 未通过产品、修订、人工评审或冲突准入。`, 409);
    }
  }
  if (blockedClaimIds.length) {
    const [blockedRows] = await pool.query<RowDataPacket[]>("SELECT id, product_id FROM product_claim WHERE id IN (?)", [blockedClaimIds]);
    if (blockedRows.length !== blockedClaimIds.length || blockedRows.some((row) => String(row.product_id) !== manifest.productId)) {
      throw new V5GovernanceRepositoryError("blocked_claim_invalid", "blockedClaimIds 包含不存在或跨产品 Claim。", 409);
    }
  }

  const [ruleClaimRows] = await pool.query<RowDataPacket[]>(
    "SELECT claim_id FROM rule_package_claim WHERE rule_package_version_id = ? AND claim_id IN (?)",
    [manifest.activeRulePackageVersionId, approvedClaimIds]
  );
  if (ruleClaimRows.length !== approvedClaimIds.length) {
    throw new V5GovernanceRepositoryError("rule_claim_mismatch", "approved Claim 未完整绑定到 active 规则包。", 409);
  }
  const [ruleRevisionRows] = await pool.query<RowDataPacket[]>(
    "SELECT source_revision_id FROM rule_package_source_revision WHERE rule_package_version_id = ? AND source_revision_id IN (?)",
    [manifest.activeRulePackageVersionId, approvedRevisionIds]
  );
  if (ruleRevisionRows.length !== approvedRevisionIds.length) {
    throw new V5GovernanceRepositoryError("rule_revision_mismatch", "approved SourceRevision 未完整绑定到 active 规则包。", 409);
  }
  return { sourceRevisionCount: approvedRevisionIds.length, approvedClaimCount: approvedClaimIds.length, blockedClaimCount: blockedClaimIds.length };
}

export async function createRagManifestRecord(manifest: RagIngestionManifest, actor: V5GovernanceActor) {
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>("SELECT * FROM rag_ingestion_manifest WHERE manifest_hash = ? LIMIT 1", [manifest.manifestHash]);
    if (existing[0]) return { replayed: true, manifest: mapManifest(existing[0]) };
    await connection.query(
      `INSERT INTO rag_ingestion_manifest
       (id, product_id, knowledge_base_ids, active_rule_package_version_id, approved_source_revision_ids, approved_claim_ids, blocked_claim_ids,
        unresolved_conflict_ids, authority_policy_version, monthly_production_readiness_id, matrix_scope_version, manifest_hash, status, generated_by,
        generated_at, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [manifest.manifestId, manifest.productId, stringifyV5Json(manifest.knowledgeBaseIds), manifest.activeRulePackageVersionId,
        stringifyV5Json(manifest.approvedSourceRevisionIds), stringifyV5Json(manifest.approvedClaimIds), stringifyV5Json(manifest.blockedClaimIds),
        stringifyV5Json(manifest.unresolvedConflictIds), manifest.authorityPolicyVersion, manifest.monthlyProductionReadinessId,
        manifest.matrixScopeVersion, manifest.manifestHash, manifest.status, actor.actorId, new Date(manifest.generatedAt),
        manifest.approvedBy || null, manifest.approvedAt ? new Date(manifest.approvedAt) : null]
    );
    await writeV5GovernanceAudit(connection, { ...actor, eventType: "rag_manifest_created", objectType: "rag_ingestion_manifest", objectId: manifest.manifestId, afterSummary: { productId: manifest.productId, status: manifest.status, manifestHash: manifest.manifestHash }, correlationId: manifest.manifestId });
    return { replayed: false, manifest };
  });
}

export async function readRagManifestRecord(id: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM rag_ingestion_manifest WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapManifest(rows[0]) : undefined;
}

function mapManifest(row: RowDataPacket): RagIngestionManifest {
  return { manifestId: String(row.id), productId: String(row.product_id), knowledgeBaseIds: parseV5Json(row.knowledge_base_ids, []), activeRulePackageVersionId: String(row.active_rule_package_version_id), approvedSourceRevisionIds: parseV5Json(row.approved_source_revision_ids, []), approvedClaimIds: parseV5Json(row.approved_claim_ids, []), blockedClaimIds: parseV5Json(row.blocked_claim_ids, []), unresolvedConflictIds: parseV5Json(row.unresolved_conflict_ids, []), authorityPolicyVersion: String(row.authority_policy_version), monthlyProductionReadinessId: String(row.monthly_production_readiness_id), matrixScopeVersion: String(row.matrix_scope_version), manifestHash: String(row.manifest_hash), status: String(row.status) as RagIngestionManifest["status"], generatedAt: date(row.generated_at) || "", approvedBy: row.approved_by ? String(row.approved_by) : undefined, approvedAt: date(row.approved_at) };
}

export async function createRagIndexSnapshotRecord(snapshot: RagIndexSnapshot, actor: V5GovernanceActor) {
  return withV5GovernanceTransaction(async (connection) => {
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM rag_index_snapshot
       WHERE namespace = ? AND product_id = ? AND language = ? AND index_version = ? FOR UPDATE`,
      [snapshot.namespace, snapshot.productId, snapshot.language, snapshot.indexVersion]
    );
    const existing = existingRows[0];
    let stored = snapshot;
    let resumed = false;
    if (existing) {
      stored = mapSnapshot(existing);
      const contractMatches = stored.manifestId === snapshot.manifestId
        && stored.manifestHash === snapshot.manifestHash
        && stored.chunkSchemaVersion === snapshot.chunkSchemaVersion
        && stored.chunkerVersion === snapshot.chunkerVersion
        && stored.retrievalPolicyVersion === snapshot.retrievalPolicyVersion;
      if (!contractMatches) throw new Error("同一索引分区版本已存在，但 Manifest 或构建版本不一致。请使用新的 indexVersion。" );
      if (stored.status === "pending_config" && snapshot.status === "building") {
        await connection.query(
          `UPDATE rag_index_snapshot SET status = 'building', embedding_provider = ?, embedding_model = ?, row_version = row_version + 1
           WHERE id = ? AND status = 'pending_config'`,
          [snapshot.embeddingProvider || null, snapshot.embeddingModel || null, stored.indexSnapshotId]
        );
        stored = { ...stored, status: "building", embeddingProvider: snapshot.embeddingProvider, embeddingModel: snapshot.embeddingModel };
        resumed = true;
      }
    } else {
      await connection.query(
        `INSERT INTO rag_index_snapshot
         (id, manifest_id, namespace, product_id, language, index_version, index_name, index_alias, status, chunk_schema_version, chunker_version,
          retrieval_policy_version, embedding_provider, embedding_model, embedding_dimensions, document_count, manifest_hash, validation_summary,
          immutable_at, activated_at, supersedes_snapshot_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [snapshot.indexSnapshotId, snapshot.manifestId, snapshot.namespace, snapshot.productId, snapshot.language, snapshot.indexVersion,
          snapshot.indexName, snapshot.indexAlias, snapshot.status, snapshot.chunkSchemaVersion, snapshot.chunkerVersion, snapshot.retrievalPolicyVersion,
          snapshot.embeddingProvider || null, snapshot.embeddingModel || null, snapshot.embeddingDimensions || null, snapshot.documentCount, snapshot.manifestHash,
          snapshot.validationSummary ? stringifyV5Json(snapshot.validationSummary) : null, snapshot.immutableAt ? new Date(snapshot.immutableAt) : null,
          snapshot.activatedAt ? new Date(snapshot.activatedAt) : null, snapshot.supersedesSnapshotId || null, actor.actorId, new Date(snapshot.createdAt)]
      );
    }

    let indexBuildJob: { replayed: boolean; jobId: string; status: string } | undefined;
    if (stored.status === "building") {
      const idempotencyKey = `rag-index-build:${stored.indexSnapshotId}:${stored.manifestHash}`;
      const [jobRows] = await connection.query<RowDataPacket[]>(
        "SELECT id, status FROM rag_index_job WHERE idempotency_key = ? FOR UPDATE",
        [idempotencyKey]
      );
      if (jobRows[0]) {
        const jobId = String(jobRows[0].id);
        const currentStatus = String(jobRows[0].status);
        if (currentStatus === "pending_config") {
          await connection.query(
            `UPDATE rag_index_job SET status = 'queued', available_at = NOW(), failure_code = NULL, failure_message = NULL,
             completed_at = NULL, row_version = row_version + 1 WHERE id = ? AND status = 'pending_config'`,
            [jobId]
          );
          indexBuildJob = { replayed: false, jobId, status: "queued" };
        } else {
          indexBuildJob = { replayed: true, jobId, status: currentStatus };
        }
      } else {
        const jobId = `rag-job-${randomUUID()}`;
        await connection.query(
          `INSERT INTO rag_index_job
           (id, job_type, index_snapshot_id, product_id, status, idempotency_key, payload, max_attempts, available_at, created_by)
           VALUES (?, 'index_build', ?, ?, 'queued', ?, ?, 3, NOW(), ?)`,
          [jobId, stored.indexSnapshotId, stored.productId, idempotencyKey, stringifyV5Json({ manifestId: stored.manifestId, indexName: stored.indexName }), actor.actorId]
        );
        indexBuildJob = { replayed: false, jobId, status: "queued" };
      }
    }
    await writeV5GovernanceAudit(connection, {
      ...actor,
      eventType: existing ? (resumed ? "rag_index_snapshot_resumed" : "rag_index_snapshot_reused") : "rag_index_snapshot_created",
      objectType: "rag_index_snapshot",
      objectId: stored.indexSnapshotId,
      afterSummary: { productId: stored.productId, namespace: stored.namespace, status: stored.status, indexBuildJob },
      correlationId: stored.indexSnapshotId
    });
    return { snapshot: stored, indexBuildJob, replayed: Boolean(existing) && !resumed, resumed };
  });
}

export async function readRagIndexSnapshotRecord(id: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM rag_index_snapshot WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapSnapshot(rows[0]) : undefined;
}

export async function readActiveRagIndexSnapshotRecord(input: { productId: string; namespace: RagIndexSnapshot["namespace"]; language: string }) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM rag_index_snapshot
     WHERE product_id = ? AND namespace = ? AND language = ? AND status = 'active'
     ORDER BY activated_at DESC LIMIT 1`,
    [input.productId, input.namespace, input.language]
  );
  return rows[0] ? mapSnapshot(rows[0]) : undefined;
}

function mapSnapshot(row: RowDataPacket): RagIndexSnapshot {
  return { indexSnapshotId: String(row.id), manifestId: String(row.manifest_id), namespace: String(row.namespace) as RagIndexSnapshot["namespace"], productId: String(row.product_id), language: String(row.language), indexVersion: String(row.index_version), indexName: String(row.index_name), indexAlias: String(row.index_alias), status: String(row.status) as RagIndexSnapshot["status"], chunkSchemaVersion: String(row.chunk_schema_version), chunkerVersion: String(row.chunker_version), retrievalPolicyVersion: String(row.retrieval_policy_version), embeddingProvider: row.embedding_provider ? String(row.embedding_provider) : undefined, embeddingModel: row.embedding_model ? String(row.embedding_model) : undefined, embeddingDimensions: row.embedding_dimensions === null ? undefined : Number(row.embedding_dimensions), documentCount: Number(row.document_count), manifestHash: String(row.manifest_hash), validationSummary: parseV5Json(row.validation_summary, undefined), immutableAt: date(row.immutable_at), activatedAt: date(row.activated_at), supersedesSnapshotId: row.supersedes_snapshot_id ? String(row.supersedes_snapshot_id) : undefined, createdAt: date(row.created_at) || "" };
}

export async function transitionRagIndexSnapshotRecord(input: { id: string; from: RagIndexSnapshot["status"]; to: RagIndexSnapshot["status"]; actor: V5GovernanceActor; validationSummary?: RagIndexSnapshot["validationSummary"]; previousActiveId?: string; action?: string }) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM rag_index_snapshot WHERE id = ? FOR UPDATE", [input.id]);
    if (!rows[0] || String(rows[0].status) !== input.from) throw new Error("IndexSnapshot 状态已变化，请刷新后重试。");
    if (input.to === "active") {
      const [activeRows] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM rag_index_snapshot
         WHERE namespace = ? AND product_id = ? AND language = ? AND status = 'active'
         FOR UPDATE`,
        [String(rows[0].namespace), String(rows[0].product_id), String(rows[0].language)]
      );
      const activeIds = activeRows.map((row) => String(row.id));
      if (input.previousActiveId) {
        if (activeIds.length !== 1 || activeIds[0] !== input.previousActiveId) {
          throw new Error("当前 active Snapshot 已变化，请刷新后重试。");
        }
        const [superseded] = await connection.query<ResultSetHeader>(
          "UPDATE rag_index_snapshot SET status = 'superseded', row_version = row_version + 1 WHERE id = ? AND status = 'active'",
          [input.previousActiveId]
        );
        if (superseded.affectedRows !== 1) throw new Error("当前 active Snapshot 已变化，请刷新后重试。");
      } else if (activeIds.length) {
        throw new Error("当前分区已存在 active Snapshot，请刷新后重试。");
      }
    }
    const [updated] = await connection.query<ResultSetHeader>("UPDATE rag_index_snapshot SET status = ?, validation_summary = COALESCE(?, validation_summary), immutable_at = IF(? IN ('ready','active'), COALESCE(immutable_at, NOW()), immutable_at), activated_at = IF(? = 'active', NOW(), activated_at), row_version = row_version + 1 WHERE id = ? AND status = ?", [input.to, input.validationSummary ? stringifyV5Json(input.validationSummary) : null, input.to, input.to, input.id, input.from]);
    if (updated.affectedRows !== 1) throw new Error("IndexSnapshot 状态已变化，请刷新后重试。");
    if (input.to === "active") await connection.query("INSERT INTO rag_index_activation (id, product_id, namespace, language, activated_snapshot_id, previous_snapshot_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [`activation-${randomUUID()}`, String(rows[0].product_id), String(rows[0].namespace), String(rows[0].language), input.id, input.previousActiveId || null, input.action || "activate", input.actor.actorId, input.actor.auditReason]);
    await writeV5GovernanceAudit(connection, { ...input.actor, eventType: `rag_index_${input.action || input.to}`, objectType: "rag_index_snapshot", objectId: input.id, beforeSummary: { status: input.from }, afterSummary: { status: input.to, previousActiveId: input.previousActiveId }, correlationId: input.id });
    return { indexSnapshotId: input.id, status: input.to };
  });
}

export async function writeRagRetrievalRunRecord(requestSnapshot: Record<string, unknown>, run: RagRetrievalRun, requestedBy: string) {
  return withV5GovernanceTransaction(async (connection) => {
    await connection.query("INSERT INTO retrieval_request (id, matrix_item_id, task_id, task_version, product_id, namespace, request_snapshot, request_hash, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [String(requestSnapshot.retrievalRequestId), String(requestSnapshot.matrixItemId), requestSnapshot.taskId || null, requestSnapshot.taskVersion || null, String(requestSnapshot.productId), String(requestSnapshot.namespace), stringifyV5Json(requestSnapshot), String(requestSnapshot.requestHash), requestedBy, new Date(String(requestSnapshot.requestedAt))]);
    await connection.query("INSERT INTO retrieval_run (id, retrieval_request_id, index_snapshot_ids, route_id, route_version, retrieval_policy_version, status, selected_chunk_ids, missing_evidence_roles, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [run.retrievalRunId, run.retrievalRequestId, stringifyV5Json(run.indexSnapshotIds), run.routeId, run.routeVersion, run.retrievalPolicyVersion, run.status, stringifyV5Json(run.selectedChunkIds), stringifyV5Json(run.missingEvidenceRoles), new Date(run.startedAt), new Date(run.completedAt)]);
    for (const [index, candidate] of run.candidates.entries()) await connection.query("INSERT INTO retrieval_candidate (id, retrieval_run_id, chunk_id, recall_channels, raw_scores, rrf_score, rerank_score, selected, exclusion_reasons, selection_reasons, evidence_roles, chunk_snapshot, rank_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`candidate-${randomUUID()}`, run.retrievalRunId, candidate.chunk.chunkId, stringifyV5Json(candidate.channels), stringifyV5Json(candidate.rawScores), candidate.rrfScore, candidate.rerankScore, candidate.selected, stringifyV5Json(candidate.exclusionReasons), stringifyV5Json(candidate.selectionReasons), stringifyV5Json(candidate.evidenceRoles), stringifyV5Json(candidate.chunk), candidate.selected ? index + 1 : null]);
    return run;
  });
}

export async function readRagRetrievalRunRecord(id: string): Promise<{ request: RagRetrievalRequest; run: RagRetrievalRun } | undefined> {
  const pool = getV5GovernancePool();
  const [runRows] = await pool.query<RowDataPacket[]>("SELECT * FROM retrieval_run WHERE id = ? LIMIT 1", [id]);
  if (!runRows[0]) return undefined;
  const [requestRows] = await pool.query<RowDataPacket[]>("SELECT request_snapshot FROM retrieval_request WHERE id = ? LIMIT 1", [String(runRows[0].retrieval_request_id)]);
  const [candidateRows] = await pool.query<RowDataPacket[]>("SELECT * FROM retrieval_candidate WHERE retrieval_run_id = ? ORDER BY selected DESC, rank_position, rerank_score DESC", [id]);
  const request = parseV5Json<RagRetrievalRequest>(requestRows[0]?.request_snapshot, {} as RagRetrievalRequest);
  const run: RagRetrievalRun = {
    retrievalRunId: String(runRows[0].id), retrievalRequestId: String(runRows[0].retrieval_request_id), indexSnapshotIds: parseV5Json(runRows[0].index_snapshot_ids, []),
    routeId: String(runRows[0].route_id), routeVersion: String(runRows[0].route_version), retrievalPolicyVersion: String(runRows[0].retrieval_policy_version),
    status: String(runRows[0].status) as RagRetrievalRun["status"], selectedChunkIds: parseV5Json(runRows[0].selected_chunk_ids, []),
    missingEvidenceRoles: parseV5Json(runRows[0].missing_evidence_roles, []), startedAt: date(runRows[0].started_at) || "", completedAt: date(runRows[0].completed_at) || "",
    candidates: candidateRows.map((row) => ({ chunk: parseV5Json(row.chunk_snapshot, {} as RagRetrievalRun["candidates"][number]["chunk"]), channels: parseV5Json(row.recall_channels, []), rawScores: parseV5Json(row.raw_scores, {}), rrfScore: Number(row.rrf_score), rerankScore: Number(row.rerank_score), selected: Boolean(row.selected), exclusionReasons: parseV5Json(row.exclusion_reasons, []), selectionReasons: parseV5Json(row.selection_reasons, []), evidenceRoles: parseV5Json(row.evidence_roles, []) }))
  };
  return { request, run };
}

export async function readRagMatrixItemContextRecord(matrixItemId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT i.*, v.status AS matrix_status, v.version_number AS matrix_version_number, v.approved_by AS matrix_approved_by,
      v.approved_at AS matrix_approved_at, p.status AS plan_status, p.strategy_package_version_id,
      r.status AS rule_status, r.source_snapshot_hash, r.immutable_at AS rule_immutable_at,
      pe.display_name AS product_display_name, pe.canonical_name AS product_canonical_name,
      mr.id AS readiness_id, mr.monthly_production_ready, mr.status AS readiness_status
     FROM content_matrix_item i
     JOIN content_matrix_version v ON v.id = i.matrix_version_id
     JOIN monthly_plan p ON p.id = i.monthly_plan_id
     LEFT JOIN product_entity pe ON pe.id = i.product_id
     LEFT JOIN rule_package_version r ON r.id = i.rule_package_version_id
     LEFT JOIN monthly_production_readiness mr ON mr.product_id = i.product_id AND mr.rule_package_version_id = i.rule_package_version_id
     WHERE i.id = ? LIMIT 1`,
    [matrixItemId]
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    matrixItemId: String(row.id),
    monthlyPlanId: String(row.monthly_plan_id),
    matrixVersionId: String(row.matrix_version_id),
    matrixVersionNumber: Number(row.matrix_version_number),
    strategyPackageVersionId: String(row.strategy_package_version_id || ""),
    currentTaskVersion: Number(row.version),
    productId: String(row.product_id),
    productName: String(row.product_display_name || row.product_canonical_name || row.product_id),
    channel: String(row.channel),
    contentType: String(row.content_type),
    platformContentType: String(row.platform_content_type || ""),
    title: String(row.title),
    targetAudience: String(row.target_audience || ""),
    sourceProblem: String(row.source_problem || ""),
    primaryDistilledTermId: String(row.primary_distilled_term_id || ""),
    secondaryDistilledTermIds: parseV5Json<string[]>(row.secondary_distilled_term_ids, []),
    knowledgeBaseIds: parseV5Json<string[]>(row.knowledge_base_ids, []),
    rulePackageVersionId: String(row.rule_package_version_id || ""),
    promptGroupId: String(row.prompt_group_id || ""),
    promptGroupVersionId: String(row.prompt_group_version_id || ""),
    channelRuleVersionId: String(row.channel_rule_version_id || ""),
    platformExpressionSnapshot: parseV5Json<Record<string, unknown>>(row.platform_expression_snapshot, {}),
    itemStatus: String(row.status),
    matrixStatus: String(row.matrix_status),
    matrixApprovedBy: row.matrix_approved_by ? String(row.matrix_approved_by) : undefined,
    matrixApprovedAt: date(row.matrix_approved_at),
    planStatus: String(row.plan_status),
    ruleStatus: row.rule_status ? String(row.rule_status) : undefined,
    ruleImmutableAt: date(row.rule_immutable_at),
    sourceSnapshotHash: row.source_snapshot_hash ? String(row.source_snapshot_hash) : undefined,
    readinessId: row.readiness_id ? String(row.readiness_id) : undefined,
    monthlyProductionReady: Boolean(row.monthly_production_ready),
    readinessStatus: row.readiness_status ? String(row.readiness_status) : undefined
  };
}

export async function writeEvidencePreviewRecord(preview: RagEvidencePreview, actor: V5GovernanceActor) {
  return withV5GovernanceTransaction(async (connection) => {
    await connection.query("INSERT INTO evidence_preview (id, matrix_item_id, matrix_version_id, retrieval_run_id, status, summary_snapshot, source_snapshot_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [preview.evidencePreviewId, preview.matrixItemId, preview.matrixVersionId, preview.retrievalRunId || null, preview.status, stringifyV5Json(preview), preview.sourceSnapshotHash, preview.expiresAt ? new Date(preview.expiresAt) : null, actor.actorId]);
    const items = [...preview.officialCitations];
    for (const [index, item] of items.entries()) await connection.query("INSERT INTO evidence_preview_item (id, evidence_preview_id, chunk_id, claim_ids, item_snapshot, evidence_role, display_order) VALUES (?, ?, ?, ?, ?, 'official_citation', ?)", [`preview-item-${randomUUID()}`, preview.evidencePreviewId, item.chunkId, stringifyV5Json(item.claimIds), stringifyV5Json(item), index]);
    await connection.query("UPDATE content_matrix_item SET evidence_preview_id = ?, evidence_preview_status = ?, version = version + 1 WHERE id = ? AND matrix_version_id = ?", [preview.evidencePreviewId, preview.status, preview.matrixItemId, preview.matrixVersionId]);
    await writeV5GovernanceAudit(connection, { ...actor, eventType: "evidence_preview_created", objectType: "evidence_preview", objectId: preview.evidencePreviewId, afterSummary: { matrixItemId: preview.matrixItemId, status: preview.status, gaps: preview.gaps }, correlationId: preview.evidencePreviewId });
    return preview;
  });
}

export async function readEvidencePreviewRecord(id: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT summary_snapshot FROM evidence_preview WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? parseV5Json<RagEvidencePreview>(rows[0].summary_snapshot, {} as RagEvidencePreview) : undefined;
}

export async function writeFinalEvidencePackRecord(pack: RagFinalEvidencePack, actor: V5GovernanceActor) {
  return withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO final_evidence_pack
       (id, pack_version, monthly_plan_id, matrix_version_id, matrix_item_id, task_id, task_version, retrieval_run_id, index_snapshot_ids,
        route_id, route_version, retrieval_policy_version, embedding_provider, embedding_model, reranker_model, rule_package_version_id,
        task_snapshot, governance_snapshot, retrieval_snapshot, claim_plan, evidence_groups, status, required_claims, forbidden_claims,
        evidence_items, gaps, conflicts, outdated_evidence, unverified_claims, decision, downgrade_instructions, snapshot_hash,
        source_snapshot_hash, supersedes_pack_id, immutable_at, test_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [pack.evidencePackId, pack.packVersion, pack.monthlyPlanId, pack.matrixVersionId, pack.matrixItemId, pack.taskId, pack.taskVersion, pack.retrievalRunId,
        stringifyV5Json(pack.indexSnapshotIds), pack.routeId, pack.routeVersion, pack.retrievalPolicyVersion, pack.embeddingProvider, pack.embeddingModel,
        pack.rerankerModel || null, pack.rulePackageVersionId, stringifyV5Json(pack.taskSnapshot), stringifyV5Json(pack.governanceSnapshot),
        stringifyV5Json(pack.retrievalSnapshot), stringifyV5Json(pack.claimPlan), stringifyV5Json(pack.evidenceGroups), pack.decision,
        stringifyV5Json(pack.claimPlan.requiredClaimIds), stringifyV5Json(pack.claimPlan.forbiddenClaimIds), stringifyV5Json(pack.evidenceItems),
        stringifyV5Json(pack.gaps), stringifyV5Json(pack.conflicts), stringifyV5Json(pack.outdatedEvidence), stringifyV5Json(pack.unverifiedClaims),
        pack.decision, stringifyV5Json(pack.decision === "generatable_with_downgrade" ? ["所有条件与限制必须进入正文。"] : []), pack.snapshotHash,
        pack.sourceSnapshotHash, pack.supersedesPackId || null, new Date(pack.immutableAt)]
    );
    await connection.query("INSERT INTO final_evidence_pack_version (id, final_evidence_pack_id, pack_version, immutable_snapshot, snapshot_hash, immutable_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)", [`pack-version-${randomUUID()}`, pack.evidencePackId, pack.packVersion, stringifyV5Json(pack), pack.snapshotHash, new Date(pack.immutableAt), actor.actorId]);
    for (const [index, item] of pack.evidenceItems.entries()) await connection.query("INSERT INTO final_evidence_pack_item (id, final_evidence_pack_id, pack_version, chunk_id, primary_claim_id, claim_ids, source_id, source_revision_id, source_locator, item_snapshot, evidence_group, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?)", [`pack-item-${randomUUID()}`, pack.evidencePackId, pack.packVersion, item.chunkId, item.primaryClaimId || null, stringifyV5Json(item.claimIds), item.sourceId, item.sourceRevisionId, stringifyV5Json(item.sourceLocator), stringifyV5Json(item), index]);
    const nextItemStatus = ["generatable", "generatable_with_downgrade"].includes(pack.decision) ? "ready_for_generation"
      : pack.decision === "needs_material" ? "evidence_gap" : "exception";
    const [updated] = await connection.query<ResultSetHeader>(
      `UPDATE content_matrix_item SET final_evidence_pack_id = ?, evidence_gate_status = ?, status = ?, version = ?
       WHERE id = ? AND matrix_version_id = ? AND version = ?`,
      [pack.evidencePackId, pack.decision, nextItemStatus, pack.taskVersion, pack.matrixItemId, pack.matrixVersionId, pack.taskVersion - 1]
    );
    if (updated.affectedRows !== 1) throw new Error("矩阵项版本已变化，Final EvidencePack 冻结失败。" );
    const evidenceGateRunId = `gate-${randomUUID()}`;
    const blockers = pack.decision === "generatable" || pack.decision === "generatable_with_downgrade"
      ? []
      : [...pack.gaps, ...pack.conflicts, ...pack.outdatedEvidence, ...pack.unverifiedClaims];
    await connection.query(
      `INSERT INTO evidence_gate_run
       (id, matrix_item_id, task_id, final_evidence_pack_id, decision, reason_codes, blockers, evaluated_by, evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [evidenceGateRunId, pack.matrixItemId, pack.taskId, pack.evidencePackId, pack.decision, stringifyV5Json([pack.decision]), stringifyV5Json(blockers), actor.actorId]
    );
    await writeV5GovernanceAudit(connection, { ...actor, eventType: "final_evidence_pack_frozen", objectType: "final_evidence_pack", objectId: pack.evidencePackId, afterSummary: { matrixItemId: pack.matrixItemId, decision: pack.decision, snapshotHash: pack.snapshotHash, evidenceGateRunId }, correlationId: pack.evidencePackId });
    return pack;
  });
}

export async function readFinalEvidencePackRecord(id: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT immutable_snapshot FROM final_evidence_pack_version WHERE final_evidence_pack_id = ? ORDER BY pack_version DESC LIMIT 1", [id]);
  return rows[0] ? parseV5Json<RagFinalEvidencePack>(rows[0].immutable_snapshot, {} as RagFinalEvidencePack) : undefined;
}
