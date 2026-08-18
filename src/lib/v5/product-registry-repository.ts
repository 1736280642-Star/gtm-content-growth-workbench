import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { CreateProductRegistryInput, ProductRegistryItem, ProductRegistryStatus, UpdateProductRegistryInput } from "./product-registry-contracts";
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

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function optionalIso(value: unknown) {
  return value ? iso(value) : undefined;
}

function mapProduct(row: RowDataPacket): ProductRegistryItem {
  return {
    productId: String(row.id),
    canonicalName: String(row.canonical_name),
    displayName: String(row.display_name),
    brandName: row.brand_name ? String(row.brand_name) : undefined,
    officialEntity: row.official_entity ? String(row.official_entity) : undefined,
    officialUrl: row.official_url ? String(row.official_url) : undefined,
    productCategory: row.product_category ? String(row.product_category) : undefined,
    entityRelationship: row.entity_relationship ? String(row.entity_relationship) : undefined,
    aliases: parseV5Json<string[]>(row.aliases, []),
    status: String(row.status) as ProductRegistryStatus,
    rowVersion: Number(row.row_version),
    confirmedBy: row.confirmed_by ? String(row.confirmed_by) : undefined,
    confirmedAt: optionalIso(row.confirmed_at),
    isPromoting: Boolean(row.is_promoting),
    promotionStatus: row.promotion_status ? String(row.promotion_status) : undefined,
    strategyPackId: row.strategy_pack_id ? String(row.strategy_pack_id) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export async function updateProductPromotionRecord(input: {
  productId: string;
  isPromoting: boolean;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM product_entity WHERE id = ? FOR UPDATE",
      [input.productId]
    );
    const current = rows[0];
    if (!current || String(current.status) !== "active") {
      throw new V5GovernanceRepositoryError("product_not_found", "未找到可用的产品实体。", 404);
    }
    const promotionStatus = input.isPromoting ? "running" : "paused";
    await connection.query(
      "UPDATE product_entity SET is_promoting = ?, promotion_status = ?, row_version = row_version + 1 WHERE id = ?",
      [input.isPromoting, promotionStatus, input.productId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: input.isPromoting ? "product_promotion_started" : "product_promotion_paused",
      objectType: "product_entity",
      objectId: input.productId,
      beforeSummary: { isPromoting: Boolean(current.is_promoting), promotionStatus: current.promotion_status },
      afterSummary: { isPromoting: input.isPromoting, promotionStatus },
      correlationId: input.productId
    });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ?", [input.productId]);
    return mapProduct(saved[0]);
  });
}

export async function updateProductRegistryRecord(input: {
  productId: string;
  product: UpdateProductRegistryInput;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const aliases = [...new Set([
    input.product.canonicalName.trim(),
    input.product.displayName.trim(),
    ...input.product.aliases.map((item) => item.trim())
  ].filter(Boolean))];
  const request = {
    productId: input.productId,
    expectedVersion: input.expectedVersion,
    product: {
      ...input.product,
      canonicalName: input.product.canonicalName.trim(),
      displayName: input.product.displayName.trim(),
      brandName: input.product.brandName?.trim() || undefined,
      officialEntity: input.product.officialEntity?.trim() || undefined,
      officialUrl: input.product.officialUrl?.trim() || undefined,
      productCategory: input.product.productCategory?.trim() || undefined,
      entityRelationship: input.product.entityRelationship?.trim() || undefined,
      aliases,
      knowledgeProfile: input.product.knowledgeProfile ? {
        positioning: input.product.knowledgeProfile.positioning.map((item) => item.trim()).filter(Boolean),
        audiences: input.product.knowledgeProfile.audiences.map((item) => item.trim()).filter(Boolean),
        capabilities: input.product.knowledgeProfile.capabilities.map((item) => item.trim()).filter(Boolean),
        scenarios: input.product.knowledgeProfile.scenarios.map((item) => item.trim()).filter(Boolean),
        boundaries: input.product.knowledgeProfile.boundaries.map((item) => item.trim()).filter(Boolean),
        sourceFactCount: Math.max(0, Number(input.product.knowledgeProfile.sourceFactCount) || 0)
      } : undefined
    }
  };
  const requestHash = hashV5GovernancePayload(request);

  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      const [savedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ?", [replay.resourceId]);
      if (!savedRows[0]) throw new V5GovernanceRepositoryError("product_not_found", "产品不存在。", 404);
      return { replayed: true, product: mapProduct(savedRows[0]) };
    }

    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ? FOR UPDATE", [input.productId]);
    const current = rows[0];
    if (!current || String(current.status) !== "active") {
      throw new V5GovernanceRepositoryError("product_not_found", "未找到可编辑的产品。", 404);
    }
    if (Number(current.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "product_version_conflict",
        "产品信息已被更新，请刷新后重新编辑。",
        409,
        "刷新产品页面，确认最新信息后再次保存。"
      );
    }
    const [duplicateRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM product_entity WHERE canonical_name = ? AND id <> ? LIMIT 1",
      [request.product.canonicalName, input.productId]
    );
    if (duplicateRows[0]) {
      throw new V5GovernanceRepositoryError("product_already_exists", "同名产品已经存在。", 409, "请使用其他规范名称，或编辑已有产品。");
    }

    await connection.query(
      `UPDATE product_entity
       SET canonical_name = ?, display_name = ?, brand_name = ?, official_entity = ?, official_url = ?,
           product_category = ?, entity_relationship = ?, aliases = ?, row_version = row_version + 1,
           confirmed_by = ?, confirmed_at = NOW()
       WHERE id = ?`,
      [request.product.canonicalName, request.product.displayName, request.product.brandName || null,
        request.product.officialEntity || null, request.product.officialUrl || null,
        request.product.productCategory || null, request.product.entityRelationship || null,
        stringifyV5Json(request.product.aliases),
        input.actor.actorId, input.productId]
    );
    let profileOverrideVersion: number | undefined;
    if (request.product.knowledgeProfile) {
      const [versionRows] = await connection.query<RowDataPacket[]>(
        "SELECT version_number FROM product_knowledge_profile_override_version WHERE product_id = ? ORDER BY version_number DESC LIMIT 1 FOR UPDATE",
        [input.productId]
      );
      profileOverrideVersion = Number(versionRows[0]?.version_number || 0) + 1;
      const profileHash = hashV5GovernancePayload(request.product.knowledgeProfile);
      const overrideId = `profile-override-${hashV5GovernancePayload({ productId: input.productId, profileOverrideVersion, profileHash }).slice(0, 47)}`;
      await connection.query(
        "UPDATE product_knowledge_profile_override_version SET status = 'superseded' WHERE product_id = ? AND status = 'active'",
        [input.productId]
      );
      await connection.query(
        `INSERT INTO product_knowledge_profile_override_version
         (id, product_id, version_number, status, profile_json, profile_hash, source_fact_count,
          approved_by, approved_at, immutable_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NOW(), NOW())`,
        [overrideId, input.productId, profileOverrideVersion, stringifyV5Json(request.product.knowledgeProfile),
          profileHash, request.product.knowledgeProfile.sourceFactCount, input.actor.actorId]
      );
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "product_knowledge_profile_human_corrected",
        objectType: "product_knowledge_profile_override_version",
        objectId: overrideId,
        afterSummary: {
          productId: input.productId,
          versionNumber: profileOverrideVersion,
          profileHash,
          itemCounts: {
            positioning: request.product.knowledgeProfile.positioning.length,
            audiences: request.product.knowledgeProfile.audiences.length,
            capabilities: request.product.knowledgeProfile.capabilities.length,
            scenarios: request.product.knowledgeProfile.scenarios.length,
            boundaries: request.product.knowledgeProfile.boundaries.length
          }
        },
        correlationId: input.productId
      });
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_registry_updated",
      objectType: "product_entity",
      objectId: input.productId,
      beforeSummary: {
        canonicalName: String(current.canonical_name), displayName: String(current.display_name),
        brandName: current.brand_name, officialEntity: current.official_entity,
        officialUrl: current.official_url, productCategory: current.product_category,
        entityRelationship: current.entity_relationship,
        aliases: parseV5Json<string[]>(current.aliases, []), rowVersion: Number(current.row_version)
      },
      afterSummary: {
        ...request.product,
        knowledgeProfile: request.product.knowledgeProfile ? { profileOverrideVersion } : undefined,
        rowVersion: input.expectedVersion + 1
      },
      correlationId: input.productId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "update_product_registry",
      requestHash,
      resourceType: "product_entity",
      resourceId: input.productId,
      responseStatus: "updated",
      responseSummary: { productId: input.productId, rowVersion: input.expectedVersion + 1 }
    });
    const [savedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ?", [input.productId]);
    return { replayed: false, product: mapProduct(savedRows[0]) };
  });
}

function productIdFor(canonicalName: string) {
  const slug = canonicalName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const suffix = createHash("sha256").update(canonicalName).digest("hex").slice(0, 12);
  return `product-${slug || "entity"}-${suffix}`.slice(0, 64);
}

export async function listProductRegistryRecords(input?: { includeInactive?: boolean }) {
  const where = input?.includeInactive ? "" : "WHERE status = 'active'";
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM product_entity ${where} ORDER BY display_name, id`
  );
  return rows.map(mapProduct);
}

export async function readProductRegistryRecord(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM product_entity WHERE id = ? LIMIT 1",
    [productId]
  );
  return rows[0] ? mapProduct(rows[0]) : undefined;
}

export async function assertActiveProductRegistryRecord(productId: string) {
  const product = await readProductRegistryRecord(productId);
  if (!product || product.status !== "active") {
    throw new V5GovernanceRepositoryError(
      "product_not_found",
      "未找到可用的产品实体。",
      404,
      "请先在产品中心新增并确认产品，再导入资料或启动 GEO 调研。"
    );
  }
  if (!product.confirmedBy || !product.confirmedAt) {
    throw new V5GovernanceRepositoryError(
      "product_not_confirmed",
      "产品实体缺少人工确认记录。",
      409,
      "请由产品负责人确认产品身份后再继续。"
    );
  }
  return product;
}

export async function deleteProductKnowledgeBaseRecord(input: {
  productId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    expectedVersion: input.expectedVersion,
    operation: "delete_product_knowledge_base"
  });

  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) {
      return {
        replayed: true,
        productId: input.productId,
        deletedMaterialCount: Number((replay.responseSummary as { deletedMaterialCount?: number }).deletedMaterialCount || 0)
      };
    }

    const [productRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM product_entity WHERE id = ? FOR UPDATE",
      [input.productId]
    );
    const current = productRows[0];
    if (!current || String(current.status) !== "active") {
      throw new V5GovernanceRepositoryError("product_not_found", "未找到可删除的产品知识库。", 404);
    }
    if (Number(current.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "product_version_conflict",
        "产品知识库已被更新，请刷新后重新删除。",
        409,
        "刷新产品知识库列表，确认最新资料后再次删除。"
      );
    }

    const [knowledgeBaseRows] = await connection.query<RowDataPacket[]>(
      "SELECT knowledge_base_id FROM knowledge_base_product_link WHERE product_id = ? AND status = 'active' FOR UPDATE",
      [input.productId]
    );
    const knowledgeBaseIds = knowledgeBaseRows.map((row) => String(row.knowledge_base_id));
    let sourceIds: string[] = [];
    let revisionIds: string[] = [];

    const [indexSnapshotRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, index_name FROM rag_index_snapshot WHERE product_id = ?",
      [input.productId]
    );
    const indexSnapshotIds = indexSnapshotRows.map((row) => String(row.id));
    const indexNames = indexSnapshotRows.map((row) => String(row.index_name)).filter(Boolean);
    if (indexSnapshotIds.length) {
      await connection.query("DELETE FROM rag_chunk_embedding WHERE index_snapshot_id IN (?)", [indexSnapshotIds]);
      await connection.query("DELETE FROM rag_chunk_relation WHERE index_snapshot_id IN (?)", [indexSnapshotIds]);
    }
    await connection.query("DELETE FROM rag_knowledge_chunk WHERE product_id = ?", [input.productId]);
    await connection.query(
      "UPDATE rag_index_snapshot SET status = 'archived', row_version = row_version + 1 WHERE product_id = ?",
      [input.productId]
    );

    if (knowledgeBaseIds.length) {
      const [sourceRows] = await connection.query<RowDataPacket[]>(
        `SELECT DISTINCT member.source_id
         FROM knowledge_base_source_asset member
         WHERE member.knowledge_base_id IN (?)
           AND NOT EXISTS (
             SELECT 1 FROM knowledge_base_source_asset other
             WHERE other.source_id = member.source_id
               AND other.knowledge_base_id NOT IN (?)
           )`,
        [knowledgeBaseIds, knowledgeBaseIds]
      );
      sourceIds = sourceRows.map((row) => String(row.source_id));
    }

    if (sourceIds.length) {
      const [revisionRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM source_revision WHERE source_id IN (?)",
        [sourceIds]
      );
      revisionIds = revisionRows.map((row) => String(row.id));

      if (revisionIds.length) {
        await connection.query("DELETE FROM source_revision_content WHERE source_revision_id IN (?)", [revisionIds]);
        await connection.query("DELETE FROM rule_package_source_revision WHERE source_revision_id IN (?)", [revisionIds]);
        await connection.query("DELETE FROM source_snapshot_item WHERE source_revision_id IN (?)", [revisionIds]);
        await connection.query("DELETE FROM final_evidence_pack_item WHERE source_revision_id IN (?)", [revisionIds]);
      }
      await connection.query("DELETE FROM product_claim WHERE product_id = ? OR source_id IN (?)", [input.productId, sourceIds]);
      await connection.query("DELETE FROM ingestion_batch_source_asset WHERE source_id IN (?)", [sourceIds]);
      await connection.query("DELETE FROM knowledge_base_source_asset WHERE source_id IN (?)", [sourceIds]);
      await connection.query("DELETE FROM source_revision WHERE source_id IN (?)", [sourceIds]);
      await connection.query("DELETE FROM source_asset WHERE id IN (?)", [sourceIds]);
    } else {
      await connection.query("DELETE FROM product_claim WHERE product_id = ?", [input.productId]);
    }

    await connection.query("DELETE FROM knowledge_collection_snapshot WHERE product_id = ?", [input.productId]);
    await connection.query(
      "UPDATE knowledge_collection_source SET enabled = FALSE, default_product_id = NULL, default_product_name = NULL, last_status = 'disabled' WHERE default_product_id = ?",
      [input.productId]
    );
    await connection.query("UPDATE knowledge_base_product_link SET status = 'archived' WHERE product_id = ?", [input.productId]);
    if (knowledgeBaseIds.length) {
      await connection.query(
        `UPDATE knowledge_base kb
         SET status = 'disabled', row_version = row_version + 1
         WHERE kb.id IN (?)
           AND NOT EXISTS (
             SELECT 1 FROM knowledge_base_product_link link
             WHERE link.knowledge_base_id = kb.id AND link.status = 'active'
           )`,
        [knowledgeBaseIds]
      );
    }
    const [sourceSnapshotRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM source_snapshot WHERE product_id = ?",
      [input.productId]
    );
    const sourceSnapshotIds = sourceSnapshotRows.map((row) => String(row.id));
    if (sourceSnapshotIds.length) {
      await connection.query("DELETE FROM source_snapshot_item WHERE source_snapshot_id IN (?)", [sourceSnapshotIds]);
    }
    await connection.query("DELETE FROM source_snapshot WHERE product_id = ?", [input.productId]);
    await connection.query("DELETE FROM product_knowledge_profile_override_version WHERE product_id = ?", [input.productId]);
    await connection.query(
      `UPDATE product_entity
       SET status = 'archived', is_promoting = FALSE, promotion_status = 'paused', strategy_pack_id = NULL,
           row_version = row_version + 1
       WHERE id = ?`,
      [input.productId]
    );

    const deletedMaterialCount = sourceIds.length;
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_knowledge_base_deleted",
      objectType: "product_entity",
      objectId: input.productId,
      beforeSummary: {
        displayName: String(current.display_name),
        status: String(current.status),
        rowVersion: Number(current.row_version)
      },
      afterSummary: {
        status: "archived",
        deletedMaterialCount,
        deletedRevisionCount: revisionIds.length,
        disabledKnowledgeBaseCount: knowledgeBaseIds.length
      },
      correlationId: input.productId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "delete_product_knowledge_base",
      requestHash,
      resourceType: "product_entity",
      resourceId: input.productId,
      responseStatus: "deleted",
      responseSummary: { productId: input.productId, deletedMaterialCount }
    });

    return { replayed: false, productId: input.productId, deletedMaterialCount, indexNames };
  });
}

export async function confirmProductOfficialUrlFromSourceRecord(input: {
  productId: string;
  officialUrl: string;
  sourceIds: string[];
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM product_entity WHERE id = ? FOR UPDATE",
      [input.productId]
    );
    const current = rows[0];
    if (!current || String(current.status) !== "active") {
      throw new V5GovernanceRepositoryError("product_not_found", "未找到可用的产品实体。", 404);
    }
    if (current.official_url) {
      return { updated: false, officialUrl: String(current.official_url), rowVersion: Number(current.row_version) };
    }
    const [sourceRows] = await connection.query<RowDataPacket[]>(
      `SELECT sa.id FROM source_asset sa
       INNER JOIN ingestion_batch ib ON ib.id = sa.batch_id
       WHERE ib.target_product_id = ? AND sa.authority_level = 'A2' AND sa.visibility = 'public'
         AND sa.lifecycle_status = 'current' AND sa.id IN (?)`,
      [input.productId, input.sourceIds]
    );
    if (sourceRows.length !== input.sourceIds.length) {
      throw new V5GovernanceRepositoryError(
        "official_source_not_confirmed",
        "官网候选没有全部通过 A2 公开当前来源校验，产品官网未自动回填。",
        409
      );
    }
    await connection.query(
      "UPDATE product_entity SET official_url = ?, row_version = row_version + 1 WHERE id = ? AND official_url IS NULL",
      [input.officialUrl, input.productId]
    );
    const rowVersion = Number(current.row_version) + 1;
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_official_url_confirmed_from_source",
      objectType: "product_entity",
      objectId: input.productId,
      beforeSummary: { officialUrl: null, rowVersion: Number(current.row_version) },
      afterSummary: { officialUrl: input.officialUrl, sourceIds: input.sourceIds, rowVersion },
      correlationId: input.productId
    });
    return { updated: true, officialUrl: input.officialUrl, rowVersion };
  });
}

export async function confirmProductIdentityFromSourceRecord(input: {
  productId: string;
  sourceIds: string[];
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_entity WHERE id = ? FOR UPDATE", [input.productId]);
    const current = rows[0];
    if (!current || String(current.status) !== "active") {
      throw new V5GovernanceRepositoryError("product_not_found", "未找到可用的产品实体。", 404);
    }
    const [sourceRows] = await connection.query<RowDataPacket[]>(
      `SELECT sa.id FROM source_asset sa
       INNER JOIN ingestion_batch ib ON ib.id = sa.batch_id
       WHERE ib.target_product_id = ? AND sa.authority_level = 'A2' AND sa.visibility = 'public'
         AND sa.lifecycle_status = 'current' AND sa.id IN (?)`,
      [input.productId, input.sourceIds]
    );
    if (sourceRows.length !== input.sourceIds.length) {
      throw new V5GovernanceRepositoryError("official_source_not_confirmed", "产品身份候选未通过 A2 公开当前来源校验，系统未自动回填。", 409);
    }
    const next = {
      brandName: current.brand_name ? String(current.brand_name) : input.brandName?.trim(),
      officialEntity: current.official_entity ? String(current.official_entity) : input.officialEntity?.trim(),
      officialUrl: current.official_url ? String(current.official_url) : input.officialUrl?.trim()
    };
    const changed = (!current.brand_name && Boolean(next.brandName))
      || (!current.official_entity && Boolean(next.officialEntity))
      || (!current.official_url && Boolean(next.officialUrl));
    if (!changed) return { updated: false, ...next, rowVersion: Number(current.row_version) };

    await connection.query(
      `UPDATE product_entity
       SET brand_name = COALESCE(brand_name, ?), official_entity = COALESCE(official_entity, ?),
           official_url = COALESCE(official_url, ?), row_version = row_version + 1
       WHERE id = ?`,
      [next.brandName || null, next.officialEntity || null, next.officialUrl || null, input.productId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_identity_confirmed_from_sources",
      objectType: "product_entity",
      objectId: input.productId,
      relatedSourceIds: input.sourceIds,
      beforeSummary: {
        brandName: current.brand_name, officialEntity: current.official_entity,
        officialUrl: current.official_url, rowVersion: Number(current.row_version)
      },
      afterSummary: { ...next, sourceIds: input.sourceIds, rowVersion: Number(current.row_version) + 1 },
      correlationId: input.productId
    });
    return { updated: true, ...next, rowVersion: Number(current.row_version) + 1 };
  });
}

export async function createProductRegistryRecord(input: {
  product: CreateProductRegistryInput;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const normalizedAliases = [...new Set([
    input.product.canonicalName.trim(),
    input.product.displayName?.trim(),
    ...(input.product.aliases || []).map((item) => item.trim())
  ].filter((item): item is string => Boolean(item)))];
  const request = {
    ...input.product,
    canonicalName: input.product.canonicalName.trim(),
    displayName: input.product.displayName?.trim() || input.product.canonicalName.trim(),
    aliases: normalizedAliases
  };
  const requestHash = hashV5GovernancePayload(request);
  const productId = productIdFor(request.canonicalName);

  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return {
        replayed: true,
        productId: replay.resourceId,
        rowVersion: Number((replay.responseSummary as { rowVersion?: number }).rowVersion || 1)
      };
    }

    const [duplicateRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, canonical_name FROM product_entity WHERE canonical_name = ? LIMIT 1 FOR UPDATE",
      [request.canonicalName]
    );
    if (duplicateRows[0]) {
      throw new V5GovernanceRepositoryError(
        "product_already_exists",
        `产品“${request.canonicalName}”已经存在。`,
        409,
        `请直接使用产品 ${String(duplicateRows[0].id)}，不要重复创建。`
      );
    }

    await connection.query(
      `INSERT INTO product_entity
        (id, canonical_name, display_name, brand_name, official_entity, official_url, product_category,
         entity_relationship, aliases, status, row_version, confirmed_by, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, NOW())`,
      [
        productId,
        request.canonicalName,
        request.displayName,
        request.brandName?.trim() || null,
        request.officialEntity?.trim() || null,
        request.officialUrl?.trim() || null,
        request.productCategory?.trim() || null,
        request.entityRelationship?.trim() || null,
        stringifyV5Json(request.aliases),
        input.actor.actorId
      ]
    );

    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_registry_created",
      objectType: "product_entity",
      objectId: productId,
      afterSummary: {
        canonicalName: request.canonicalName,
        displayName: request.displayName,
        status: "active",
        rowVersion: 1
      },
      correlationId: productId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_product_registry",
      requestHash,
      resourceType: "product_entity",
      resourceId: productId,
      responseStatus: "created",
      responseSummary: { productId, rowVersion: 1 }
    });

    return { replayed: false, productId, rowVersion: 1 };
  });
}
