import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  V5ApprovalAction,
  V5AuthorityLevel,
  V5ClaimScope,
  V5EvidenceGapSeverity,
  V5GovernanceRole,
  V5LifecycleStatus,
  V5ProductClaimStatus,
  V5RulePackageChange,
  V5SupportMode,
  V5Visibility
} from "./knowledge-governance-contracts";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  readV5Idempotency,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  writeV5Idempotency,
  type V5GovernanceActor
} from "./knowledge-governance-repository";

export interface V5SourceRegistrationInput {
  sourceId: string;
  knowledgeBaseId: string;
  importMethod: "url" | "file" | "manual_text" | "batch_manifest";
  documentType: string;
  authorityLevel: V5AuthorityLevel;
  lifecycleStatus: V5LifecycleStatus;
  visibility: V5Visibility;
  title?: string;
  canonicalUrl?: string;
  fileName?: string;
  mimeType?: string;
  language?: string;
  contentHash?: string;
  rawAssetRef?: string;
  normalizedTextRef?: string;
  capturedAt?: string;
  sourceUpdatedAt?: string;
  validFrom?: string;
  validUntil?: string;
  productCandidates: string[];
  classificationConfidence: number;
  classificationReasons: string[];
  status: string;
  qualityFlags: string[];
  monthlySupport: {
    supportedContentTypes: string[];
    supportedChannels: string[];
    evidenceRoles: string[];
    limitationCodes: string[];
  };
  safetyStatus: "pending" | "passed" | "isolated" | "restricted_approved";
  safetyRiskTypes: string[];
  isolatedReason?: string;
}

export interface V5ClaimWriteInput {
  claimId?: string;
  productId: string;
  subjectType: "product" | "external" | "cross_product";
  claimType: string;
  normalizedClaim: string;
  originalQuote: string;
  sourceId: string;
  sourceRevisionId: string;
  sourceLocator: Record<string, unknown>;
  authorityLevel: V5AuthorityLevel;
  supportMode: V5SupportMode;
  capabilityStatus: V5LifecycleStatus;
  claimScope: V5ClaimScope;
  conditions: string[];
  limitations: string[];
  productVersion?: string;
  validFrom?: string;
  validUntil?: string;
  confidence: number;
  extractionModel?: string;
  extractionPromptVersion?: string;
  extractorVersion: string;
  parentClaimIds: string[];
  reviewStatus: V5ProductClaimStatus;
  supersedesClaimId?: string;
}

export interface V5RuleDraftWriteInput {
  rulePackageVersionId?: string;
  version: string;
  basedOnVersionId?: string;
  sourceBatchIds: string[];
  linkedKnowledgeBaseIds: string[];
  linkedSourceIds: string[];
  linkedClaimIds: string[];
  productIdentity: Record<string, unknown>;
  capabilities: unknown[];
  allowedExpressions: unknown[];
  conditionalExpressions: unknown[];
  blockedExpressions: unknown[];
  evidenceRequirements: unknown[];
  channelBoundaries: unknown[];
  officialCitationRules: unknown[];
  evidenceGapIds: string[];
  conflictRefs: string[];
  distilledTermSuggestions: unknown[];
  questionSuggestions: unknown[];
  monthlyMatrixScope: Record<string, unknown>;
  changeSet: Omit<V5RulePackageChange, "rulePackageVersionId">[];
  pendingRoles: V5GovernanceRole[];
}

function hashSorted(values: string[]) {
  return createHash("sha256").update([...values].sort().join("\n")).digest("hex");
}

function toDate(value?: string) {
  return value ? new Date(value) : null;
}

function approvedAction(action: V5ApprovalAction) {
  return ["approve", "approve_with_conditions", "accept_conservative_wording"].includes(action);
}

function pendingStatusForRoles(roles: string[]) {
  if (roles.length === 0) return "draft_pending_confirmation";
  const primary = roles[0].replace(/_owner$/, "");
  return `draft_pending_${primary}_confirmation`;
}

async function assertKnowledgeBaseExists(connection: PoolConnection, knowledgeBaseId: string) {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT id FROM knowledge_base WHERE id = ? LIMIT 1", [knowledgeBaseId]);
  if (!rows[0]) throw new V5GovernanceRepositoryError("not_found", `知识库 ${knowledgeBaseId} 不存在。`, 404);
}

export async function upsertV5KnowledgeBaseRegistryRecord(input: {
  knowledgeBaseId: string;
  name: string;
  type: string;
  trustLevel: string;
  status: string;
  updateMode: string;
  usageScope?: string;
  lastSyncedAt?: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, knowledgeBaseId: replay.resourceId };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_base WHERE id = ? FOR UPDATE", [input.knowledgeBaseId]);
    const existing = rows[0];
    const currentVersion = existing ? Number(existing.row_version) : 0;
    if (currentVersion !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `知识库登记当前 rowVersion 为 ${currentVersion}。`, 409);
    }
    if (existing) {
      await connection.query(
        `UPDATE knowledge_base SET name = ?, type = ?, trust_level = ?, status = ?, update_mode = ?, usage_scope = ?, last_synced_at = ?, row_version = row_version + 1
         WHERE id = ? AND row_version = ?`,
        [
          input.name,
          input.type,
          input.trustLevel,
          input.status,
          input.updateMode,
          input.usageScope || null,
          toDate(input.lastSyncedAt),
          input.knowledgeBaseId,
          input.expectedVersion
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO knowledge_base (id, name, type, trust_level, status, row_version, update_mode, usage_scope, last_synced_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          input.knowledgeBaseId,
          input.name,
          input.type,
          input.trustLevel,
          input.status,
          input.updateMode,
          input.usageScope || null,
          toDate(input.lastSyncedAt)
        ]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: existing ? "knowledge_base_registry_updated" : "knowledge_base_registry_created",
      objectType: "knowledge_base",
      objectId: input.knowledgeBaseId,
      beforeSummary: existing ? { name: String(existing.name), rowVersion: currentVersion } : undefined,
      afterSummary: { name: input.name, type: input.type, rowVersion: currentVersion + 1 },
      correlationId: input.knowledgeBaseId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "upsert_knowledge_base_registry",
      requestHash,
      resourceType: "knowledge_base",
      resourceId: input.knowledgeBaseId,
      responseStatus: existing ? "updated" : "created",
      responseSummary: { knowledgeBaseId: input.knowledgeBaseId, rowVersion: currentVersion + 1 }
    });
    return { replayed: false, knowledgeBaseId: input.knowledgeBaseId, rowVersion: currentVersion + 1 };
  });
}

export async function readV5KnowledgeBaseRegistryRecord(knowledgeBaseId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM knowledge_base WHERE id = ? LIMIT 1", [knowledgeBaseId]);
  const row = rows[0];
  if (!row) return undefined;
  return {
    knowledgeBaseId: String(row.id),
    name: String(row.name),
    type: String(row.type),
    trustLevel: String(row.trust_level),
    status: String(row.status),
    rowVersion: Number(row.row_version),
    updateMode: String(row.update_mode),
    usageScope: row.usage_scope ? String(row.usage_scope) : undefined,
    lastSyncedAt: row.last_synced_at || undefined
  };
}

export async function upsertV5ProductEntityRecord(input: {
  productId: string;
  canonicalName: string;
  displayName: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases: string[];
  knowledgeBaseIds: string[];
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: { actorId: input.actor.actorId, actorRole: input.actor.actorRole } });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, productId: replay.resourceId };
    for (const knowledgeBaseId of input.knowledgeBaseIds) await assertKnowledgeBaseExists(connection, knowledgeBaseId);
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ? FOR UPDATE", [input.productId]);
    const existing = rows[0];
    const currentVersion = existing ? Number(existing.row_version) : 0;
    if (currentVersion !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `产品实体当前 rowVersion 为 ${currentVersion}。`, 409);
    }
    if (existing) {
      await connection.query(
        `UPDATE product_entity SET canonical_name = ?, display_name = ?, brand_name = ?, official_entity = ?, official_url = ?, product_category = ?, aliases = ?,
         confirmed_by = ?, confirmed_at = NOW(), row_version = row_version + 1 WHERE id = ? AND row_version = ?`,
        [
          input.canonicalName,
          input.displayName,
          input.brandName || null,
          input.officialEntity || null,
          input.officialUrl || null,
          input.productCategory || null,
          stringifyV5Json(input.aliases),
          input.actor.actorId,
          input.productId,
          input.expectedVersion
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO product_entity
          (id, canonical_name, display_name, brand_name, official_entity, official_url, product_category, aliases, status, row_version, confirmed_by, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, NOW())`,
        [
          input.productId,
          input.canonicalName,
          input.displayName,
          input.brandName || null,
          input.officialEntity || null,
          input.officialUrl || null,
          input.productCategory || null,
          stringifyV5Json(input.aliases),
          input.actor.actorId
        ]
      );
    }
    for (const knowledgeBaseId of input.knowledgeBaseIds) {
      const [linkRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM knowledge_base_product_link WHERE knowledge_base_id = ? AND product_id = ? AND relation_type = 'supporting' LIMIT 1",
        [knowledgeBaseId, input.productId]
      );
      if (!linkRows[0]) {
        await connection.query(
          `INSERT INTO knowledge_base_product_link
            (id, knowledge_base_id, product_id, relation_type, status, confirmed_by, confirmed_at)
           VALUES (?, ?, ?, 'supporting', 'active', ?, NOW())`,
          [`kbp-${randomUUID()}`, knowledgeBaseId, input.productId, input.actor.actorId]
        );
      }
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: existing ? "product_entity_updated" : "product_entity_confirmed",
      objectType: "product_entity",
      objectId: input.productId,
      beforeSummary: existing ? { rowVersion: currentVersion, canonicalName: String(existing.canonical_name) } : undefined,
      afterSummary: { rowVersion: currentVersion + 1, canonicalName: input.canonicalName, knowledgeBaseIds: input.knowledgeBaseIds },
      correlationId: input.productId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "upsert_product_entity",
      requestHash,
      resourceType: "product_entity",
      resourceId: input.productId,
      responseStatus: existing ? "updated" : "created",
      responseSummary: { productId: input.productId, rowVersion: currentVersion + 1 }
    });
    return { replayed: false, productId: input.productId, rowVersion: currentVersion + 1 };
  });
}

export async function registerV5SourceAssetsRecord(input: {
  batchId: string;
  sources: V5SourceRegistrationInput[];
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ batchId: input.batchId, sources: input.sources });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return { replayed: true, batchId: input.batchId, sourceIds: input.sources.map((source) => source.sourceId) };
    const [batchRows] = await connection.query<RowDataPacket[]>("SELECT * FROM ingestion_batch WHERE id = ? FOR UPDATE", [input.batchId]);
    const batch = batchRows[0];
    if (!batch) throw new V5GovernanceRepositoryError("not_found", "导入批次不存在。", 404);
    if (Number(batch.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `导入批次当前 rowVersion 为 ${batch.row_version}。`, 409);
    }
    let createdCount = 0;
    let duplicateCount = 0;
    for (const source of input.sources) {
      await assertKnowledgeBaseExists(connection, source.knowledgeBaseId);
      const [sourceRows] = await connection.query<RowDataPacket[]>("SELECT id FROM source_asset WHERE id = ? LIMIT 1", [source.sourceId]);
      const duplicate = Boolean(sourceRows[0]);
      if (!duplicate) {
        await connection.query(
          `INSERT INTO source_asset
            (id, batch_id, primary_knowledge_base_id, import_method, document_type, authority_level, lifecycle_status, visibility, title, canonical_url, file_name,
             mime_type, language, content_hash, raw_asset_ref, normalized_text_ref, captured_at, source_updated_at, valid_from, valid_until, product_candidates,
             classification_confidence, classification_reasons, status, quality_flags, monthly_support, safety_status, safety_risk_types, isolated_reason, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            source.sourceId,
            input.batchId,
            source.knowledgeBaseId,
            source.importMethod,
            source.documentType,
            source.authorityLevel,
            source.lifecycleStatus,
            source.visibility,
            source.title || null,
            source.canonicalUrl || null,
            source.fileName || null,
            source.mimeType || null,
            source.language || null,
            source.contentHash || null,
            source.rawAssetRef || null,
            source.normalizedTextRef || null,
            toDate(source.capturedAt),
            toDate(source.sourceUpdatedAt),
            toDate(source.validFrom),
            toDate(source.validUntil),
            stringifyV5Json(source.productCandidates),
            source.classificationConfidence,
            stringifyV5Json(source.classificationReasons),
            source.status,
            stringifyV5Json(source.qualityFlags),
            stringifyV5Json(source.monthlySupport),
            source.safetyStatus,
            stringifyV5Json(source.safetyRiskTypes),
            source.isolatedReason || null,
            input.actor.actorId
          ]
        );
        createdCount += 1;
      } else {
        duplicateCount += 1;
      }
      await connection.query(
        `INSERT INTO ingestion_batch_source_asset (id, batch_id, source_id, discovery_type)
         VALUES (?, ?, ?, ?)`,
        [`ibs-${randomUUID()}`, input.batchId, source.sourceId, duplicate ? "duplicate" : "new"]
      );
      const [kbSourceRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM knowledge_base_source_asset WHERE knowledge_base_id = ? AND source_id = ? AND relation_type = 'member' LIMIT 1",
        [source.knowledgeBaseId, source.sourceId]
      );
      if (!kbSourceRows[0]) {
        await connection.query(
          `INSERT INTO knowledge_base_source_asset (id, knowledge_base_id, source_id, relation_type)
           VALUES (?, ?, ?, 'member')`,
          [`kbs-${randomUUID()}`, source.knowledgeBaseId, source.sourceId]
        );
      }
    }
    const [countRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS source_count FROM ingestion_batch_source_asset WHERE batch_id = ?", [input.batchId]);
    const sourceCount = Number(countRows[0]?.source_count || 0);
    await connection.query(
      "UPDATE ingestion_batch SET source_count = ?, status = 'parsing', current_gate = 'G0', row_version = row_version + 1 WHERE id = ? AND row_version = ?",
      [sourceCount, input.batchId, input.expectedVersion]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "source_assets_registered",
      objectType: "ingestion_batch",
      objectId: input.batchId,
      relatedSourceIds: input.sources.map((source) => source.sourceId),
      beforeSummary: { rowVersion: input.expectedVersion, sourceCount: Number(batch.source_count) },
      afterSummary: { rowVersion: input.expectedVersion + 1, sourceCount, createdCount, duplicateCount },
      correlationId: input.batchId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "register_source_assets",
      requestHash,
      resourceType: "ingestion_batch",
      resourceId: input.batchId,
      responseStatus: "registered",
      responseSummary: { sourceCount, createdCount, duplicateCount }
    });
    return { replayed: false, batchId: input.batchId, sourceCount, createdCount, duplicateCount, rowVersion: input.expectedVersion + 1 };
  });
}

export async function createV5SourceRevisionRecord(input: {
  sourceId: string;
  contentHash: string;
  rawAssetRef?: string;
  normalizedTextRef: string;
  titleSnapshot?: string;
  canonicalUrlSnapshot?: string;
  capturedAt: string;
  sourceUpdatedAt?: string;
  parserName: string;
  parserVersion: string;
  parseStatus: "parsed" | "parse_failed";
  qualityFlags: string[];
  contentLength: number;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, sourceRevisionId: replay.resourceId };
    const [sourceRows] = await connection.query<RowDataPacket[]>("SELECT * FROM source_asset WHERE id = ? FOR UPDATE", [input.sourceId]);
    const source = sourceRows[0];
    if (!source) throw new V5GovernanceRepositoryError("not_found", "来源资料不存在。", 404);
    if (Number(source.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `来源资料当前 rowVersion 为 ${source.row_version}。`, 409);
    }
    const [existingRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM source_revision WHERE source_id = ? AND content_hash = ? LIMIT 1",
      [input.sourceId, input.contentHash]
    );
    const existingRevisionId = existingRows[0] ? String(existingRows[0].id) : undefined;
    let sourceRevisionId = existingRevisionId;
    let revisionNumber = 0;
    if (!sourceRevisionId) {
      const [revisionRows] = await connection.query<RowDataPacket[]>(
        "SELECT revision_number AS current_revision, id FROM source_revision WHERE source_id = ? ORDER BY revision_number DESC LIMIT 1",
        [input.sourceId]
      );
      revisionNumber = Number(revisionRows[0]?.current_revision || 0) + 1;
      sourceRevisionId = `src-rev-${randomUUID()}`;
      await connection.query(
        `INSERT INTO source_revision
          (id, source_id, revision_number, content_hash, raw_asset_ref, normalized_text_ref, title_snapshot, canonical_url_snapshot, captured_at, source_updated_at,
           parser_name, parser_version, parse_status, quality_flags, content_length, supersedes_revision_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sourceRevisionId,
          input.sourceId,
          revisionNumber,
          input.contentHash,
          input.rawAssetRef || null,
          input.normalizedTextRef,
          input.titleSnapshot || null,
          input.canonicalUrlSnapshot || null,
          new Date(input.capturedAt),
          toDate(input.sourceUpdatedAt),
          input.parserName,
          input.parserVersion,
          input.parseStatus,
          stringifyV5Json(input.qualityFlags),
          input.contentLength,
          revisionRows[0]?.id ? String(revisionRows[0].id) : null
        ]
      );
    }
    await connection.query(
      `UPDATE source_asset SET content_hash = ?, raw_asset_ref = ?, normalized_text_ref = ?, captured_at = ?, source_updated_at = ?, status = ?, quality_flags = ?, row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [
        input.contentHash,
        input.rawAssetRef || null,
        input.normalizedTextRef,
        new Date(input.capturedAt),
        toDate(input.sourceUpdatedAt),
        input.parseStatus === "parsed" ? "parsed" : "parse_failed",
        stringifyV5Json(input.qualityFlags),
        input.sourceId,
        input.expectedVersion
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "source_parsed",
      objectType: "source_revision",
      objectId: sourceRevisionId,
      relatedSourceIds: [input.sourceId],
      beforeSummary: { sourceStatus: String(source.status), sourceRowVersion: input.expectedVersion },
      afterSummary: { parseStatus: input.parseStatus, sourceRowVersion: input.expectedVersion + 1, revisionNumber, reusedRevision: Boolean(existingRevisionId) },
      correlationId: String(source.batch_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_source_revision",
      requestHash,
      resourceType: "source_revision",
      resourceId: sourceRevisionId,
      responseStatus: existingRevisionId ? "reused" : input.parseStatus,
      responseSummary: { sourceId: input.sourceId, sourceRevisionId, revisionNumber }
    });
    return { replayed: false, sourceId: input.sourceId, sourceRevisionId, revisionNumber, sourceRowVersion: input.expectedVersion + 1, reusedRevision: Boolean(existingRevisionId) };
  });
}

export async function classifyV5SourceAssetRecord(input: {
  sourceId: string;
  documentType: string;
  authorityLevel: V5AuthorityLevel;
  lifecycleStatus: V5LifecycleStatus;
  visibility: V5Visibility;
  productCandidates: string[];
  classificationConfidence: number;
  classificationReasons: string[];
  productId?: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return { replayed: true, sourceId: input.sourceId };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM source_asset WHERE id = ? FOR UPDATE", [input.sourceId]);
    const source = rows[0];
    if (!source) throw new V5GovernanceRepositoryError("not_found", "来源资料不存在。", 404);
    if (Number(source.row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("version_conflict", `来源资料当前 rowVersion 为 ${source.row_version}。`, 409);
    await connection.query(
      `UPDATE source_asset SET document_type = ?, authority_level = ?, lifecycle_status = ?, visibility = ?, product_candidates = ?, classification_confidence = ?,
       classification_reasons = ?, status = 'approved_for_claim_extraction', row_version = row_version + 1 WHERE id = ? AND row_version = ?`,
      [
        input.documentType,
        input.authorityLevel,
        input.lifecycleStatus,
        input.visibility,
        stringifyV5Json(input.productCandidates),
        input.classificationConfidence,
        stringifyV5Json(input.classificationReasons),
        input.sourceId,
        input.expectedVersion
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "source_classification_changed",
      objectType: "source_asset",
      objectId: input.sourceId,
      relatedSourceIds: [input.sourceId],
      beforeSummary: {
        documentType: String(source.document_type), authorityLevel: String(source.authority_level), lifecycleStatus: String(source.lifecycle_status), visibility: String(source.visibility)
      },
      afterSummary: {
        documentType: input.documentType, authorityLevel: input.authorityLevel, lifecycleStatus: input.lifecycleStatus, visibility: input.visibility,
        productId: input.productId, rowVersion: input.expectedVersion + 1
      },
      correlationId: String(source.batch_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "classify_source_asset",
      requestHash,
      resourceType: "source_asset",
      resourceId: input.sourceId,
      responseStatus: "approved_for_claim_extraction",
      responseSummary: { sourceId: input.sourceId, rowVersion: input.expectedVersion + 1 }
    });
    return { replayed: false, sourceId: input.sourceId, status: "approved_for_claim_extraction", rowVersion: input.expectedVersion + 1 };
  });
}

export async function insertV5ProductClaimsRecord(input: {
  sourceRevisionId: string;
  claims: V5ClaimWriteInput[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ sourceRevisionId: input.sourceRevisionId, claims: input.claims });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return { replayed: true, claimIds: input.claims.map((claim) => claim.claimId).filter(Boolean) };
    const [revisionRows] = await connection.query<RowDataPacket[]>("SELECT * FROM source_revision WHERE id = ? LIMIT 1", [input.sourceRevisionId]);
    const revision = revisionRows[0];
    if (!revision) throw new V5GovernanceRepositoryError("not_found", "来源修订不存在。", 404);
    const claimIds: string[] = [];
    for (const claim of input.claims) {
      if (claim.sourceRevisionId !== input.sourceRevisionId || claim.sourceId !== String(revision.source_id)) {
        throw new V5GovernanceRepositoryError("invalid_contract", "Claim 的 sourceId/sourceRevisionId 与当前来源修订不一致。", 400);
      }
      const claimId = claim.claimId || `claim-${randomUUID()}`;
      await connection.query(
        `INSERT INTO product_claim
          (id, product_id, subject_type, claim_type, normalized_claim, original_quote, source_id, source_revision_id, source_locator, authority_level, support_mode,
           capability_status, claim_scope, conditions, limitations, product_version, valid_from, valid_until, confidence, extraction_model, extraction_prompt_version,
           extractor_version, parent_claim_ids, review_status, supersedes_claim_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          claimId,
          claim.productId,
          claim.subjectType,
          claim.claimType,
          claim.normalizedClaim,
          claim.originalQuote,
          claim.sourceId,
          claim.sourceRevisionId,
          stringifyV5Json(claim.sourceLocator),
          claim.authorityLevel,
          claim.supportMode,
          claim.capabilityStatus,
          claim.claimScope,
          stringifyV5Json(claim.conditions),
          stringifyV5Json(claim.limitations),
          claim.productVersion || null,
          toDate(claim.validFrom),
          toDate(claim.validUntil),
          claim.confidence,
          claim.extractionModel || null,
          claim.extractionPromptVersion || null,
          claim.extractorVersion,
          stringifyV5Json(claim.parentClaimIds),
          claim.reviewStatus,
          claim.supersedesClaimId || null
        ]
      );
      claimIds.push(claimId);
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "claims_extracted",
      objectType: "source_revision",
      objectId: input.sourceRevisionId,
      relatedSourceIds: [String(revision.source_id)],
      afterSummary: { claimCount: claimIds.length, claimIds, extractorVersions: Array.from(new Set(input.claims.map((claim) => claim.extractorVersion))) },
      correlationId: input.sourceRevisionId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "extract_product_claims",
      requestHash,
      resourceType: "source_revision",
      resourceId: input.sourceRevisionId,
      responseStatus: "claims_created",
      responseSummary: { claimIds }
    });
    return { replayed: false, sourceRevisionId: input.sourceRevisionId, claimIds };
  });
}

export async function reviewV5ProductClaimRecord(input: {
  claimId: string;
  reviewStatus: "supported" | "conditional" | "rejected";
  conditions?: string[];
  limitations?: string[];
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return { replayed: true, claimId: input.claimId };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_claim WHERE id = ? FOR UPDATE", [input.claimId]);
    const claim = rows[0];
    if (!claim) throw new V5GovernanceRepositoryError("not_found", "ProductClaim 不存在。", 404);
    if (Number(claim.row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("version_conflict", `ProductClaim 当前 rowVersion 为 ${claim.row_version}。`, 409);
    await connection.query(
      `UPDATE product_claim SET review_status = ?, conditions = ?, limitations = ?, reviewed_by = ?, reviewed_at = NOW(), row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [
        input.reviewStatus,
        stringifyV5Json(input.conditions ?? parseV5Json(claim.conditions, [])),
        stringifyV5Json(input.limitations ?? parseV5Json(claim.limitations, [])),
        input.actor.actorId,
        input.claimId,
        input.expectedVersion
      ]
    );
    await connection.query(
      `INSERT INTO approval_record
        (id, object_type, object_id, confirmation_unit, role, action, status, actor_id, before_summary, after_summary, reason, evidence_source_ids, impact_summary)
       VALUES (?, 'claim', ?, 'claim', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `approval-${randomUUID()}`,
        input.claimId,
        input.actor.actorRole,
        input.reviewStatus === "rejected" ? "reject" : input.reviewStatus === "conditional" ? "approve_with_conditions" : "approve",
        input.reviewStatus === "rejected" ? "rejected" : "approved",
        input.actor.actorId,
        stringifyV5Json({ reviewStatus: String(claim.review_status), rowVersion: input.expectedVersion }),
        stringifyV5Json({ reviewStatus: input.reviewStatus, rowVersion: input.expectedVersion + 1 }),
        input.actor.auditReason,
        stringifyV5Json([String(claim.source_id)]),
        stringifyV5Json({ affectsRulePackage: true, affectsRetrieval: true })
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "claim_reviewed",
      objectType: "product_claim",
      objectId: input.claimId,
      relatedSourceIds: [String(claim.source_id)],
      beforeSummary: { reviewStatus: String(claim.review_status), rowVersion: input.expectedVersion },
      afterSummary: { reviewStatus: input.reviewStatus, rowVersion: input.expectedVersion + 1 },
      correlationId: String(claim.source_revision_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "review_product_claim",
      requestHash,
      resourceType: "product_claim",
      resourceId: input.claimId,
      responseStatus: input.reviewStatus,
      responseSummary: { claimId: input.claimId, rowVersion: input.expectedVersion + 1 }
    });
    return { replayed: false, claimId: input.claimId, reviewStatus: input.reviewStatus, rowVersion: input.expectedVersion + 1 };
  });
}

export async function createV5ClaimConflictRecord(input: {
  conflictId?: string;
  productId: string;
  conflictType: string;
  subject: string;
  claimIds: string[];
  sourceIds: string[];
  preferredTemporaryClaimId?: string;
  temporaryPolicy: string;
  severity: V5EvidenceGapSeverity;
  requiredRoles: V5GovernanceRole[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, conflictId: replay.resourceId };
    const conflictId = input.conflictId || `conflict-${randomUUID()}`;
    await connection.query(
      `INSERT INTO claim_conflict
        (id, product_id, conflict_type, subject, preferred_temporary_claim_id, temporary_policy, severity, required_roles, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        conflictId,
        input.productId,
        input.conflictType,
        input.subject,
        input.preferredTemporaryClaimId || null,
        input.temporaryPolicy,
        input.severity,
        stringifyV5Json(input.requiredRoles)
      ]
    );
    for (const claimId of input.claimIds) {
      const [claimRows] = await connection.query<RowDataPacket[]>("SELECT source_id FROM product_claim WHERE id = ? LIMIT 1", [claimId]);
      if (!claimRows[0]) throw new V5GovernanceRepositoryError("not_found", `冲突引用的 Claim ${claimId} 不存在。`, 404);
      await connection.query(
        "INSERT INTO claim_conflict_item (id, conflict_id, claim_id, source_id) VALUES (?, ?, ?, ?)",
        [`conflict-item-${randomUUID()}`, conflictId, claimId, String(claimRows[0].source_id)]
      );
      await connection.query("UPDATE product_claim SET review_status = 'disputed', conflict_group_id = ?, row_version = row_version + 1 WHERE id = ?", [conflictId, claimId]);
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "conflict_created",
      objectType: "claim_conflict",
      objectId: conflictId,
      relatedSourceIds: input.sourceIds,
      afterSummary: { severity: input.severity, claimIds: input.claimIds, temporaryPolicy: input.temporaryPolicy },
      correlationId: conflictId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_claim_conflict",
      requestHash,
      resourceType: "claim_conflict",
      resourceId: conflictId,
      responseStatus: "open",
      responseSummary: { conflictId }
    });
    return { replayed: false, conflictId, status: "open" };
  });
}

export async function createV5EvidenceGapRecord(input: {
  gapId?: string;
  productId: string;
  gapCode: string;
  title: string;
  description?: string;
  affectedRuleFields: string[];
  affectedClaimTypes: string[];
  triggerSourceIds: string[];
  severity: V5EvidenceGapSeverity;
  recommendedAction: string;
  ownerRole: V5GovernanceRole;
  dueAt?: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, gapId: replay.resourceId };
    const gapId = input.gapId || `gap-${randomUUID()}`;
    await connection.query(
      `INSERT INTO evidence_gap
        (id, product_id, gap_code, title, description, affected_rule_fields, affected_claim_types, trigger_source_ids, severity, status, recommended_action,
         owner_role, due_at, resolved_by_source_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        gapId,
        input.productId,
        input.gapCode,
        input.title,
        input.description || null,
        stringifyV5Json(input.affectedRuleFields),
        stringifyV5Json(input.affectedClaimTypes),
        stringifyV5Json(input.triggerSourceIds),
        input.severity,
        input.recommendedAction,
        input.ownerRole,
        toDate(input.dueAt),
        stringifyV5Json([])
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "evidence_gap_created",
      objectType: "evidence_gap",
      objectId: gapId,
      relatedSourceIds: input.triggerSourceIds,
      afterSummary: { gapCode: input.gapCode, severity: input.severity, affectedRuleFields: input.affectedRuleFields, ownerRole: input.ownerRole },
      correlationId: gapId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_evidence_gap",
      requestHash,
      resourceType: "evidence_gap",
      resourceId: gapId,
      responseStatus: "open",
      responseSummary: { gapId }
    });
    return { replayed: false, gapId, status: "open" };
  });
}

export async function createV5RulePackageDraftRecord(input: {
  productId: string;
  draft: V5RuleDraftWriteInput;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ productId: input.productId, draft: input.draft });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      const [versionRows] = await connection.query<RowDataPacket[]>("SELECT * FROM rule_package_version WHERE id = ? LIMIT 1", [replay.resourceId]);
      const version = versionRows[0];
      if (version) {
        const [snapshotRows] = await connection.query<RowDataPacket[]>(
          "SELECT id FROM source_snapshot WHERE product_id = ? AND snapshot_hash = ? LIMIT 1",
          [String(version.product_id), String(version.source_snapshot_hash)]
        );
        return {
          replayed: true,
          rulePackageId: String(version.rule_package_id),
          rulePackageVersionId: String(version.id),
          status: String(version.status),
          rowVersion: Number(version.row_version),
          sourceSnapshotId: snapshotRows[0] ? String(snapshotRows[0].id) : undefined,
          sourceSnapshotHash: String(version.source_snapshot_hash),
          claimSetHash: String(version.claim_set_hash)
        };
      }
    }
    const [productRows] = await connection.query<RowDataPacket[]>("SELECT id FROM product_entity WHERE id = ? AND status = 'active' LIMIT 1", [input.productId]);
    if (!productRows[0]) throw new V5GovernanceRepositoryError("not_found", "正式产品实体不存在或已停用。", 404);
    if (input.draft.linkedClaimIds.length === 0) throw new V5GovernanceRepositoryError("invalid_contract", "规则包草稿至少需要一条可追溯 Claim 候选。", 400);
    const claimPlaceholders = input.draft.linkedClaimIds.map(() => "?").join(", ");
    const [claimRows] = await connection.query<RowDataPacket[]>(
      `SELECT pc.id, pc.source_id, pc.source_revision_id, pc.review_status, sr.content_hash
       FROM product_claim pc JOIN source_revision sr ON sr.id = pc.source_revision_id
       WHERE pc.product_id = ? AND pc.id IN (${claimPlaceholders})`,
      [input.productId, ...input.draft.linkedClaimIds]
    );
    if (claimRows.length !== input.draft.linkedClaimIds.length || claimRows.some((row) => ["disputed", "rejected", "superseded", "expired"].includes(String(row.review_status)))) {
      throw new V5GovernanceRepositoryError("approval_required", "规则包引用了不存在、冲突未决、已拒绝或已失效的 Claim。", 409);
    }
    const claimSetHash = hashSorted(input.draft.linkedClaimIds);
    const snapshotParts = claimRows.map((row) => `${row.source_id}:${row.source_revision_id}:${row.content_hash}`);
    const sourceSnapshotHash = hashSorted(snapshotParts);
    let sourceSnapshotId: string;
    const [snapshotRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM source_snapshot WHERE product_id = ? AND snapshot_hash = ? LIMIT 1",
      [input.productId, sourceSnapshotHash]
    );
    if (snapshotRows[0]) {
      sourceSnapshotId = String(snapshotRows[0].id);
    } else {
      sourceSnapshotId = `snapshot-${randomUUID()}`;
      const sourceIds = Array.from(new Set(claimRows.map((row) => String(row.source_id))));
      const revisionIds = Array.from(new Set(claimRows.map((row) => String(row.source_revision_id))));
      await connection.query(
        `INSERT INTO source_snapshot (id, product_id, snapshot_hash, source_ids, source_revision_ids, approved_claim_ids, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          sourceSnapshotId,
          input.productId,
          sourceSnapshotHash,
          stringifyV5Json(sourceIds),
          stringifyV5Json(revisionIds),
          stringifyV5Json(claimRows.filter((row) => ["supported", "conditional"].includes(String(row.review_status))).map((row) => String(row.id))),
          input.actor.actorId
        ]
      );
      const seenRevisions = new Set<string>();
      for (const row of claimRows) {
        const revisionId = String(row.source_revision_id);
        if (seenRevisions.has(revisionId)) continue;
        seenRevisions.add(revisionId);
        await connection.query(
          "INSERT INTO source_snapshot_item (id, source_snapshot_id, source_id, source_revision_id, content_hash) VALUES (?, ?, ?, ?, ?)",
          [`snapshot-item-${randomUUID()}`, sourceSnapshotId, String(row.source_id), revisionId, String(row.content_hash)]
        );
      }
    }

    const [packageRows] = await connection.query<RowDataPacket[]>("SELECT id FROM product_expression_rule_package WHERE product_id = ? FOR UPDATE", [input.productId]);
    const rulePackageId = packageRows[0] ? String(packageRows[0].id) : `rule-package-${input.productId}`;
    if (!packageRows[0]) {
      await connection.query(
        "INSERT INTO product_expression_rule_package (id, product_id, status, row_version) VALUES (?, ?, 'draft', 1)",
        [rulePackageId, input.productId]
      );
    }
    const rulePackageVersionId = input.draft.rulePackageVersionId || `rule-version-${randomUUID()}`;
    await connection.query(
      `INSERT INTO rule_package_version
        (id, rule_package_id, product_id, version, status, row_version, pending_roles, based_on_version_id, source_batch_ids, linked_knowledge_base_ids,
         linked_source_ids, linked_claim_ids, product_identity, capabilities, allowed_expressions, conditional_expressions, blocked_expressions, evidence_requirements,
         channel_boundaries, official_citation_rules, evidence_gap_ids, conflict_refs, distilled_term_suggestions, question_suggestions, monthly_matrix_scope, change_set,
         claim_set_hash, source_snapshot_hash, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rulePackageVersionId,
        rulePackageId,
        input.productId,
        input.draft.version,
        pendingStatusForRoles(input.draft.pendingRoles),
        stringifyV5Json(input.draft.pendingRoles),
        input.draft.basedOnVersionId || null,
        stringifyV5Json(input.draft.sourceBatchIds),
        stringifyV5Json(input.draft.linkedKnowledgeBaseIds),
        stringifyV5Json(input.draft.linkedSourceIds),
        stringifyV5Json(input.draft.linkedClaimIds),
        stringifyV5Json(input.draft.productIdentity),
        stringifyV5Json(input.draft.capabilities),
        stringifyV5Json(input.draft.allowedExpressions),
        stringifyV5Json(input.draft.conditionalExpressions),
        stringifyV5Json(input.draft.blockedExpressions),
        stringifyV5Json(input.draft.evidenceRequirements),
        stringifyV5Json(input.draft.channelBoundaries),
        stringifyV5Json(input.draft.officialCitationRules),
        stringifyV5Json(input.draft.evidenceGapIds),
        stringifyV5Json(input.draft.conflictRefs),
        stringifyV5Json(input.draft.distilledTermSuggestions),
        stringifyV5Json(input.draft.questionSuggestions),
        stringifyV5Json(input.draft.monthlyMatrixScope),
        stringifyV5Json(input.draft.changeSet),
        claimSetHash,
        sourceSnapshotHash,
        input.actor.actorId
      ]
    );
    for (const claimId of input.draft.linkedClaimIds) {
      const claimRow = claimRows.find((row) => String(row.id) === claimId);
      const usageType = claimRow && ["supported", "conditional"].includes(String(claimRow.review_status)) ? "evidence" : "candidate_evidence";
      await connection.query(
        "INSERT INTO rule_package_claim (id, rule_package_version_id, claim_id, usage_type) VALUES (?, ?, ?, ?)",
        [`rule-claim-${randomUUID()}`, rulePackageVersionId, claimId, usageType]
      );
    }
    const seenRevisions = new Set<string>();
    for (const row of claimRows) {
      const revisionId = String(row.source_revision_id);
      if (seenRevisions.has(revisionId)) continue;
      seenRevisions.add(revisionId);
      await connection.query(
        "INSERT INTO rule_package_source_revision (id, rule_package_version_id, source_revision_id, source_id) VALUES (?, ?, ?, ?)",
        [`rule-revision-${randomUUID()}`, rulePackageVersionId, revisionId, String(row.source_id)]
      );
    }
    for (const change of input.draft.changeSet) {
      await connection.query(
        `INSERT INTO rule_package_change
          (id, rule_package_version_id, section, field_path, change_type, before_value, after_value, reason, claim_ids, source_ids, risk_level, required_roles, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          change.changeId,
          rulePackageVersionId,
          change.section,
          change.fieldPath,
          change.changeType,
          change.before === undefined ? null : stringifyV5Json(change.before),
          change.after === undefined ? null : stringifyV5Json(change.after),
          change.reason,
          stringifyV5Json(change.claimIds),
          stringifyV5Json(change.sourceIds),
          change.riskLevel,
          stringifyV5Json(change.requiredRoles),
          change.reviewStatus
        ]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rule_draft_generated",
      objectType: "rule_package_version",
      objectId: rulePackageVersionId,
      relatedSourceIds: input.draft.linkedSourceIds,
      afterSummary: {
        version: input.draft.version,
        pendingRoles: input.draft.pendingRoles,
        claimCount: input.draft.linkedClaimIds.length,
        sourceSnapshotId,
        sourceSnapshotHash,
        changeCount: input.draft.changeSet.length
      },
      correlationId: rulePackageVersionId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_rule_package_draft",
      requestHash,
      resourceType: "rule_package_version",
      resourceId: rulePackageVersionId,
      responseStatus: pendingStatusForRoles(input.draft.pendingRoles),
      responseSummary: { rulePackageVersionId, sourceSnapshotId, sourceSnapshotHash }
    });
    return {
      replayed: false,
      rulePackageId,
      rulePackageVersionId,
      status: pendingStatusForRoles(input.draft.pendingRoles),
      rowVersion: 1,
      sourceSnapshotId,
      sourceSnapshotHash,
      claimSetHash
    };
  });
}

export async function approveV5RulePackageVersionRecord(input: {
  rulePackageVersionId: string;
  role: V5GovernanceRole;
  action: V5ApprovalAction;
  reason: string;
  evidenceSourceIds: string[];
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return { replayed: true, rulePackageVersionId: input.rulePackageVersionId };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM rule_package_version WHERE id = ? FOR UPDATE", [input.rulePackageVersionId]);
    const version = rows[0];
    if (!version) throw new V5GovernanceRepositoryError("not_found", "规则包版本不存在。", 404);
    if (Number(version.row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("version_conflict", `规则包当前 rowVersion 为 ${version.row_version}。`, 409);
    const pendingRoles = parseV5Json<string[]>(version.pending_roles, []);
    const nextPendingRoles = approvedAction(input.action)
      ? pendingRoles.filter((role) => role !== input.role)
      : Array.from(new Set([...pendingRoles, input.role]));
    const approvalStatus = approvedAction(input.action) ? "approved" : input.action === "reject" ? "rejected" : input.action === "defer" ? "deferred" : "changes_requested";
    await connection.query(
      `INSERT INTO approval_record
        (id, object_type, object_id, confirmation_unit, role, action, status, actor_id, before_summary, after_summary, reason, evidence_source_ids, impact_summary)
       VALUES (?, 'package', ?, 'package', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `approval-${randomUUID()}`,
        input.rulePackageVersionId,
        input.role,
        input.action,
        approvalStatus,
        input.actor.actorId,
        stringifyV5Json({ pendingRoles, status: String(version.status), rowVersion: input.expectedVersion }),
        stringifyV5Json({ pendingRoles: nextPendingRoles, status: pendingStatusForRoles(nextPendingRoles), rowVersion: input.expectedVersion + 1 }),
        input.reason,
        stringifyV5Json(input.evidenceSourceIds),
        stringifyV5Json({ affectsActivation: true, action: input.action })
      ]
    );
    await connection.query(
      "UPDATE rule_package_version SET pending_roles = ?, status = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?",
      [stringifyV5Json(nextPendingRoles), pendingStatusForRoles(nextPendingRoles), input.rulePackageVersionId, input.expectedVersion]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rule_package_approval_recorded",
      objectType: "rule_package_version",
      objectId: input.rulePackageVersionId,
      relatedSourceIds: input.evidenceSourceIds,
      beforeSummary: { pendingRoles, rowVersion: input.expectedVersion },
      afterSummary: { pendingRoles: nextPendingRoles, rowVersion: input.expectedVersion + 1, role: input.role, action: input.action },
      correlationId: input.rulePackageVersionId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "approve_rule_package_version",
      requestHash,
      resourceType: "rule_package_version",
      resourceId: input.rulePackageVersionId,
      responseStatus: approvalStatus,
      responseSummary: { pendingRoles: nextPendingRoles, rowVersion: input.expectedVersion + 1 }
    });
    return {
      replayed: false,
      rulePackageVersionId: input.rulePackageVersionId,
      approvalStatus,
      pendingRoles: nextPendingRoles,
      status: pendingStatusForRoles(nextPendingRoles),
      rowVersion: input.expectedVersion + 1
    };
  });
}

export async function readV5ProductGovernanceSummary(productId: string) {
  const pool = getV5GovernancePool();
  const [productRows] = await pool.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ? LIMIT 1", [productId]);
  if (!productRows[0]) return undefined;
  const [claimRows] = await pool.query<RowDataPacket[]>(
    "SELECT review_status, COUNT(*) AS count FROM product_claim WHERE product_id = ? GROUP BY review_status",
    [productId]
  );
  const [conflictRows] = await pool.query<RowDataPacket[]>("SELECT id, conflict_type, severity, status, subject FROM claim_conflict WHERE product_id = ? ORDER BY created_at", [productId]);
  const [gapRows] = await pool.query<RowDataPacket[]>("SELECT id, gap_code, severity, status, title, owner_role FROM evidence_gap WHERE product_id = ? ORDER BY created_at", [productId]);
  const [ruleRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, version, status, pending_roles, source_snapshot_hash, row_version, created_at, activated_at FROM rule_package_version WHERE product_id = ? ORDER BY created_at DESC",
    [productId]
  );
  return {
    product: {
      productId: String(productRows[0].id),
      canonicalName: String(productRows[0].canonical_name),
      displayName: String(productRows[0].display_name),
      status: String(productRows[0].status),
      rowVersion: Number(productRows[0].row_version)
    },
    claimStatusCounts: Object.fromEntries(claimRows.map((row) => [String(row.review_status), Number(row.count)])),
    conflicts: conflictRows.map((row) => ({
      conflictId: String(row.id), conflictType: String(row.conflict_type), severity: String(row.severity), status: String(row.status), subject: String(row.subject)
    })),
    evidenceGaps: gapRows.map((row) => ({
      gapId: String(row.id), gapCode: String(row.gap_code), severity: String(row.severity), status: String(row.status), title: String(row.title), ownerRole: String(row.owner_role)
    })),
    rulePackageVersions: ruleRows.map((row) => ({
      rulePackageVersionId: String(row.id), version: String(row.version), status: String(row.status), pendingRoles: parseV5Json<string[]>(row.pending_roles, []),
      sourceSnapshotHash: String(row.source_snapshot_hash), rowVersion: Number(row.row_version), createdAt: row.created_at, activatedAt: row.activated_at
    }))
  };
}
