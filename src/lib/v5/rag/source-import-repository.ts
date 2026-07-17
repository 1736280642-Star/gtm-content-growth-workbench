import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  hashV5GovernancePayload,
  readV5Idempotency,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  writeV5Idempotency,
  type V5GovernanceActor
} from "../knowledge-governance-repository";
import type { RagSourceImportExecutionPlan, RagSourceImportPreparedCandidate } from "./source-import-service";

export interface RagSourceImportWriteResult {
  replayed: boolean;
  importId: string;
  planHash: string;
  createdSources: number;
  updatedSources: number;
  unchangedSources: number;
  createdRevisions: number;
  reusedRevisions: number;
  reviewRequired: number;
  isolated: number;
  skipped: number;
  batchIds: string[];
}

function stableId(prefix: string, value: string, length = 32) {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

function groupByRegistry(candidates: RagSourceImportPreparedCandidate[]) {
  const groups = new Map<string, RagSourceImportPreparedCandidate[]>();
  for (const candidate of candidates) {
    const current = groups.get(candidate.registryId) || [];
    current.push(candidate);
    groups.set(candidate.registryId, current);
  }
  return groups;
}

async function assertHumanGovernancePrerequisites(
  connection: Parameters<Parameters<typeof withV5GovernanceTransaction>[0]>[0],
  candidates: RagSourceImportPreparedCandidate[]
) {
  const pairs = new Map<string, { productId: string; knowledgeBaseId: string }>();
  for (const candidate of candidates) {
    pairs.set(`${candidate.productId}:${candidate.knowledgeBaseId}`, {
      productId: candidate.productId,
      knowledgeBaseId: candidate.knowledgeBaseId
    });
  }
  for (const { productId, knowledgeBaseId } of pairs.values()) {
    const [knowledgeBaseRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM knowledge_base WHERE id = ? AND status = 'active' LIMIT 1",
      [knowledgeBaseId]
    );
    if (!knowledgeBaseRows[0]) {
      throw new V5GovernanceRepositoryError(
        "knowledge_base_not_confirmed",
        `知识库 ${knowledgeBaseId} 不存在或未激活，禁止自动创建后继续导入。`,
        409,
        "先由知识治理负责人登记并确认知识库。"
      );
    }
    const [productRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM product_entity WHERE id = ? AND status = 'active' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL LIMIT 1",
      [productId]
    );
    if (!productRows[0]) {
      throw new V5GovernanceRepositoryError(
        "product_entity_not_confirmed",
        `产品实体 ${productId} 不存在或缺少人工确认记录。`,
        409,
        "先由产品/知识治理负责人确认产品实体。"
      );
    }
    const [linkRows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM knowledge_base_product_link
       WHERE knowledge_base_id = ? AND product_id = ? AND relation_type = 'supporting' AND status = 'active'
         AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL LIMIT 1`,
      [knowledgeBaseId, productId]
    );
    if (!linkRows[0]) {
      throw new V5GovernanceRepositoryError(
        "knowledge_base_product_link_not_confirmed",
        `知识库 ${knowledgeBaseId} 与产品 ${productId} 缺少有效人工确认关联。`,
        409,
        "先完成人工产品归属确认。"
      );
    }
  }
}

export async function writeRagSourceImport(input: {
  plan: RagSourceImportExecutionPlan;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}): Promise<RagSourceImportWriteResult> {
  if (!input.plan.candidates.length) {
    throw new V5GovernanceRepositoryError("empty_import_plan", "Source Import 没有可写入候选。", 400);
  }
  if (!input.actor.actorId.trim() || !input.actor.actorRole.trim() || !input.actor.auditReason.trim()) {
    throw new V5GovernanceRepositoryError("invalid_actor", "Source Import 缺少操作者、角色或审计原因。", 400);
  }
  const requestHash = hashV5GovernancePayload({
    planHash: input.plan.planHash,
    importVersion: input.plan.importVersion
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) {
      return {
        replayed: true,
        importId: replay.resourceId || stableId("rag-import-", input.plan.planHash, 24),
        planHash: input.plan.planHash,
        createdSources: 0,
        updatedSources: 0,
        unchangedSources: input.plan.candidates.length,
        createdRevisions: 0,
        reusedRevisions: input.plan.summary.sourceRevisionCandidates,
        reviewRequired: input.plan.summary.reviewRequired,
        isolated: input.plan.summary.isolated,
        skipped: input.plan.summary.skipped,
        batchIds: []
      };
    }
    await assertHumanGovernancePrerequisites(connection, input.plan.candidates);

    const importId = stableId("rag-import-", `${input.idempotencyKey}:${input.plan.planHash}`, 24);
    const result: RagSourceImportWriteResult = {
      replayed: false,
      importId,
      planHash: input.plan.planHash,
      createdSources: 0,
      updatedSources: 0,
      unchangedSources: 0,
      createdRevisions: 0,
      reusedRevisions: 0,
      reviewRequired: input.plan.summary.reviewRequired,
      isolated: input.plan.summary.isolated,
      skipped: input.plan.summary.skipped,
      batchIds: []
    };

    for (const [registryId, candidates] of groupByRegistry(input.plan.candidates)) {
      const first = candidates[0];
      const batchId = stableId("ing-rag-", `${input.idempotencyKey}:${registryId}`, 24);
      const batchIdempotencyKey = `${input.idempotencyKey}:${stableId("", registryId, 12)}`.slice(0, 128);
      result.batchIds.push(batchId);
      await connection.query(
        `INSERT INTO ingestion_batch
          (id, idempotency_key, purpose, target_knowledge_base_id, target_product_id, status, current_gate, source_count,
           success_count, isolated_count, pending_review_count, parser_version, classifier_version, extractor_version, requested_by)
         VALUES (?, ?, 'v5_real_rag_fixed_source_import', ?, ?, 'awaiting_entity_review', 'G1', ?, 0, ?, ?, ?, ?, NULL, ?)
         ON DUPLICATE KEY UPDATE id = VALUES(id)`,
        [
          batchId,
          batchIdempotencyKey,
          first.knowledgeBaseId,
          first.productId,
          candidates.length,
          candidates.filter((candidate) => candidate.writeStatus === "isolated").length,
          candidates.filter((candidate) => candidate.writeStatus === "review_required").length,
          input.plan.importVersion,
          input.plan.importVersion,
          input.actor.actorId
        ]
      );

      for (const candidate of candidates) {
        const [sourceRows] = await connection.query<RowDataPacket[]>(
          "SELECT * FROM source_asset WHERE id = ? FOR UPDATE",
          [candidate.sourceId]
        );
        const existing = sourceRows[0];
        if (existing && String(existing.primary_knowledge_base_id) !== candidate.knowledgeBaseId) {
          throw new V5GovernanceRepositoryError(
            "source_identity_conflict",
            `Source ${candidate.sourceId} 已绑定其他知识库，禁止覆盖。`,
            409
          );
        }
        const sameContent = existing && String(existing.content_hash || "") === candidate.contentHash;
        const classificationReasons = [candidate.reason, ...candidate.forbiddenUsage.map((item) => `forbidden:${item}`)];
        const monthlySupport = {
          supportedContentTypes: [],
          supportedChannels: [],
          evidenceRoles: candidate.allowedEvidenceRoles,
          limitationCodes: candidate.forbiddenUsage
        };
        if (!existing) {
          await connection.query(
            `INSERT INTO source_asset
              (id, batch_id, primary_knowledge_base_id, import_method, document_type, authority_level, lifecycle_status, visibility,
               title, canonical_url, file_name, mime_type, language, content_hash, raw_asset_ref, normalized_text_ref, captured_at,
               product_candidates, classification_confidence, classification_reasons, status, quality_flags, monthly_support,
               safety_status, safety_risk_types, isolated_reason, created_by)
             VALUES (?, ?, ?, 'batch_manifest', ?, ?, ?, ?, ?, ?, ?, ?, 'zh-CN', ?, ?, ?, NOW(), ?, 0.9000, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              candidate.sourceId,
              batchId,
              candidate.knowledgeBaseId,
              candidate.documentType,
              candidate.authorityLevel,
              candidate.lifecycleStatus,
              candidate.visibility,
              candidate.title,
              candidate.canonicalUrl || null,
              candidate.relativePath,
              candidate.normalizedTextRef ? "text/markdown" : "application/octet-stream",
              candidate.contentHash,
              candidate.rawAssetRef || candidate.absolutePath,
              candidate.normalizedTextRef || null,
              stringifyV5Json([candidate.productId]),
              stringifyV5Json(classificationReasons),
              candidate.writeStatus,
              stringifyV5Json(candidate.qualityFlags),
              stringifyV5Json(monthlySupport),
              candidate.safetyStatus,
              stringifyV5Json(candidate.forbiddenUsage),
              candidate.isolatedReason || null,
              input.actor.actorId
            ]
          );
          result.createdSources += 1;
        } else if (!sameContent) {
          await connection.query(
            `UPDATE source_asset SET document_type = ?, authority_level = ?, lifecycle_status = ?, visibility = ?, title = ?, canonical_url = ?,
             file_name = ?, mime_type = ?, content_hash = ?, raw_asset_ref = ?, normalized_text_ref = ?, captured_at = NOW(),
             product_candidates = ?, classification_confidence = 0.9000, classification_reasons = ?, status = ?, quality_flags = ?,
             monthly_support = ?, safety_status = ?, safety_risk_types = ?, isolated_reason = ?, row_version = row_version + 1
             WHERE id = ?`,
            [
              candidate.documentType,
              candidate.authorityLevel,
              candidate.lifecycleStatus,
              candidate.visibility,
              candidate.title,
              candidate.canonicalUrl || null,
              candidate.relativePath,
              candidate.normalizedTextRef ? "text/markdown" : "application/octet-stream",
              candidate.contentHash,
              candidate.rawAssetRef || candidate.absolutePath,
              candidate.normalizedTextRef || null,
              stringifyV5Json([candidate.productId]),
              stringifyV5Json(classificationReasons),
              candidate.writeStatus,
              stringifyV5Json(candidate.qualityFlags),
              stringifyV5Json(monthlySupport),
              candidate.safetyStatus,
              stringifyV5Json(candidate.forbiddenUsage),
              candidate.isolatedReason || null,
              candidate.sourceId
            ]
          );
          result.updatedSources += 1;
        } else {
          result.unchangedSources += 1;
        }

        await connection.query(
          `INSERT INTO ingestion_batch_source_asset (id, batch_id, source_id, discovery_type)
           VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE discovery_type = VALUES(discovery_type)`,
          [`ibs-${randomUUID()}`, batchId, candidate.sourceId, existing ? "duplicate" : "new"]
        );
        await connection.query(
          `INSERT INTO knowledge_base_source_asset (id, knowledge_base_id, source_id, relation_type)
           VALUES (?, ?, ?, 'member') ON DUPLICATE KEY UPDATE id = id`,
          [`kbs-${randomUUID()}`, candidate.knowledgeBaseId, candidate.sourceId]
        );

        if (candidate.normalizedTextRef) {
          const [revisionRows] = await connection.query<RowDataPacket[]>(
            "SELECT id FROM source_revision WHERE source_id = ? AND content_hash = ? LIMIT 1",
            [candidate.sourceId, candidate.contentHash]
          );
          if (revisionRows[0]) {
            result.reusedRevisions += 1;
          } else {
            const [latestRows] = await connection.query<RowDataPacket[]>(
              "SELECT id, revision_number FROM source_revision WHERE source_id = ? ORDER BY revision_number DESC LIMIT 1",
              [candidate.sourceId]
            );
            const sourceRevisionId = stableId("src-rev-", `${candidate.sourceId}:${candidate.contentHash}`, 40);
            await connection.query(
              `INSERT INTO source_revision
                (id, source_id, revision_number, content_hash, raw_asset_ref, normalized_text_ref, title_snapshot,
                 canonical_url_snapshot, captured_at, parser_name, parser_version, parse_status, quality_flags,
                 content_length, supersedes_revision_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'parsed', ?, ?, ?)`,
              [
                sourceRevisionId,
                candidate.sourceId,
                Number(latestRows[0]?.revision_number || 0) + 1,
                candidate.contentHash,
                candidate.rawAssetRef || candidate.absolutePath,
                candidate.normalizedTextRef,
                candidate.title,
                candidate.canonicalUrl || null,
                input.plan.importVersion,
                input.plan.importVersion,
                stringifyV5Json(candidate.qualityFlags),
                candidate.contentLength,
                latestRows[0]?.id ? String(latestRows[0].id) : null
              ]
            );
            result.createdRevisions += 1;
          }
        }
      }

      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "rag_fixed_source_registry_imported",
        objectType: "ingestion_batch",
        objectId: batchId,
        relatedSourceIds: candidates.map((candidate) => candidate.sourceId),
        afterSummary: {
          registryId,
          productId: first.productId,
          knowledgeBaseId: first.knowledgeBaseId,
          sourceCount: candidates.length,
          status: "awaiting_entity_review",
          claimCreated: false,
          manifestCreated: false
        },
        correlationId: importId
      });
    }

    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "rag_fixed_source_import",
      requestHash,
      resourceType: "rag_source_import",
      resourceId: importId,
      responseStatus: "awaiting_human_governance",
      responseSummary: result
    });
    return result;
  });
}
