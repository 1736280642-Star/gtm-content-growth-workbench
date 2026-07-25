import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
import {
  AUTOMATIC_CLAIM_EXTRACTOR_VERSION,
  AUTOMATIC_KNOWLEDGE_POLICY_VERSION,
  extractAutomaticClaims,
  governAutomaticClaims
} from "./automatic-knowledge-production";

export interface RagSourceImportWriteResult {
  replayed: boolean;
  importId: string;
  planHash: string;
  createdSources: number;
  updatedSources: number;
  unchangedSources: number;
  createdRevisions: number;
  reusedRevisions: number;
  invalidatedEvidencePacks: number;
  requeuedTasks: number;
  generatedClaims: number;
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
  const pairs = new Map<string, { productId: string; productName: string; knowledgeBaseId: string; automatic: boolean }>();
  for (const candidate of candidates) {
    pairs.set(`${candidate.productId}:${candidate.knowledgeBaseId}`, {
      productId: candidate.productId,
      productName: candidate.productName,
      knowledgeBaseId: candidate.knowledgeBaseId,
      automatic: candidate.governanceMode === "automatic_policy"
    });
  }
  for (const { productId, productName, knowledgeBaseId, automatic } of pairs.values()) {
    if (automatic) {
      await connection.query(
        `INSERT INTO knowledge_base (id, name, type, trust_level, status, update_mode, usage_scope)
         VALUES (?, ?, 'trusted_markdown_bundle', 'official', 'active', 'automatic', 'V5 automatic knowledge production')
         ON DUPLICATE KEY UPDATE name = VALUES(name), trust_level = 'official', status = 'active', update_mode = 'automatic'`,
        [knowledgeBaseId, `${productName} 事实库`]
      );
      await connection.query(
        `INSERT INTO product_entity (id, canonical_name, display_name, aliases, status, confirmed_by, confirmed_at)
         VALUES (?, ?, ?, ?, 'active', 'automatic-knowledge-policy@1', NOW())
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), status = 'active'`,
        [productId, productId, productName, stringifyV5Json([productName])]
      );
      await connection.query(
        `INSERT INTO knowledge_base_product_link
          (id, knowledge_base_id, product_id, relation_type, status, confirmed_by, confirmed_at)
         VALUES (?, ?, ?, 'supporting', 'active', 'automatic-knowledge-policy@1', NOW())
         ON DUPLICATE KEY UPDATE status = 'active', confirmed_by = VALUES(confirmed_by), confirmed_at = VALUES(confirmed_at)`,
        [stableId("kbp-", `${knowledgeBaseId}:${productId}`, 32), knowledgeBaseId, productId]
      );
    }
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
  const automaticCandidates = input.plan.candidates.filter((candidate) => candidate.writeStatus === "approved_for_claim_extraction" && candidate.normalizedTextRef);
  const automaticClaims = governAutomaticClaims((await Promise.all(automaticCandidates.map(async (candidate) => {
    const markdown = await readFile(candidate.normalizedTextRef, "utf8");
    const sourceRevisionId = stableId("src-rev-", `${candidate.sourceId}:${candidate.contentHash}`, 40);
    return extractAutomaticClaims({
      sourceId: candidate.sourceId,
      productId: candidate.productId,
      productName: candidate.productName,
      knowledgeBaseId: candidate.knowledgeBaseId,
      title: candidate.title,
      markdown,
      authorityLevel: candidate.authorityLevel,
      sourceUpdatedAt: candidate.sourceUpdatedAt,
      documentType: candidate.documentType,
      canonicalUrl: candidate.canonicalUrl
    }, {
      sourceRevisionId,
      sourceId: candidate.sourceId,
      revisionNumber: 1,
      contentHash: candidate.contentHash,
      sourceUpdatedAt: candidate.sourceUpdatedAt,
      title: candidate.title
    });
  }))).flat());
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
        invalidatedEvidencePacks: 0,
        requeuedTasks: 0,
        generatedClaims: 0,
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
      invalidatedEvidencePacks: 0,
      requeuedTasks: 0,
      generatedClaims: automaticClaims.length,
      reviewRequired: input.plan.summary.reviewRequired,
      isolated: input.plan.summary.isolated,
      skipped: input.plan.summary.skipped,
      batchIds: []
    };

    for (const [registryId, candidates] of groupByRegistry(input.plan.candidates)) {
      const first = candidates[0];
      const batchId = stableId("ing-rag-", `${input.idempotencyKey}:${registryId}`, 24);
      const batchIdempotencyKey = `${input.idempotencyKey}:${stableId("", registryId, 12)}`.slice(0, 128);
      const automaticBatch = candidates.every((candidate) => candidate.writeStatus === "approved_for_claim_extraction");
      result.batchIds.push(batchId);
      await connection.query(
        `INSERT INTO ingestion_batch
          (id, idempotency_key, purpose, target_knowledge_base_id, target_product_id, status, current_gate, source_count,
           success_count, isolated_count, pending_review_count, parser_version, classifier_version, extractor_version, requested_by)
         VALUES (?, ?, 'v5_real_rag_fixed_source_import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = VALUES(id)`,
        [
          batchId,
          batchIdempotencyKey,
          first.knowledgeBaseId,
          first.productId,
          automaticBatch ? "completed" : "awaiting_entity_review",
          automaticBatch ? "G6" : "G1",
          candidates.length,
          automaticBatch ? candidates.length : 0,
          candidates.filter((candidate) => candidate.writeStatus === "isolated").length,
          candidates.filter((candidate) => candidate.writeStatus === "review_required").length,
          input.plan.importVersion,
          input.plan.importVersion,
          automaticBatch ? AUTOMATIC_CLAIM_EXTRACTOR_VERSION : null,
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
               title, canonical_url, file_name, mime_type, language, content_hash, raw_asset_ref, normalized_text_ref, captured_at, source_updated_at,
               product_candidates, classification_confidence, classification_reasons, status, quality_flags, monthly_support,
               safety_status, safety_risk_types, isolated_reason, created_by)
             VALUES (?, ?, ?, 'batch_manifest', ?, ?, ?, ?, ?, ?, ?, ?, 'zh-CN', ?, ?, ?, NOW(), ?, ?, 0.9000, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              new Date(candidate.sourceUpdatedAt),
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
             file_name = ?, mime_type = ?, content_hash = ?, raw_asset_ref = ?, normalized_text_ref = ?, captured_at = NOW(), source_updated_at = ?,
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
              new Date(candidate.sourceUpdatedAt),
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
                 canonical_url_snapshot, captured_at, source_updated_at, parser_name, parser_version, parse_status, quality_flags,
                 content_length, supersedes_revision_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'parsed', ?, ?, ?)`,
              [
                sourceRevisionId,
                candidate.sourceId,
                Number(latestRows[0]?.revision_number || 0) + 1,
                candidate.contentHash,
                candidate.rawAssetRef || candidate.absolutePath,
                candidate.normalizedTextRef,
                candidate.title,
                candidate.canonicalUrl || null,
                new Date(candidate.sourceUpdatedAt),
                input.plan.importVersion,
                input.plan.importVersion,
                stringifyV5Json(candidate.qualityFlags),
                candidate.contentLength,
                latestRows[0]?.id ? String(latestRows[0].id) : null
              ]
            );
            result.createdRevisions += 1;
            await connection.query(
              "UPDATE rag_knowledge_chunk SET status = 'superseded' WHERE source_id = ? AND source_revision_id <> ? AND status = 'active'",
              [candidate.sourceId, sourceRevisionId]
            );
            const [affectedPackRows] = await connection.query<RowDataPacket[]>(
              `SELECT DISTINCT p.id
               FROM final_evidence_pack p
               JOIN final_evidence_pack_item i ON i.final_evidence_pack_id = p.id
               WHERE i.source_id = ? AND i.source_revision_id <> ? AND p.invalidated_at IS NULL`,
              [candidate.sourceId, sourceRevisionId]
            );
            const affectedPackIds = affectedPackRows.map((row) => String(row.id));
            if (affectedPackIds.length) {
              const [invalidated] = await connection.query<ResultSetHeader>(
                `UPDATE final_evidence_pack
                 SET status = 'invalidated', invalidated_at = NOW(), invalidation_reason = 'source_revision_changed'
                 WHERE id IN (?) AND invalidated_at IS NULL`,
                [affectedPackIds]
              );
              const [requeued] = await connection.query<ResultSetHeader>(
                `UPDATE content_matrix_item
                 SET final_evidence_pack_id = NULL, evidence_gate_status = 'pending_config', status = 'approved', version = version + 1
                 WHERE final_evidence_pack_id IN (?) AND status IN ('approved', 'ready_for_generation', 'evidence_gap', 'exception')`,
                [affectedPackIds]
              );
              result.invalidatedEvidencePacks += invalidated.affectedRows;
              result.requeuedTasks += requeued.affectedRows;
            }
            await connection.query(
              `INSERT INTO rag_index_job
                (id, job_type, product_id, status, idempotency_key, payload, max_attempts, available_at, created_by)
               VALUES (?, 'knowledge_refresh', ?, 'queued', ?, ?, 3, NOW(), ?)
               ON DUPLICATE KEY UPDATE available_at = LEAST(available_at, NOW())`,
              [
                `rag-job-${randomUUID()}`,
                candidate.productId,
                `knowledge-refresh:${candidate.productId}:${candidate.contentHash}`,
                stringifyV5Json({ sourceId: candidate.sourceId, sourceRevisionId, reason: "source_revision_changed" }),
                input.actor.actorId
              ]
            );
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
          status: automaticBatch ? "completed" : "awaiting_entity_review",
          claimCreated: automaticBatch,
          manifestCreated: false
        },
        correlationId: importId
      });
    }

    for (const candidate of automaticCandidates) {
      const currentRevisionId = stableId("src-rev-", `${candidate.sourceId}:${candidate.contentHash}`, 40);
      await connection.query(
        `UPDATE product_claim SET review_status = 'superseded'
         WHERE source_id = ? AND source_revision_id <> ? AND review_status IN ('supported', 'conditional', 'candidate')`,
        [candidate.sourceId, currentRevisionId]
      );
    }
    const candidateBySource = new Map(automaticCandidates.map((candidate) => [candidate.sourceId, candidate]));
    for (const claim of automaticClaims) {
      const candidate = candidateBySource.get(claim.sourceId);
      if (!candidate) continue;
      const supportMode = candidate.documentType === "historical_solution_document"
        ? "background_only"
        : claim.limitations.length ? "qualified" : "direct";
      await connection.query(
        `INSERT INTO product_claim
          (id, product_id, subject_type, claim_type, normalized_claim, original_quote, source_id, source_revision_id,
           source_locator, authority_level, support_mode, capability_status, claim_scope, conditions, limitations,
           confidence, extraction_model, extraction_prompt_version, extractor_version, parent_claim_ids, review_status,
           conflict_group_id, supersedes_claim_id, reviewed_by, reviewed_at)
         VALUES (?, ?, 'product', 'automatic_fact', ?, ?, ?, ?, ?, ?, ?, 'current', 'public_product', ?, ?,
           0.9900, 'deterministic_policy', ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE review_status = VALUES(review_status), conflict_group_id = VALUES(conflict_group_id),
           supersedes_claim_id = VALUES(supersedes_claim_id), reviewed_by = VALUES(reviewed_by), reviewed_at = NOW()`,
        [
          claim.claimId,
          claim.productId,
          claim.normalizedClaim,
          claim.originalQuote,
          claim.sourceId,
          claim.sourceRevisionId,
          stringifyV5Json(claim.sourceLocator),
          claim.authorityLevel,
          supportMode,
          stringifyV5Json(claim.conditions),
          stringifyV5Json(claim.limitations),
          AUTOMATIC_KNOWLEDGE_POLICY_VERSION,
          AUTOMATIC_CLAIM_EXTRACTOR_VERSION,
          stringifyV5Json([]),
          claim.status,
          claim.conflictGroupId || null,
          claim.supersedesClaimId || null,
          AUTOMATIC_KNOWLEDGE_POLICY_VERSION
        ]
      );
      if (claim.status === "disputed" && claim.conflictGroupId) {
        await connection.query(
          `INSERT INTO claim_conflict
            (id, product_id, conflict_type, subject, temporary_policy, severity, required_roles, status, resolution)
           VALUES (?, ?, 'value_conflict', ?, 'block_public_expression', 'blocking', ?, 'open', ?)
           ON DUPLICATE KEY UPDATE status = 'open', temporary_policy = 'block_public_expression'`,
          [claim.conflictGroupId, claim.productId, claim.subjectKey, stringifyV5Json([]), stringifyV5Json({ policy: AUTOMATIC_KNOWLEDGE_POLICY_VERSION })]
        );
        await connection.query(
          `INSERT INTO claim_conflict_item (id, conflict_id, claim_id, source_id)
           VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE source_id = VALUES(source_id)`,
          [`conflict-item-${randomUUID()}`, claim.conflictGroupId, claim.claimId, claim.sourceId]
        );
      }
    }
    for (const productId of new Set(automaticCandidates.map((candidate) => candidate.productId))) {
      await connection.query(
        `UPDATE claim_conflict c
         SET status = 'resolved', resolution = ?
         WHERE c.product_id = ? AND c.status = 'open'
           AND NOT EXISTS (
             SELECT 1 FROM product_claim pc
             WHERE pc.conflict_group_id = c.id AND pc.review_status = 'disputed'
           )`,
        [stringifyV5Json({ policy: AUTOMATIC_KNOWLEDGE_POLICY_VERSION, decision: "resolved_by_authority_or_recency" }), productId]
      );
    }

    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "rag_fixed_source_import",
      requestHash,
      resourceType: "rag_source_import",
      resourceId: importId,
      responseStatus: input.plan.summary.reviewRequired ? "awaiting_human_governance" : "automatic_governance_completed",
      responseSummary: result
    });
    return result;
  });
}
