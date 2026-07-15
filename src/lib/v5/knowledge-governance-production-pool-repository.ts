import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  readV5Idempotency,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  writeV5Idempotency,
  type V5GovernanceActor
} from "./knowledge-governance-repository";

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

function mapProductionPoolEntry(row: RowDataPacket) {
  return {
    productionPoolEntryId: String(row.id),
    monthlyPlanId: String(row.monthly_plan_id),
    productId: String(row.product_id),
    readinessId: String(row.readiness_id),
    monthlyQuota: Number(row.monthly_quota),
    status: String(row.status),
    version: Number(row.version),
    approvedAt: asDate(row.approved_at),
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    activatedAt: asDate(row.activated_at),
    suspendedAt: asDate(row.suspended_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at)
  };
}

export async function listV5ProductionPoolEntriesRecord(input: { productId: string; monthlyPlanId?: string }) {
  const conditions = ["product_id = ?"];
  const values: unknown[] = [input.productId];
  if (input.monthlyPlanId) {
    conditions.push("monthly_plan_id = ?");
    values.push(input.monthlyPlanId);
  }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM production_pool_entry WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, id`,
    values
  );
  return rows.map(mapProductionPoolEntry);
}

export async function activateV5ProductionPoolEntryRecord(input: {
  productId: string;
  monthlyPlanId: string;
  monthlyQuota: number;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    monthlyPlanId: input.monthlyPlanId,
    monthlyQuota: input.monthlyQuota,
    expectedVersion: input.expectedVersion,
    actorId: input.actor.actorId
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      const summary = replay.responseSummary as Record<string, unknown>;
      return {
        replayed: true,
        productionPoolEntryId: replay.resourceId,
        productId: input.productId,
        monthlyPlanId: input.monthlyPlanId,
        readinessId: String(summary.readinessId),
        rulePackageVersionId: String(summary.rulePackageVersionId),
        sourceSnapshotHash: String(summary.sourceSnapshotHash),
        monthlyQuota: Number(summary.monthlyQuota),
        status: "approved",
        version: Number(summary.version)
      };
    }

    const [planRows] = await connection.query<RowDataPacket[]>("SELECT id, status FROM monthly_plan WHERE id = ? FOR UPDATE", [input.monthlyPlanId]);
    const plan = planRows[0];
    if (!plan) {
      throw new V5GovernanceRepositoryError(
        "monthly_plan_not_found",
        "MonthlyPlan 不存在，不能创建脱离月度计划的生产池条目。",
        404,
        "先创建该月份的 MonthlyPlan，再选择准入产品。"
      );
    }

    const [activeVersionRows] = await connection.query<RowDataPacket[]>(
      `SELECT v.id, v.source_snapshot_hash
       FROM product_expression_rule_package p
       JOIN rule_package_version v ON v.id = p.active_version_id
       WHERE p.product_id = ? AND p.status = 'active' AND v.status = 'active'
       LIMIT 1 FOR UPDATE`,
      [input.productId]
    );
    const activeVersion = activeVersionRows[0];
    if (!activeVersion) {
      throw new V5GovernanceRepositoryError(
        "active_rule_package_required",
        "产品没有 active 规则包，不能进入月度生产池。",
        409,
        "完成规则差异人工复核并通过 G5 后再重试。"
      );
    }

    const [readinessRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM monthly_production_readiness
       WHERE product_id = ? AND rule_package_version_id = ?
       LIMIT 1 FOR UPDATE`,
      [input.productId, String(activeVersion.id)]
    );
    const readiness = readinessRows[0];
    if (!readiness || !Boolean(readiness.monthly_production_ready) || String(readiness.status) !== "approved" || !readiness.approved_at || !readiness.approved_by) {
      throw new V5GovernanceRepositoryError(
        "monthly_readiness_required",
        "当前 active 规则包没有已批准且为 true 的 MonthlyProductionReadiness。",
        409,
        "修复 G6 阻断项并重新评估准备度；不得人工跳过。"
      );
    }
    const sourceSnapshotId = readiness.source_snapshot_id ? String(readiness.source_snapshot_id) : "";
    const sourceSnapshotHash = readiness.source_snapshot_hash ? String(readiness.source_snapshot_hash) : "";
    if (!sourceSnapshotId || !sourceSnapshotHash || sourceSnapshotHash !== String(activeVersion.source_snapshot_hash)) {
      throw new V5GovernanceRepositoryError(
        "snapshot_mismatch",
        "准备度没有绑定与 active 规则包一致的固定来源快照。",
        409,
        "基于当前 active 规则包的 source_snapshot 重新执行 G6。"
      );
    }
    const [snapshotRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM source_snapshot WHERE id = ? AND product_id = ? AND snapshot_hash = ? LIMIT 1 FOR UPDATE",
      [sourceSnapshotId, input.productId, sourceSnapshotHash]
    );
    if (!snapshotRows[0]) {
      throw new V5GovernanceRepositoryError("snapshot_missing", "准备度引用的 source_snapshot 不存在。", 409);
    }
    const maxMonthlyQuota = readiness.max_monthly_quota === null ? undefined : Number(readiness.max_monthly_quota);
    if (!maxMonthlyQuota || input.monthlyQuota > maxMonthlyQuota) {
      throw new V5GovernanceRepositoryError(
        "quota_exceeds_readiness",
        `月度配额 ${input.monthlyQuota} 超过准备度上限 ${maxMonthlyQuota ?? "未配置"}。`,
        409,
        "降低配额，或补充证据后重新评估 maxMonthlyQuota。"
      );
    }

    const [entryRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM production_pool_entry WHERE monthly_plan_id = ? AND product_id = ? FOR UPDATE",
      [input.monthlyPlanId, input.productId]
    );
    const existing = entryRows[0];
    const currentVersion = existing ? Number(existing.version) : 0;
    if (currentVersion !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `生产池条目当前 version 为 ${currentVersion}。`,
        409,
        "刷新该产品在当前 MonthlyPlan 的生产池状态后重试。"
      );
    }

    const productionPoolEntryId = existing ? String(existing.id) : `production-pool-${randomUUID()}`;
    if (existing) {
      await connection.query(
        `UPDATE production_pool_entry
         SET readiness_id = ?, monthly_quota = ?, status = 'approved', approved_at = NOW(), approved_by = ?, activated_at = NOW(), suspended_at = NULL, version = version + 1
         WHERE id = ? AND version = ?`,
        [String(readiness.id), input.monthlyQuota, input.actor.actorId, productionPoolEntryId, input.expectedVersion]
      );
    } else {
      await connection.query(
        `INSERT INTO production_pool_entry
          (id, monthly_plan_id, product_id, readiness_id, monthly_quota, status, version, approved_at, approved_by, activated_at, suspended_at)
         VALUES (?, ?, ?, ?, ?, 'approved', 1, NOW(), ?, NOW(), NULL)`,
        [productionPoolEntryId, input.monthlyPlanId, input.productId, String(readiness.id), input.monthlyQuota, input.actor.actorId]
      );
    }
    const nextVersion = currentVersion + 1;
    const responseSummary = {
      readinessId: String(readiness.id),
      rulePackageVersionId: String(activeVersion.id),
      sourceSnapshotHash,
      monthlyQuota: input.monthlyQuota,
      maxMonthlyQuota,
      version: nextVersion
    };
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "production_pool_activated",
      objectType: "production_pool_entry",
      objectId: productionPoolEntryId,
      beforeSummary: existing
        ? { status: String(existing.status), version: currentVersion, readinessId: String(existing.readiness_id) }
        : undefined,
      afterSummary: { status: "approved", monthlyPlanStatus: String(plan.status), ...responseSummary },
      correlationId: input.monthlyPlanId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "activate_production_pool_entry",
      requestHash,
      resourceType: "production_pool_entry",
      resourceId: productionPoolEntryId,
      responseStatus: "approved",
      responseSummary
    });
    return {
      replayed: false,
      productionPoolEntryId,
      productId: input.productId,
      monthlyPlanId: input.monthlyPlanId,
      status: "approved",
      ...responseSummary
    };
  });
}

export async function suspendV5ProductionPoolEntryRecord(input: {
  productId: string;
  monthlyPlanId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    monthlyPlanId: input.monthlyPlanId,
    expectedVersion: input.expectedVersion,
    actorId: input.actor.actorId
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      const summary = replay.responseSummary as Record<string, unknown>;
      return {
        replayed: true,
        productionPoolEntryId: replay.resourceId,
        productId: input.productId,
        monthlyPlanId: input.monthlyPlanId,
        status: "blocked",
        version: Number(summary.version)
      };
    }
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM production_pool_entry WHERE monthly_plan_id = ? AND product_id = ? FOR UPDATE",
      [input.monthlyPlanId, input.productId]
    );
    const entry = rows[0];
    if (!entry) throw new V5GovernanceRepositoryError("not_found", "生产池条目不存在。", 404);
    if (Number(entry.version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `生产池条目当前 version 为 ${entry.version}。`, 409);
    }
    if (String(entry.status) !== "approved") {
      throw new V5GovernanceRepositoryError("invalid_state", "只有 approved 生产池条目可以暂停。", 409);
    }
    await connection.query(
      "UPDATE production_pool_entry SET status = 'blocked', suspended_at = NOW(), version = version + 1 WHERE id = ? AND version = ?",
      [String(entry.id), input.expectedVersion]
    );
    const nextVersion = input.expectedVersion + 1;
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "production_pool_suspended",
      objectType: "production_pool_entry",
      objectId: String(entry.id),
      beforeSummary: { status: "approved", version: input.expectedVersion, readinessId: String(entry.readiness_id) },
      afterSummary: { status: "blocked", version: nextVersion },
      correlationId: input.monthlyPlanId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "suspend_production_pool_entry",
      requestHash,
      resourceType: "production_pool_entry",
      resourceId: String(entry.id),
      responseStatus: "blocked",
      responseSummary: { version: nextVersion }
    });
    return {
      replayed: false,
      productionPoolEntryId: String(entry.id),
      productId: input.productId,
      monthlyPlanId: input.monthlyPlanId,
      status: "blocked",
      version: nextVersion
    };
  });
}
