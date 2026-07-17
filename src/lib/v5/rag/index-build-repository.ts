import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { V5ProductClaim, V5SourceAsset, V5SourceRevision } from "../knowledge-governance-contracts";
import { getV5GovernancePool, parseV5Json, stringifyV5Json, withV5GovernanceTransaction } from "../knowledge-governance-repository";
import type { RagKnowledgeChunk } from "./contracts";
import { readRagIndexSnapshotRecord, readRagManifestRecord } from "./rag-repository";

export interface RagIndexBuildSource {
  source: V5SourceAsset;
  revision: V5SourceRevision;
  claims: V5ProductClaim[];
}

function iso(value: unknown) { return value instanceof Date ? value.toISOString() : value ? String(value) : undefined; }

export async function readRagIndexBuildContext(indexSnapshotId: string) {
  const snapshot = await readRagIndexSnapshotRecord(indexSnapshotId);
  if (!snapshot) return undefined;
  const manifest = await readRagManifestRecord(snapshot.manifestId);
  if (!manifest) return undefined;
  const pool = getV5GovernancePool();
  const [revisionRows] = manifest.approvedSourceRevisionIds.length
    ? await pool.query<RowDataPacket[]>("SELECT * FROM source_revision WHERE id IN (?) AND parse_status = 'parsed'", [manifest.approvedSourceRevisionIds])
    : [[] as unknown as RowDataPacket[]];
  const sourceIds = revisionRows.map((row) => String(row.source_id));
  const [sourceRows] = sourceIds.length
    ? await pool.query<RowDataPacket[]>("SELECT * FROM source_asset WHERE id IN (?) AND status = 'approved_for_claim_extraction' AND safety_status IN ('passed','restricted_approved')", [sourceIds])
    : [[] as unknown as RowDataPacket[]];
  const [claimRows] = manifest.approvedClaimIds.length
    ? await pool.query<RowDataPacket[]>("SELECT * FROM product_claim WHERE id IN (?) AND product_id = ? AND review_status IN ('supported','conditional')", [manifest.approvedClaimIds, manifest.productId])
    : [[] as unknown as RowDataPacket[]];
  const [productRows] = await pool.query<RowDataPacket[]>("SELECT canonical_name, display_name FROM product_entity WHERE id = ? LIMIT 1", [manifest.productId]);
  const [ruleRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM rule_package_version WHERE id = ? AND product_id = ? AND status = 'active' AND immutable_at IS NOT NULL LIMIT 1",
    [manifest.activeRulePackageVersionId, manifest.productId]
  );
  const [readinessRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM monthly_production_readiness WHERE id = ? AND product_id = ? AND rule_package_version_id = ?
     AND monthly_production_ready = TRUE AND status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL LIMIT 1`,
    [manifest.monthlyProductionReadinessId, manifest.productId, manifest.activeRulePackageVersionId]
  );
  const sourceById = new Map(sourceRows.map((row) => [String(row.id), mapSource(row)]));
  const claimsByRevision = new Map<string, V5ProductClaim[]>();
  claimRows.forEach((row) => {
    const claim = mapClaim(row);
    const items = claimsByRevision.get(claim.sourceRevisionId) || [];
    items.push(claim);
    claimsByRevision.set(claim.sourceRevisionId, items);
  });
  const sources: RagIndexBuildSource[] = revisionRows.map((row) => {
    const revision = mapRevision(row);
    const source = sourceById.get(revision.sourceId);
    if (!source) throw new Error(`SourceAsset ${revision.sourceId} 不存在。`);
    return { source, revision, claims: claimsByRevision.get(revision.sourceRevisionId) || [] };
  });
  return {
    snapshot,
    manifest,
    productName: String(productRows[0]?.display_name || productRows[0]?.canonical_name || manifest.productId),
    sources,
    governanceReady: Boolean(ruleRows[0] && readinessRows[0])
  };
}

function mapSource(row: RowDataPacket): V5SourceAsset {
  return {
    sourceId: String(row.id), batchId: String(row.batch_id), knowledgeBaseId: String(row.primary_knowledge_base_id), importMethod: String(row.import_method) as V5SourceAsset["importMethod"],
    documentType: String(row.document_type), authorityLevel: String(row.authority_level) as V5SourceAsset["authorityLevel"], lifecycleStatus: String(row.lifecycle_status) as V5SourceAsset["lifecycleStatus"],
    visibility: String(row.visibility) as V5SourceAsset["visibility"], title: row.title ? String(row.title) : undefined, canonicalUrl: row.canonical_url ? String(row.canonical_url) : undefined,
    fileName: row.file_name ? String(row.file_name) : undefined, mimeType: row.mime_type ? String(row.mime_type) : undefined, language: row.language ? String(row.language) : undefined,
    contentHash: row.content_hash ? String(row.content_hash) : undefined, rawAssetRef: row.raw_asset_ref ? String(row.raw_asset_ref) : undefined,
    normalizedTextRef: row.normalized_text_ref ? String(row.normalized_text_ref) : undefined, capturedAt: iso(row.captured_at), sourceUpdatedAt: iso(row.source_updated_at), validFrom: iso(row.valid_from), validUntil: iso(row.valid_until),
    productCandidates: parseV5Json(row.product_candidates, []), classificationConfidence: Number(row.classification_confidence), classificationReasons: parseV5Json(row.classification_reasons, []),
    status: String(row.status) as V5SourceAsset["status"], qualityFlags: parseV5Json(row.quality_flags, []), monthlySupport: parseV5Json(row.monthly_support, { supportedContentTypes: [], supportedChannels: [], evidenceRoles: [], limitationCodes: [] }),
    safetyStatus: String(row.safety_status) as V5SourceAsset["safetyStatus"], safetyRiskTypes: parseV5Json(row.safety_risk_types, []), isolatedReason: row.isolated_reason ? String(row.isolated_reason) : undefined,
    createdBy: String(row.created_by)
  };
}

function mapRevision(row: RowDataPacket): V5SourceRevision {
  return { sourceRevisionId: String(row.id), sourceId: String(row.source_id), revisionNumber: Number(row.revision_number), contentHash: String(row.content_hash),
    rawAssetRef: row.raw_asset_ref ? String(row.raw_asset_ref) : undefined, normalizedTextRef: String(row.normalized_text_ref), titleSnapshot: row.title_snapshot ? String(row.title_snapshot) : undefined,
    canonicalUrlSnapshot: row.canonical_url_snapshot ? String(row.canonical_url_snapshot) : undefined, capturedAt: iso(row.captured_at) || "", sourceUpdatedAt: iso(row.source_updated_at),
    parserName: String(row.parser_name), parserVersion: String(row.parser_version), parseStatus: String(row.parse_status) as V5SourceRevision["parseStatus"], qualityFlags: parseV5Json(row.quality_flags, []),
    contentLength: Number(row.content_length), supersedesRevisionId: row.supersedes_revision_id ? String(row.supersedes_revision_id) : undefined };
}

function mapClaim(row: RowDataPacket): V5ProductClaim {
  return { claimId: String(row.id), productId: String(row.product_id), subjectType: String(row.subject_type) as V5ProductClaim["subjectType"], claimType: String(row.claim_type), normalizedClaim: String(row.normalized_claim),
    originalQuote: String(row.original_quote), sourceId: String(row.source_id), sourceRevisionId: String(row.source_revision_id), sourceLocator: parseV5Json(row.source_locator, { headingPath: [] }),
    authorityLevel: String(row.authority_level) as V5ProductClaim["authorityLevel"], supportMode: String(row.support_mode) as V5ProductClaim["supportMode"], capabilityStatus: String(row.capability_status) as V5ProductClaim["capabilityStatus"],
    claimScope: String(row.claim_scope) as V5ProductClaim["claimScope"], conditions: parseV5Json(row.conditions, []), limitations: parseV5Json(row.limitations, []), productVersion: row.product_version ? String(row.product_version) : undefined,
    validFrom: iso(row.valid_from), validUntil: iso(row.valid_until), confidence: Number(row.confidence), extractionModel: row.extraction_model ? String(row.extraction_model) : undefined,
    extractionPromptVersion: row.extraction_prompt_version ? String(row.extraction_prompt_version) : undefined, extractorVersion: String(row.extractor_version), parentClaimIds: parseV5Json(row.parent_claim_ids, []),
    reviewStatus: String(row.review_status) as V5ProductClaim["reviewStatus"], conflictGroupId: row.conflict_group_id ? String(row.conflict_group_id) : undefined,
    supersedesClaimId: row.supersedes_claim_id ? String(row.supersedes_claim_id) : undefined, reviewedBy: row.reviewed_by ? String(row.reviewed_by) : undefined, reviewedAt: iso(row.reviewed_at) };
}

export async function persistRagIndexBuild(input: { indexSnapshotId: string; chunks: RagKnowledgeChunk[]; provider: string; model: string; dimensions: number; vectors: Map<string, number[]>; reviewRequiredCount: number }) {
  return withV5GovernanceTransaction(async (connection) => {
    for (const chunk of input.chunks) {
      await connection.query(
        `INSERT INTO rag_knowledge_chunk
         (id, index_snapshot_id, namespace, product_id, product_name, knowledge_base_ids, source_id, source_revision_id, parent_chunk_id,
          primary_claim_id, claim_ids, source_locator, semantic_type, chunk_title, summary, content, original_quote, canonical_url, document_type,
          authority_level, lifecycle_status, visibility, support_mode, claim_scope, capability_status, conditions, limitations, scenario_tags,
          capability_tags, audience_tags, problem_tags, channel_tags, distilled_term_ids, question_candidate_ids, conflict_group_ids,
          rule_package_version_id, valid_from, valid_until, content_hash, semantic_hash, duplicate_cluster_id, status, chunker_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = VALUES(id)`,
        [chunk.chunkId, chunk.indexSnapshotId, chunk.namespace, chunk.productId, chunk.productName, stringifyV5Json(chunk.knowledgeBaseIds), chunk.sourceId, chunk.sourceRevisionId, chunk.parentChunkId || null,
          chunk.primaryClaimId || null, stringifyV5Json(chunk.claimIds), stringifyV5Json(chunk.sourceLocator), chunk.semanticType, chunk.chunkTitle, chunk.summary, chunk.content, chunk.originalQuote,
          chunk.canonicalUrl || null, chunk.documentType, chunk.authorityLevel, chunk.lifecycleStatus, chunk.visibility, chunk.supportMode, chunk.claimScope, chunk.capabilityStatus,
          stringifyV5Json(chunk.conditions), stringifyV5Json(chunk.limitations), stringifyV5Json(chunk.scenarioTags), stringifyV5Json(chunk.capabilityTags), stringifyV5Json(chunk.audienceTags),
          stringifyV5Json(chunk.problemTags), stringifyV5Json(chunk.channelTags), stringifyV5Json(chunk.distilledTermIds), stringifyV5Json(chunk.questionCandidateIds), stringifyV5Json(chunk.conflictGroupIds),
          chunk.rulePackageVersionId, chunk.validFrom ? new Date(chunk.validFrom) : null, chunk.validUntil ? new Date(chunk.validUntil) : null, chunk.contentHash, chunk.semanticHash,
          chunk.duplicateClusterId, chunk.status, chunk.chunkerVersion]
      );
      const vector = input.vectors.get(chunk.chunkId);
      if (!vector) throw new Error(`Chunk ${chunk.chunkId} 缺少向量。`);
      await connection.query(
        `INSERT INTO rag_chunk_embedding (id, index_snapshot_id, chunk_id, provider, model, dimensions, normalization_version, vector_hash, embedded_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'provider_output@1', ?, NOW(), 'completed') ON DUPLICATE KEY UPDATE vector_hash = VALUES(vector_hash), embedded_at = VALUES(embedded_at), status = 'completed'`,
        [`embedding-${randomUUID()}`, input.indexSnapshotId, chunk.chunkId, input.provider, input.model, input.dimensions, createHash("sha256").update(JSON.stringify(vector)).digest("hex")]
      );
      if (chunk.parentChunkId) await connection.query(
        "INSERT INTO rag_chunk_relation (id, index_snapshot_id, from_chunk_id, to_chunk_id, relation_type, metadata) VALUES (?, ?, ?, ?, 'parent_child', ?) ON DUPLICATE KEY UPDATE metadata = VALUES(metadata)",
        [`relation-${randomUUID()}`, input.indexSnapshotId, chunk.parentChunkId, chunk.chunkId, stringifyV5Json({ primaryClaimId: chunk.primaryClaimId })]
      );
    }
    const [updated] = await connection.query<ResultSetHeader>(
      "UPDATE rag_index_snapshot SET status = 'validating', embedding_provider = ?, embedding_model = ?, embedding_dimensions = ?, document_count = ?, validation_summary = ?, row_version = row_version + 1 WHERE id = ? AND status = 'building'",
      [input.provider, input.model, input.dimensions, input.chunks.length, stringifyV5Json({ status: "awaiting_evaluation", reviewRequiredCount: input.reviewRequiredCount }), input.indexSnapshotId]
    );
    if (updated.affectedRows !== 1) throw new Error("IndexSnapshot 状态已变化，索引构建结果未提交。" );
    return { indexedChunkCount: input.chunks.length, reviewRequiredCount: input.reviewRequiredCount };
  });
}
