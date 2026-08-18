import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  parseV5Json,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "../knowledge-governance-repository";
import type { V5AuthorityLevel, V5LifecycleStatus, V5Visibility } from "../knowledge-governance-contracts";
import type { RagSourceImportCandidate } from "./source-registry";
import { writeRagSourceImport } from "./source-import-repository";
import { prepareRagSourceImport } from "./source-import-service";
import { AUTOMATIC_CLAIM_EXTRACTOR_VERSION } from "./automatic-knowledge-production";
import { cleanParsedWebMarkdown } from "./automatic-knowledge-production";
import {
  buildManagedNormalizedTextRef,
  buildManagedRawAssetRef,
  buildManagedSourceRevisionId
} from "./managed-content-reference";

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function buildManagedClaimExtractionIdempotencyKey(productId: string, planHash: string) {
  const versionedPlanHash = createHash("sha256")
    .update(`${productId}:${planHash}:${AUTOMATIC_CLAIM_EXTRACTOR_VERSION}`)
    .digest("hex");
  return `managed-claim-extraction:${versionedPlanHash}`;
}

export async function extractManagedClaimsForProduct(productId: string, actor: V5GovernanceActor) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT sa.*, sr.id AS source_revision_id, sr.content_hash AS revision_content_hash,
            sr.normalized_text_ref AS revision_normalized_text_ref, sr.raw_asset_ref AS revision_raw_asset_ref,
            sr.source_updated_at AS revision_source_updated_at, src.normalized_text, src.raw_content,
            src.mime_type AS managed_mime_type, src.original_file_name, kb.name AS knowledge_base_name,
            pe.display_name AS product_name
     FROM source_asset sa
     JOIN knowledge_base_product_link link
       ON link.knowledge_base_id = sa.primary_knowledge_base_id AND link.product_id = ?
      AND link.relation_type = 'supporting' AND link.status = 'active'
     JOIN knowledge_base kb ON kb.id = sa.primary_knowledge_base_id
     JOIN product_entity pe ON pe.id = link.product_id AND pe.status = 'active'
     JOIN source_revision sr ON sr.source_id = sa.id AND sr.parse_status = 'parsed'
     JOIN source_revision_content src ON src.source_revision_id = sr.id
     WHERE sa.status = 'approved_for_claim_extraction' AND sa.safety_status = 'passed'
       AND sr.revision_number = (
         SELECT MAX(latest.revision_number) FROM source_revision latest
         WHERE latest.source_id = sa.id AND latest.parse_status = 'parsed'
       )
     ORDER BY sa.id`,
    [productId]
  );
  if (!rows.length) return { status: "not_applicable" as const, generatedClaims: 0 };

  const candidates = rows.map((row): RagSourceImportCandidate => {
    const monthlySupport = parseV5Json<{ evidenceRoles?: string[]; limitationCodes?: string[] }>(row.monthly_support, {});
    const rawContent = Buffer.isBuffer(row.raw_content) ? row.raw_content : undefined;
    const parsedText = String(row.normalized_text);
    const normalizedText = String(row.document_type) === "workbench_managed_url"
      ? cleanParsedWebMarkdown(parsedText, { productName: String(row.product_name || productId) }).markdown
      : parsedText;
    const contentHash = createHash("sha256").update(normalizedText).digest("hex");
    const sourceRevisionId = buildManagedSourceRevisionId(String(row.id), contentHash);
    return {
      registryId: `workbench-managed:${String(row.primary_knowledge_base_id)}`,
      sourceId: String(row.id),
      productId,
      productName: String(row.product_name || productId),
      knowledgeBaseId: String(row.primary_knowledge_base_id),
      knowledgeBaseName: String(row.knowledge_base_name),
      relativePath: String(row.file_name || row.original_file_name || row.id),
      absolutePath: String(row.revision_raw_asset_ref || row.raw_asset_ref),
      title: String(row.title || row.file_name || row.id),
      canonicalUrl: row.canonical_url ? String(row.canonical_url) : undefined,
      contentHash,
      contentLength: normalizedText.length,
      sourceUpdatedAt: iso(row.revision_source_updated_at || row.source_updated_at || row.updated_at),
      normalizedTextRef: buildManagedNormalizedTextRef(sourceRevisionId),
      rawAssetRef: buildManagedRawAssetRef(sourceRevisionId),
      managedContent: {
        normalizedText,
        rawContent,
        mimeType: row.managed_mime_type ? String(row.managed_mime_type) : undefined,
        originalFileName: row.original_file_name ? String(row.original_file_name) : undefined
      },
      disposition: "production_candidate",
      namespace: "production_public",
      documentType: String(row.document_type),
      authorityLevel: String(row.authority_level) as V5AuthorityLevel,
      lifecycleStatus: String(row.lifecycle_status) as V5LifecycleStatus,
      visibility: String(row.visibility) as V5Visibility,
      allowedEvidenceRoles: monthlySupport.evidenceRoles || [],
      forbiddenUsage: monthlySupport.limitationCodes || [],
      governanceMode: "automatic_policy",
      reason: "Managed Claim extraction resumed by the knowledge refresh worker."
    };
  });
  const plan = prepareRagSourceImport(candidates);
  const stored = await writeRagSourceImport({
    plan,
    idempotencyKey: buildManagedClaimExtractionIdempotencyKey(productId, plan.planHash),
    actor
  });
  const originalBatchIds = [...new Set(rows.map((row) => String(row.batch_id)))];
  await withV5GovernanceTransaction(async (connection) => {
    for (const batchId of originalBatchIds) {
      const [updated] = await connection.query<ResultSetHeader>(
        `UPDATE ingestion_batch
         SET status = 'completed', current_gate = 'G6', success_count = source_count,
             extractor_version = ?, completed_at = COALESCE(completed_at, NOW())
         WHERE id = ? AND status = 'queued_for_claim_extraction'`,
        [AUTOMATIC_CLAIM_EXTRACTOR_VERSION, batchId]
      );
      if (updated.affectedRows === 1) {
        await writeV5GovernanceAudit(connection, {
          ...actor,
          eventType: "managed_claim_extraction_completed",
          objectType: "ingestion_batch",
          objectId: batchId,
          relatedSourceIds: rows.filter((row) => String(row.batch_id) === batchId).map((row) => String(row.id)),
          afterSummary: { status: "completed", currentGate: "G6", generatedClaims: stored.generatedClaims },
          correlationId: batchId
        });
      }
    }
  });
  return { status: stored.replayed ? "replayed" as const : "completed" as const, generatedClaims: stored.generatedClaims, batchIds: originalBatchIds };
}
