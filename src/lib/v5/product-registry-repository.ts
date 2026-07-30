import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { CreateProductRegistryInput, ProductRegistryItem, ProductRegistryStatus } from "./product-registry-contracts";
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
    aliases: parseV5Json<string[]>(row.aliases, []),
    status: String(row.status) as ProductRegistryStatus,
    rowVersion: Number(row.row_version),
    confirmedBy: row.confirmed_by ? String(row.confirmed_by) : undefined,
    confirmedAt: optionalIso(row.confirmed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
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
         aliases, status, row_version, confirmed_by, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, NOW())`,
      [
        productId,
        request.canonicalName,
        request.displayName,
        request.brandName?.trim() || null,
        request.officialEntity?.trim() || null,
        request.officialUrl?.trim() || null,
        request.productCategory?.trim() || null,
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
