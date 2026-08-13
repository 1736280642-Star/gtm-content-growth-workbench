import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  readV5Idempotency,
  parseV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5Idempotency,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "./knowledge-governance-repository";
import { hashV5GovernancePayload, stringifyV5Json } from "./knowledge-governance-repository";
import {
  productGeoStrategyContractVersion,
  assertProductGeoStrategyContentPlanV2,
  resolveProductStrategyDecisionStatus,
  type ProductGeoArticleTypePortfolioItem,
  type ProductGeoStrategyContentPlanV2,
  type ProductGeoStrategyDecision,
  type ProductFixedExpressionRule,
  type ProductGeoStrategyPackRecord,
  type ProductGeoStrategyPackStatus,
  type ProductStrategyArticleTypeVersionRecord
} from "./product-strategy-pack-contracts";

function optionalDate(value: unknown) {
  return value ? new Date(value as string | number | Date).toISOString() : undefined;
}

function mapStrategyArticleTypeVersion(row: RowDataPacket): ProductStrategyArticleTypeVersionRecord {
  return {
    id: String(row.id),
    strategyPackId: String(row.strategy_pack_id),
    productId: String(row.product_id),
    portfolioItemId: String(row.portfolio_item_id),
    origin: String(row.origin) as ProductStrategyArticleTypeVersionRecord["origin"],
    articleTypeId: row.article_type_id ? String(row.article_type_id) : undefined,
    articleTypeVersionId: String(row.article_type_version_id),
    baseArticleTypeId: row.base_article_type_id ? String(row.base_article_type_id) : undefined,
    baseArticleTypeVersionId: row.base_article_type_version_id ? String(row.base_article_type_version_id) : undefined,
    name: String(row.name),
    definition: parseV5Json<ProductGeoArticleTypePortfolioItem>(row.definition_json, {} as ProductGeoArticleTypePortfolioItem),
    definitionHash: String(row.definition_hash),
    status: String(row.status) as ProductStrategyArticleTypeVersionRecord["status"],
    activatedAt: optionalDate(row.activated_at),
    activatedBy: row.activated_by ? String(row.activated_by) : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function readProductStrategyArticleTypeVersions(strategyPackId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM product_strategy_article_type_versions WHERE strategy_pack_id = ? ORDER BY portfolio_item_id",
    [strategyPackId]
  );
  return rows.map(mapStrategyArticleTypeVersion);
}

function mapPack(row: RowDataPacket): ProductGeoStrategyPackRecord {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    strategyVersion: Number(row.strategy_version || 1),
    geoBlueprintId: row.geo_blueprint_id ? String(row.geo_blueprint_id) : undefined,
    sourceSnapshotId: row.source_snapshot_id ? String(row.source_snapshot_id) : undefined,
    contractVersion: String(row.contract_version || "product-geo-strategy.v1"),
    ruleVersion: String(row.rule_version),
    status: String(row.status) as ProductGeoStrategyPackStatus,
    contentPlan: parseV5Json(row.content_plan_json, null),
    contentPlanHash: row.content_plan_hash ? String(row.content_plan_hash) : undefined,
    rowVersion: Number(row.row_version || 1),
    strategyApprovedAt: optionalDate(row.strategy_approved_at),
    strategyApprovedBy: row.strategy_approved_by ? String(row.strategy_approved_by) : undefined,
    rejectedAt: optionalDate(row.rejected_at),
    rejectedBy: row.rejected_by ? String(row.rejected_by) : undefined,
    decisionReason: row.decision_reason ? String(row.decision_reason) : undefined,
    decisionIdempotencyKey: row.decision_idempotency_key ? String(row.decision_idempotency_key) : undefined,
    decisionPayloadHash: row.decision_payload_hash ? String(row.decision_payload_hash) : undefined,
    compiledAt: new Date(row.compiled_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function readLatestProductStrategyPack(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM product_strategy_packs WHERE product_id = ? ORDER BY strategy_version DESC, compiled_at DESC LIMIT 1",
    [productId]
  );
  return rows[0] ? mapPack(rows[0]) : undefined;
}

export async function readCurrentProductStrategyPack(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT pack.*
     FROM product_entity product
     JOIN product_strategy_packs pack ON pack.id = product.strategy_pack_id
     WHERE product.id = ?
     LIMIT 1`,
    [productId]
  );
  return rows[0] ? mapPack(rows[0]) : undefined;
}

export async function compileProductStrategyPack(input: {
  productId: string;
  geoBlueprintId: string;
  sourceSnapshotId: string;
  ruleVersion: string;
  contentPlan: ProductGeoStrategyContentPlanV2;
  actor: V5GovernanceActor;
}) {
  try {
    assertProductGeoStrategyContentPlanV2(input.contentPlan);
  } catch (error) {
    throw new V5GovernanceRepositoryError(
      error instanceof Error ? error.message : "product_strategy_content_plan_invalid",
      "产品 GEO 策略的文章类型组合未通过确定性校验。",
      422
    );
  }
  const digest = hashV5GovernancePayload({
    productId: input.productId,
    geoBlueprintId: input.geoBlueprintId,
    sourceSnapshotId: input.sourceSnapshotId,
    contractVersion: productGeoStrategyContractVersion,
    ruleVersion: input.ruleVersion,
    contentPlan: input.contentPlan
  });
  const id = `strategy-pack-${digest.slice(0, 48)}`;
  return withV5GovernanceTransaction(async (connection) => {
    const [products] = await connection.query<RowDataPacket[]>("SELECT id FROM product_entity WHERE id = ? FOR UPDATE", [input.productId]);
    if (!products[0]) throw new V5GovernanceRepositoryError("product_not_found", "产品不存在。", 404);
    const [existing] = await connection.query<RowDataPacket[]>("SELECT * FROM product_strategy_packs WHERE id = ? FOR UPDATE", [id]);
    if (!existing[0]) {
      const [versions] = await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(MAX(strategy_version), 0) + 1 AS next_version FROM product_strategy_packs WHERE product_id = ?",
        [input.productId]
      );
      const strategyVersion = Number(versions[0]?.next_version || 1);
      await connection.query(
        `INSERT INTO product_strategy_packs
         (id, product_id, strategy_version, geo_blueprint_id, source_snapshot_id, contract_version, rule_version, status,
          content_plan_json, content_plan_hash, row_version, compiled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_strategy_review', ?, ?, 1, NOW())`,
        [
          id,
          input.productId,
          strategyVersion,
          input.geoBlueprintId,
          input.sourceSnapshotId,
          productGeoStrategyContractVersion,
          input.ruleVersion,
          stringifyV5Json(input.contentPlan),
          digest
        ]
      );
      await connection.query(
        `UPDATE product_strategy_packs
         SET status = 'superseded', row_version = row_version + 1
         WHERE product_id = ? AND status IN ('draft', 'pending_strategy_review') AND id <> ?`,
        [input.productId, id]
      );
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "product_strategy_pack_compiled",
        objectType: "product_strategy_pack",
        objectId: id,
        afterSummary: { productId: input.productId, geoBlueprintId: input.geoBlueprintId, sourceSnapshotId: input.sourceSnapshotId },
        correlationId: input.productId
      });
      for (const item of input.contentPlan.articleTypePortfolio) {
        const versionId = item.articleTypeVersionId || `strategy-article-type-version-${hashV5GovernancePayload(item).slice(0, 32)}`;
        const rowId = `strategy-type-${hashV5GovernancePayload({ strategyPackId: id, portfolioItemId: item.portfolioItemId }).slice(0, 48)}`;
        await connection.query(
          `INSERT INTO product_strategy_article_type_versions
           (id, strategy_pack_id, product_id, portfolio_item_id, origin, article_type_id, article_type_version_id,
            base_article_type_id, base_article_type_version_id, name, definition_json, definition_hash, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [
            rowId,
            id,
            input.productId,
            item.portfolioItemId,
            item.origin === "research_recommended" ? "generated" : item.origin,
            item.articleTypeId || null,
            versionId,
            item.baseArticleTypeId || null,
            item.baseArticleTypeVersionId || null,
            item.name,
            stringifyV5Json(item),
            item.definitionHash
          ]
        );
      }
    }
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM product_strategy_packs WHERE id = ?", [id]);
    return { pack: mapPack(saved[0]), replayed: Boolean(existing[0]) };
  });
}

export async function applyProductStrategyPack(input: {
  productId: string;
  strategyPackId: string;
  decision: ProductGeoStrategyDecision;
  expectedVersion: number;
  idempotencyKey: string;
  selectedPortfolioItemIds?: string[];
  fixedExpression?: import("./product-strategy-pack-contracts").ProductFixedExpressionRule;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [packs] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM product_strategy_packs WHERE id = ? AND product_id = ? FOR UPDATE",
      [input.strategyPackId, input.productId]
    );
    const pack = packs[0];
    if (!pack) throw new V5GovernanceRepositoryError("strategy_pack_not_found", "产品策略包不存在。", 404);
    if (!pack.geo_blueprint_id || !pack.source_snapshot_id || !pack.content_plan_json) {
      throw new V5GovernanceRepositoryError("strategy_pack_incomplete", "策略包缺少蓝图、资料快照或内容计划，不能应用。", 409);
    }
    const currentStatus = String(pack.status) as ProductGeoStrategyPackStatus;
    const requestedStatus = input.decision === "approve" ? "strategy_approved" : "rejected";
    const storedPlan = parseV5Json<ProductGeoStrategyContentPlanV2 | null>(pack.content_plan_json, null);
    const [portfolioRows] = await connection.query<RowDataPacket[]>(
      "SELECT portfolio_item_id FROM product_strategy_article_type_versions WHERE strategy_pack_id = ?",
      [input.strategyPackId]
    );
    const allPortfolioIds = portfolioRows.length
      ? portfolioRows.map((item) => String(item.portfolio_item_id))
      : storedPlan?.articleTypePortfolio?.map((item) => item.portfolioItemId) || [];
    const selectedPortfolioItemIds = input.decision === "approve"
      ? [...new Set(input.selectedPortfolioItemIds?.length ? input.selectedPortfolioItemIds : allPortfolioIds)].sort()
      : [];
    const decisionPayloadHash = hashV5GovernancePayload({
      strategyPackId: input.strategyPackId,
      decision: input.decision,
      selectedPortfolioItemIds,
      fixedExpression: input.decision === "approve" ? input.fixedExpression : undefined
    });
    if (String(pack.decision_idempotency_key || "") === input.idempotencyKey && currentStatus === requestedStatus) {
      if (pack.decision_payload_hash && String(pack.decision_payload_hash) !== decisionPayloadHash) {
        throw new V5GovernanceRepositoryError("idempotency_key_reused", "该幂等键已用于不同的策略确认内容。", 409);
      }
      return {
        productId: input.productId,
        strategyPackId: input.strategyPackId,
        applied: input.decision === "approve",
        status: currentStatus,
        rowVersion: Number(pack.row_version || 1),
        replayed: true
      };
    }
    const unknownSelection = selectedPortfolioItemIds.filter((item) => !allPortfolioIds.includes(item));
    if (unknownSelection.length) {
      throw new V5GovernanceRepositoryError("strategy_article_type_selection_invalid", "文章类型选择不属于当前策略包。", 400);
    }
    if (input.decision === "approve" && pack.contract_version === productGeoStrategyContractVersion
      && (selectedPortfolioItemIds.length < 2 || selectedPortfolioItemIds.length > 6)) {
      throw new V5GovernanceRepositoryError("strategy_article_type_portfolio_invalid", "确认策略时必须选择 2-6 种文章类型。", 409);
    }
    const effectivePlan = storedPlan && input.decision === "approve"
      ? {
          ...storedPlan,
          articleTypePortfolio: storedPlan.articleTypePortfolio.filter((item) => selectedPortfolioItemIds.includes(item.portfolioItemId)),
          fixedExpression: input.fixedExpression
        }
      : storedPlan;
    if (Number(pack.row_version || 1) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "strategy_pack_version_conflict",
        `策略包已更新到版本 ${Number(pack.row_version || 1)}，请刷新后重试。`,
        409
      );
    }
    let nextStatus: ProductGeoStrategyPackStatus;
    try {
      nextStatus = resolveProductStrategyDecisionStatus(currentStatus, input.decision);
    } catch {
      throw new V5GovernanceRepositoryError("strategy_pack_not_reviewable", "只有待确认的产品 GEO 策略包可以批准或拒绝。", 409);
    }
    if (input.decision === "approve") {
      await connection.query(
        `UPDATE product_strategy_packs
         SET status = 'superseded', row_version = row_version + 1
         WHERE product_id = ?
           AND status IN ('active', 'strategy_approved', 'pending_sample_review', 'production_ready')
           AND id <> ?`,
        [input.productId, input.strategyPackId]
      );
      await connection.query(
        `UPDATE product_strategy_article_type_versions
         SET status = 'superseded'
         WHERE product_id = ? AND strategy_pack_id <> ? AND status IN ('active', 'frozen', 'evidence_pending')`,
        [input.productId, input.strategyPackId]
      );
    }
    const effectiveContentHash = effectivePlan ? hashV5GovernancePayload(effectivePlan) : String(pack.content_plan_hash || "");
    await connection.query(
      `UPDATE product_strategy_packs
       SET status = ?,
           strategy_approved_at = CASE WHEN ? = 'approve' THEN NOW() ELSE strategy_approved_at END,
           strategy_approved_by = CASE WHEN ? = 'approve' THEN ? ELSE strategy_approved_by END,
           rejected_at = CASE WHEN ? = 'reject' THEN NOW() ELSE rejected_at END,
           rejected_by = CASE WHEN ? = 'reject' THEN ? ELSE rejected_by END,
           decision_reason = ?,
           decision_idempotency_key = ?,
           decision_payload_hash = ?,
           content_plan_json = ?,
           content_plan_hash = ?,
           row_version = row_version + 1
       WHERE id = ?`,
      [
        nextStatus,
        input.decision,
        input.decision,
        input.actor.actorId,
        input.decision,
        input.decision,
        input.actor.actorId,
        input.actor.auditReason,
        input.idempotencyKey,
        decisionPayloadHash,
        stringifyV5Json(effectivePlan),
        effectiveContentHash,
        input.strategyPackId
      ]
    );
    if (input.decision === "approve") {
      await connection.query(
        `UPDATE product_strategy_article_type_versions
         SET status = CASE
               WHEN JSON_UNQUOTE(JSON_EXTRACT(definition_json, '$.evidenceReadiness')) = 'ready'
                 THEN CASE WHEN origin = 'matched' THEN 'frozen' ELSE 'active' END
               ELSE 'evidence_pending'
             END,
             activated_at = CASE
               WHEN JSON_UNQUOTE(JSON_EXTRACT(definition_json, '$.evidenceReadiness')) = 'ready' THEN NOW()
               ELSE NULL
             END,
             activated_by = CASE
               WHEN JSON_UNQUOTE(JSON_EXTRACT(definition_json, '$.evidenceReadiness')) = 'ready' THEN ?
               ELSE NULL
             END
         WHERE strategy_pack_id = ? AND portfolio_item_id IN (?)`,
        [input.actor.actorId, input.strategyPackId, selectedPortfolioItemIds]
      );
      await connection.query(
        `UPDATE product_strategy_article_type_versions
         SET status = 'rejected', rejected_at = NOW()
         WHERE strategy_pack_id = ? AND portfolio_item_id NOT IN (?) AND status = 'draft'`,
        [input.strategyPackId, selectedPortfolioItemIds]
      );
    } else {
      await connection.query(
        `UPDATE product_strategy_article_type_versions
         SET status = 'rejected', rejected_at = NOW()
         WHERE strategy_pack_id = ? AND status = 'draft'`,
        [input.strategyPackId]
      );
    }
    if (input.decision === "approve") {
      await connection.query(
        "UPDATE product_entity SET strategy_pack_id = ?, row_version = row_version + 1 WHERE id = ?",
        [input.strategyPackId, input.productId]
      );
    } else {
      await connection.query(
        "UPDATE product_entity SET strategy_pack_id = NULL, row_version = row_version + 1 WHERE id = ? AND strategy_pack_id = ?",
        [input.productId, input.strategyPackId]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: input.decision === "approve" ? "product_strategy_pack_approved" : "product_strategy_pack_rejected",
      objectType: "product_strategy_pack",
      objectId: input.strategyPackId,
      beforeSummary: { status: String(pack.status) },
      afterSummary: {
        status: nextStatus,
        productId: input.productId,
        rowVersion: Number(pack.row_version || 1) + 1,
        selectedPortfolioItemIds,
        contentPlanHash: effectiveContentHash
      },
      correlationId: input.productId
    });
    return {
      productId: input.productId,
      strategyPackId: input.strategyPackId,
      applied: input.decision === "approve",
      status: nextStatus,
      rowVersion: Number(pack.row_version || 1) + 1,
      replayed: false
    };
  });
}

export async function updateApprovedProductStrategyFixedExpression(input: {
  productId: string;
  strategyPackId: string;
  expectedVersion: number;
  idempotencyKey: string;
  fixedExpression: ProductFixedExpressionRule;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    strategyPackId: input.strategyPackId,
    expectedVersion: input.expectedVersion,
    fixedExpression: input.fixedExpression
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) {
      const [replayedRows] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM product_strategy_packs WHERE id = ? AND product_id = ?",
        [replay.resourceId || input.strategyPackId, input.productId]
      );
      if (!replayedRows[0]) throw new V5GovernanceRepositoryError("strategy_pack_not_found", "产品策略包不存在。", 404);
      return { pack: mapPack(replayedRows[0]), replayed: true };
    }
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT sp.*,
              p.strategy_pack_id AS current_strategy_pack_id,
              EXISTS(SELECT 1 FROM product_sample_article_task task WHERE task.product_strategy_pack_id = sp.id) AS has_sample_task
       FROM product_strategy_packs sp
       JOIN product_entity p ON p.id = sp.product_id
       WHERE sp.id = ? AND sp.product_id = ? FOR UPDATE`,
      [input.strategyPackId, input.productId]
    );
    const pack = rows[0];
    if (!pack) throw new V5GovernanceRepositoryError("strategy_pack_not_found", "产品策略包不存在。", 404);
    if (String(pack.current_strategy_pack_id || "") !== input.strategyPackId
      || !["strategy_approved", "pending_sample_review", "production_ready"].includes(String(pack.status))) {
      throw new V5GovernanceRepositoryError(
        "strategy_fixed_expression_not_editable",
        "只有当前已确认的策略可以补录固定文案。",
        409,
        "请刷新后在当前策略上重试。"
      );
    }
    if (Number(pack.row_version || 1) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("strategy_pack_version_conflict", "策略包版本已经变化，请刷新后重试。", 409);
    }
    const storedPlan = parseV5Json<ProductGeoStrategyContentPlanV2 | null>(pack.content_plan_json, null);
    if (!storedPlan || storedPlan.contractVersion !== productGeoStrategyContractVersion) {
      throw new V5GovernanceRepositoryError("strategy_pack_incomplete", "策略包内容不完整，不能补录固定文案。", 409);
    }
    const nextPlan = { ...storedPlan, fixedExpression: input.fixedExpression };
    const nextHash = hashV5GovernancePayload(nextPlan);
    const requiresRevision = Boolean(pack.has_sample_task) || String(pack.status) !== "strategy_approved";
    if (requiresRevision) {
      const revisionId = `strategy-pack-${hashV5GovernancePayload({
        parentStrategyPackId: input.strategyPackId,
        contentPlanHash: nextHash
      }).slice(0, 48)}`;
      const [versions] = await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(MAX(strategy_version), 0) + 1 AS next_version FROM product_strategy_packs WHERE product_id = ?",
        [input.productId]
      );
      const strategyVersion = Number(versions[0]?.next_version || Number(pack.strategy_version || 1) + 1);
      await connection.query(
        `INSERT INTO product_strategy_packs
         (id, product_id, strategy_version, geo_blueprint_id, source_snapshot_id, contract_version, rule_version, status,
          content_plan_json, content_plan_hash, row_version, strategy_approved_at, strategy_approved_by,
          decision_reason, compiled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'strategy_approved', ?, ?, 1, NOW(), ?, ?, NOW())`,
        [
          revisionId,
          input.productId,
          strategyVersion,
          pack.geo_blueprint_id || null,
          pack.source_snapshot_id || null,
          pack.contract_version,
          pack.rule_version,
          stringifyV5Json(nextPlan),
          nextHash,
          input.actor.actorId,
          input.actor.auditReason
        ]
      );
      const [typeRows] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM product_strategy_article_type_versions WHERE strategy_pack_id = ? ORDER BY portfolio_item_id",
        [input.strategyPackId]
      );
      for (const typeRow of typeRows) {
        const rowId = `strategy-type-${hashV5GovernancePayload({
          strategyPackId: revisionId,
          portfolioItemId: String(typeRow.portfolio_item_id)
        }).slice(0, 48)}`;
        const nextTypeStatus = ["frozen", "active", "evidence_pending"].includes(String(typeRow.status))
          ? String(typeRow.status)
          : "active";
        await connection.query(
          `INSERT INTO product_strategy_article_type_versions
           (id, strategy_pack_id, product_id, portfolio_item_id, origin, article_type_id, article_type_version_id,
            base_article_type_id, base_article_type_version_id, name, definition_json, definition_hash, status,
            activated_at, activated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             CASE WHEN ? IN ('active', 'frozen') THEN NOW() ELSE NULL END,
             CASE WHEN ? IN ('active', 'frozen') THEN ? ELSE NULL END)`,
          [
            rowId,
            revisionId,
            input.productId,
            typeRow.portfolio_item_id,
            typeRow.origin,
            typeRow.article_type_id || null,
            typeRow.article_type_version_id,
            typeRow.base_article_type_id || null,
            typeRow.base_article_type_version_id || null,
            typeRow.name,
            typeof typeRow.definition_json === "string"
              ? typeRow.definition_json
              : stringifyV5Json(typeRow.definition_json),
            typeRow.definition_hash,
            nextTypeStatus,
            nextTypeStatus,
            nextTypeStatus,
            input.actor.actorId
          ]
        );
      }
      await connection.query(
        "UPDATE product_strategy_packs SET status = 'superseded', row_version = row_version + 1 WHERE id = ?",
        [input.strategyPackId]
      );
      await connection.query(
        "UPDATE product_strategy_article_type_versions SET status = 'superseded' WHERE strategy_pack_id = ? AND status <> 'rejected'",
        [input.strategyPackId]
      );
      await connection.query(
        "UPDATE product_entity SET strategy_pack_id = ?, row_version = row_version + 1 WHERE id = ?",
        [revisionId, input.productId]
      );
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "product_strategy_fixed_expression_revised",
        objectType: "product_strategy_pack",
        objectId: revisionId,
        beforeSummary: {
          strategyPackId: input.strategyPackId,
          fixedExpression: storedPlan.fixedExpression,
          status: String(pack.status)
        },
        afterSummary: {
          strategyPackId: revisionId,
          strategyVersion,
          fixedExpression: input.fixedExpression,
          status: "strategy_approved"
        },
        correlationId: input.productId
      });
      await writeV5Idempotency(connection, {
        idempotencyKey: input.idempotencyKey,
        operationType: "revise_product_strategy_fixed_expression",
        requestHash,
        resourceType: "product_strategy_pack",
        resourceId: revisionId,
        responseStatus: "revised",
        responseSummary: { strategyVersion, contentPlanHash: nextHash, previousStrategyPackId: input.strategyPackId }
      });
      const [savedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_strategy_packs WHERE id = ?", [revisionId]);
      return { pack: mapPack(savedRows[0]), replayed: false, revised: true, previousStrategyPackId: input.strategyPackId };
    }
    await connection.query(
      `UPDATE product_strategy_packs
       SET content_plan_json = ?, content_plan_hash = ?, decision_reason = ?, row_version = row_version + 1, updated_at = NOW()
       WHERE id = ?`,
      [stringifyV5Json(nextPlan), nextHash, input.actor.auditReason, input.strategyPackId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_strategy_fixed_expression_updated",
      objectType: "product_strategy_pack",
      objectId: input.strategyPackId,
      beforeSummary: { fixedExpression: storedPlan.fixedExpression, rowVersion: Number(pack.row_version || 1) },
      afterSummary: { fixedExpression: input.fixedExpression, rowVersion: Number(pack.row_version || 1) + 1 },
      correlationId: input.strategyPackId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "update_product_strategy_fixed_expression",
      requestHash,
      resourceType: "product_strategy_pack",
      resourceId: input.strategyPackId,
      responseStatus: "updated",
      responseSummary: { rowVersion: Number(pack.row_version || 1) + 1, contentPlanHash: nextHash }
    });
    const [savedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM product_strategy_packs WHERE id = ?", [input.strategyPackId]);
    return { pack: mapPack(savedRows[0]), replayed: false, revised: false };
  });
}
