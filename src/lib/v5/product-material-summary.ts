import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool } from "./knowledge-governance-repository";

export interface ProductMaterialSummary {
  status: "empty" | "processing" | "ready" | "attention";
  statusLabel: string;
  materialCount: number;
  latestUpdate?: {
    sourceLabel: string;
    sourceType: "url" | "file" | "material";
    sourceUrl?: string;
    updatedAt: string;
  };
}

function iso(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : undefined;
}

export async function readProductMaterialSummary(productId: string): Promise<ProductMaterialSummary> {
  const pool = getV5GovernancePool();
  const [countRows, sourceRows, batchRows] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT source.id) AS material_count
       FROM knowledge_base_product_link product_link
       JOIN knowledge_base_source_asset source_link
         ON source_link.knowledge_base_id = product_link.knowledge_base_id
       JOIN source_asset source ON source.id = source_link.source_id
       WHERE product_link.product_id = ?
         AND product_link.status = 'active'`,
      [productId]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT source.title, source.file_name, source.canonical_url, source.import_method,
              COALESCE(source.source_updated_at, source.updated_at, source.created_at) AS latest_updated_at
       FROM knowledge_base_product_link product_link
       JOIN knowledge_base_source_asset source_link
         ON source_link.knowledge_base_id = product_link.knowledge_base_id
       JOIN source_asset source ON source.id = source_link.source_id
       WHERE product_link.product_id = ?
         AND product_link.status = 'active'
       ORDER BY COALESCE(source.source_updated_at, source.updated_at, source.created_at) DESC
       LIMIT 1`,
      [productId]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT status, current_gate, updated_at
       FROM ingestion_batch
       WHERE target_product_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [productId]
    )
  ]);

  const materialCount = Number(countRows[0][0]?.material_count || 0);
  const latestSource = sourceRows[0][0];
  const latestBatch = batchRows[0][0];
  const batchStatus = latestBatch?.status ? String(latestBatch.status) : undefined;
  const processingStatuses = new Set(["draft", "parsing", "queued", "running", "queued_for_claim_extraction"]);
  const attentionStatuses = new Set(["failed", "cancelled", "pending_config", "awaiting_entity_review"]);
  const status: ProductMaterialSummary["status"] = materialCount === 0
    ? "empty"
    : batchStatus && processingStatuses.has(batchStatus)
      ? "processing"
      : batchStatus && attentionStatuses.has(batchStatus)
        ? "attention"
        : "ready";
  const statusLabel = status === "empty"
    ? "尚未导入"
    : status === "processing"
      ? "资料解析中"
      : status === "attention"
        ? "资料需要处理"
        : "资料已解析";

  const latestUpdatedAt = iso(latestSource?.latest_updated_at || latestBatch?.updated_at);
  const sourceUrl = latestSource?.canonical_url ? String(latestSource.canonical_url) : undefined;
  const fileName = latestSource?.file_name ? String(latestSource.file_name) : undefined;
  const title = latestSource?.title ? String(latestSource.title) : undefined;
  const sourceType: NonNullable<ProductMaterialSummary["latestUpdate"]>["sourceType"] = fileName
    ? "file"
    : sourceUrl
      ? "url"
      : "material";

  return {
    status,
    statusLabel,
    materialCount,
    latestUpdate: latestUpdatedAt ? {
      sourceLabel: fileName || title || sourceUrl || "新增资料",
      sourceType,
      sourceUrl,
      updatedAt: latestUpdatedAt
    } : undefined
  };
}
