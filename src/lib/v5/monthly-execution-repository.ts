import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "./knowledge-governance-repository";
import type {
  ProductionMatrixTask,
  SavePublishResultRequest,
  ScheduleTaskRequest,
  V5MonthlyPlanRecord
} from "./monthly-workspace-contracts";
import { createPublishedContentRetestTasks } from "./capture-repository";

function summarizePlan(record: V5MonthlyPlanRecord) {
  const productQuotas = Object.fromEntries(record.config.groups.map((item) => [item.productId, item.articleQuota]));
  const channelMix: Record<string, number> = {};
  const contentTypeMix: Record<string, number> = {};
  for (const rule of record.config.quotaRules || []) {
    contentTypeMix[rule.contentType] = (contentTypeMix[rule.contentType] || 0) + rule.expandedDeliverableCount;
    for (const [channel, quota] of Object.entries(rule.channelQuotas)) channelMix[channel] = (channelMix[channel] || 0) + quota;
  }
  return { productQuotas, channelMix, contentTypeMix };
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function toDatabaseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function comparableTimestamp(value: unknown) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeChannel(channel: string) {
  const aliases: Record<string, string> = {
    "公众号": "wechat",
    "微信公众号": "wechat",
    "知乎/头条通用稿": "zhihu_toutiao_general"
  };
  return aliases[channel] || channel.toLowerCase();
}

function plannedDate(month: string, index: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String((index % days) + 1).padStart(2, "0")}`;
}

function workspacePlanFromRow(row: RowDataPacket): V5MonthlyPlanRecord {
  const config = parseV5Json<V5MonthlyPlanRecord["config"]>(row.workspace_config, {
    month: String(row.plan_month), businessGoal: "", groups: []
  });
  const timestamp = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || new Date().toISOString());
  return {
    id: String(row.id),
    version: Number(row.version),
    status: String(row.status) === "completed" ? "completed" : ["in_execution", "review_ready"].includes(String(row.status)) ? "running" : String(row.status) === "approved" ? "confirmed" : "draft",
    config,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || timestamp),
    createdBy: String(row.approved_by || "formal_repository"),
    updatedAt: timestamp,
    updatedBy: String(row.approved_by || "formal_repository")
  };
}

export async function persistFormalMonthlyPlan(record: V5MonthlyPlanRecord, actor: V5GovernanceActor, status: "draft" | "pending_strategy_review" | "preserve" = "draft") {
  const summary = summarizePlan(record);
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM monthly_plan WHERE plan_month = ? FOR UPDATE", [record.config.month]);
    const current = rows[0];
    if (current && Number(current.version) === record.version) return workspacePlanFromRow(current);
    if (current && Number(current.version) !== record.version - 1) {
      throw new V5GovernanceRepositoryError("formal_monthly_plan_version_conflict", `正式 MonthlyPlan 当前 version 为 ${current.version}。`, 409, "刷新月度工作区后重试。");
    }
    if (current && ["approved", "in_execution", "review_ready", "completed"].includes(String(current.status)) && status !== "preserve") {
      throw new V5GovernanceRepositoryError("formal_monthly_plan_locked", "正式 MonthlyPlan 已进入执行阶段，不能覆盖配置。", 409);
    }
    const persistedStatus = status === "preserve" && current ? String(current.status) : status;
    const values = [
      stringifyV5Json({ businessGoal: record.config.businessGoal }),
      stringifyV5Json(summary.productQuotas), stringifyV5Json(summary.channelMix), stringifyV5Json(summary.contentTypeMix),
      stringifyV5Json({ targetDeliverableCount: record.config.targetDeliverableCount || 0 }),
      stringifyV5Json(record.config.questionVersionIds || []), stringifyV5Json(record.config)
    ];
    if (current) {
      await connection.query(
        `UPDATE monthly_plan SET status = ?, goals = ?, product_quotas = ?, channel_mix = ?, content_type_mix = ?, publish_frequency = ?,
         question_version_ids = ?, workspace_config = ?, version = ? WHERE id = ? AND version = ?`,
        [persistedStatus, ...values, record.version, String(current.id), Number(current.version)]
      );
    } else {
      if (record.version !== 1) throw new V5GovernanceRepositoryError("formal_monthly_plan_missing", "正式 MonthlyPlan 尚未建立。", 409);
      await connection.query(
        `INSERT INTO monthly_plan
         (id, plan_month, status, goals, product_quotas, channel_mix, content_type_mix, publish_frequency, question_version_ids, workspace_config, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.config.month, persistedStatus, ...values, record.version]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...actor, eventType: "formal_monthly_plan_saved", objectType: "monthly_plan", objectId: record.id,
      afterSummary: { month: record.config.month, status: persistedStatus, version: record.version, targetDeliverableCount: record.config.targetDeliverableCount || 0 },
      correlationId: record.id
    });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM monthly_plan WHERE plan_month = ? LIMIT 1", [record.config.month]);
    return workspacePlanFromRow(saved[0]);
  });
}

export async function persistFormalApprovedStrategy(record: V5MonthlyPlanRecord, actor: V5GovernanceActor) {
  const strategy = record.strategyPackage;
  const tasks = record.matrixTasks || [];
  if (!strategy || !["approved", "partially_approved"].includes(strategy.status)) {
    throw new V5GovernanceRepositoryError("formal_strategy_not_approved", "只有通过策略门禁的策略包可以写入正式矩阵。", 409);
  }
  return withV5GovernanceTransaction(async (connection) => {
    const [planRows] = await connection.query<RowDataPacket[]>("SELECT * FROM monthly_plan WHERE id = ? AND plan_month = ? FOR UPDATE", [record.id, record.config.month]);
    const plan = planRows[0];
    if (!plan) throw new V5GovernanceRepositoryError("formal_monthly_plan_missing", "正式 MonthlyPlan 不存在。", 404, "先保存月度计划并激活生产池。");
    if (Number(plan.version) === record.version && String(plan.strategy_package_version_id) === strategy.strategyPackageId) return workspacePlanFromRow(plan);
    if (Number(plan.version) !== record.version - 1) throw new V5GovernanceRepositoryError("formal_monthly_plan_version_conflict", `正式 MonthlyPlan 当前 version 为 ${plan.version}。`, 409);

    const ruleIds = Array.from(new Set(tasks.map((item) => item.rulePackageVersionId)));
    const placeholders = ruleIds.map(() => "?").join(",");
    const [ruleRows] = ruleIds.length
      ? await connection.query<RowDataPacket[]>(`SELECT id, product_id FROM rule_package_version WHERE id IN (${placeholders}) AND status = 'active' AND immutable_at IS NOT NULL`, ruleIds)
      : [[] as RowDataPacket[]];
    const productByRule = new Map(ruleRows.map((item) => [String(item.id), String(item.product_id)]));
    if (productByRule.size !== ruleIds.length) throw new V5GovernanceRepositoryError("formal_rule_binding_missing", "矩阵引用的正式 active 规则包不存在或未冻结。", 409);
    const productIds = Array.from(new Set(productByRule.values()));
    const poolPlaceholders = productIds.map(() => "?").join(",");
    const [poolRows] = productIds.length
      ? await connection.query<RowDataPacket[]>(`SELECT product_id FROM production_pool_entry WHERE monthly_plan_id = ? AND product_id IN (${poolPlaceholders}) AND status = 'approved'`, [record.id, ...productIds])
      : [[] as RowDataPacket[]];
    const pooled = new Set(poolRows.map((item) => String(item.product_id)));
    if (productIds.some((id) => !pooled.has(id))) throw new V5GovernanceRepositoryError("formal_production_pool_required", "目标产品尚未全部进入正式月度生产池。", 409, "由 product_owner 或 business_owner 激活对应生产池条目后重试。");

    const matrixVersionId = stableId("matrix", `${record.id}:${strategy.strategyPackageId}:${strategy.version}`);
    const itemIds = tasks.map((item) => stableId("matrix-item", `${matrixVersionId}:${item.taskId}`));
    await connection.query(
      `INSERT INTO monthly_strategy_package_version
       (id, monthly_plan_id, version_number, status, product_allocation, channel_allocation, content_type_allocation,
        distilled_term_coverage, evidence_readiness_summary, risks, gaps, rule_validation_result, approved_at, approved_by)
       VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [strategy.strategyPackageId, record.id, strategy.version, stringifyV5Json(summarizePlan(record).productQuotas), stringifyV5Json(summarizePlan(record).channelMix),
        stringifyV5Json(summarizePlan(record).contentTypeMix), stringifyV5Json(record.config.questionVersionIds || []),
        stringifyV5Json(strategy.preflightResults), stringifyV5Json([]), stringifyV5Json(strategy.preflightResults.filter((item) => item.status !== "generatable")),
        stringifyV5Json({ passed: true, approvedBy: actor.actorId }), actor.actorId]
    );
    await connection.query(
      `INSERT INTO content_matrix_version
       (id, monthly_plan_id, version_number, based_on_strategy_package_version_id, status, item_ids, approved_at, approved_by)
       VALUES (?, ?, 1, ?, 'approved', ?, NOW(), ?)`,
      [matrixVersionId, record.id, strategy.strategyPackageId, stringifyV5Json(itemIds), actor.actorId]
    );

    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const productId = productByRule.get(task.rulePackageVersionId)!;
      const channel = normalizeChannel(task.channel);
      const [promptRows] = await connection.query<RowDataPacket[]>(
        `SELECT pg.id AS prompt_group_id, pgv.id AS prompt_group_version_id
         FROM prompt_group pg JOIN prompt_group_version pgv ON pgv.id = pg.active_version_id
         WHERE pg.product_id = ? AND pg.channel = ? AND pg.status = 'approved' AND pgv.status = 'approved' AND pgv.immutable_at IS NOT NULL
         ORDER BY pgv.approved_at DESC LIMIT 1`, [productId, channel]
      );
      const [channelRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM channel_rule_version WHERE channel = ? AND status = 'approved' AND immutable_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1", [channel]
      );
      const publishDate = plannedDate(record.config.month, index);
      await connection.query(
        `INSERT INTO content_matrix_item
         (id, monthly_plan_id, matrix_version_id, publish_date, publish_time, week_index, product_id, channel, content_type,
          platform_content_type, title, target_audience, secondary_distilled_term_ids, knowledge_base_ids, rule_package_version_id,
          prompt_group_id, prompt_group_version_id, channel_rule_version_id, production_scope, platform_expression_snapshot,
          source_problem, question_version_id, status, approved_at, approved_by, version)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'monthly_plan', ?, ?, ?, ?, NOW(), ?, 1)`,
        [itemIds[index], record.id, matrixVersionId, publishDate, Math.floor(index / 7) + 1, productId, channel, task.contentType,
          task.contentType, task.title, stringifyV5Json([]), stringifyV5Json(task.knowledgeBaseIds), task.rulePackageVersionId,
          promptRows[0]?.prompt_group_id || null, promptRows[0]?.prompt_group_version_id || null, channelRows[0]?.id || null,
          stringifyV5Json({ articleTypeProfileVersionId: task.articleTypeProfileVersionId, sourceSnapshotHash: task.sourceSnapshotHash }),
          task.question, task.questionVersionId, task.status === "awaiting_material" ? "evidence_gap" : "approved", actor.actorId]
      );
    }
    await connection.query(
      `UPDATE monthly_plan SET status = 'approved', strategy_package_version_id = ?, matrix_version_id = ?, workspace_config = ?,
       approved_at = NOW(), approved_by = ?, version = ? WHERE id = ? AND version = ?`,
      [strategy.strategyPackageId, matrixVersionId, stringifyV5Json(record.config), actor.actorId, record.version, record.id, Number(plan.version)]
    );
    await writeV5GovernanceAudit(connection, {
      ...actor, eventType: "formal_monthly_strategy_approved", objectType: "content_matrix_version", objectId: matrixVersionId,
      afterSummary: { monthlyPlanId: record.id, strategyPackageVersionId: strategy.strategyPackageId, matrixItemCount: tasks.length }, correlationId: record.id
    });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM monthly_plan WHERE id = ? LIMIT 1", [record.id]);
    return workspacePlanFromRow(saved[0]);
  });
}

export async function scheduleFormalProductionTask(input: {
  month: string; taskId: string; request: ScheduleTaskRequest; actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT i.*, p.plan_month, p.version AS plan_version, p.workspace_config,
        EXISTS(SELECT 1 FROM draft_version d WHERE d.matrix_item_id = i.id AND d.copy_allowed = TRUE AND d.test_only = FALSE) AS has_draft
       FROM content_matrix_item i JOIN monthly_plan p ON p.id = i.monthly_plan_id
       WHERE i.id = ? AND p.plan_month = ? FOR UPDATE`, [input.taskId, input.month]
    );
    const item = rows[0];
    if (!item) throw new V5GovernanceRepositoryError("formal_task_not_found", "正式矩阵项不存在。", 404);
    if (Number(item.plan_version) !== input.request.expectedVersion) throw new V5GovernanceRepositoryError("formal_monthly_plan_version_conflict", `正式 MonthlyPlan 当前 version 为 ${item.plan_version}。`, 409);
    if (!item.has_draft) throw new V5GovernanceRepositoryError("formal_draft_required", "只有已通过规则检查的正式正文可以排程。", 422);
    const scheduledAt = new Date(input.request.scheduledAt);
    await connection.query(
      `UPDATE content_matrix_item SET publish_date = ?, publish_time = ?, scheduled_at = ?, platform_account = ?, status = 'scheduled', version = version + 1 WHERE id = ?`,
      [input.request.scheduledAt.slice(0, 10), input.request.scheduledAt.slice(11, 19), scheduledAt, input.request.platformAccount, input.taskId]
    );
    await connection.query("UPDATE monthly_plan SET status = 'in_execution', version = version + 1 WHERE id = ? AND version = ?", [String(item.monthly_plan_id), Number(item.plan_version)]);
    await writeV5GovernanceAudit(connection, {
      ...input.actor, eventType: "formal_schedule_saved", objectType: "content_matrix_item", objectId: input.taskId,
      afterSummary: { scheduledAt: input.request.scheduledAt, platformAccount: input.request.platformAccount }, correlationId: String(item.monthly_plan_id)
    });
    const [planRows] = await connection.query<RowDataPacket[]>("SELECT * FROM monthly_plan WHERE id = ? LIMIT 1", [String(item.monthly_plan_id)]);
    return workspacePlanFromRow(planRows[0]);
  });
}

export async function removeFormalProductionTasks(input: {
  month: string;
  taskIds: string[];
  expectedVersion: number;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const placeholders = input.taskIds.map(() => "?").join(", ");
    const [planRows] = await connection.query<RowDataPacket[]>("SELECT * FROM monthly_plan WHERE plan_month = ? FOR UPDATE", [input.month]);
    const plan = planRows[0];
    if (!plan) throw new V5GovernanceRepositoryError("formal_monthly_plan_not_found", "正式 MonthlyPlan 不存在。", 404);
    if (Number(plan.version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("formal_monthly_plan_version_conflict", `正式 MonthlyPlan 当前 version 为 ${plan.version}。`, 409);
    const [items] = await connection.query<RowDataPacket[]>(
      `SELECT i.*, pr.status AS publish_result_status
       FROM content_matrix_item i
       LEFT JOIN content_publish_result pr ON pr.matrix_item_id = i.id
       WHERE i.monthly_plan_id = ? AND i.id IN (${placeholders}) FOR UPDATE`,
      [String(plan.id), ...input.taskIds]
    );
    if (!items.length) throw new V5GovernanceRepositoryError("formal_task_not_found", "所选正式矩阵任务不存在或已移除。", 404);
    let archived = 0;
    let deleted = 0;
    for (const item of items) {
      const published = String(item.status) === "published" || String(item.publish_result_status) === "published";
      const nextStatus = published ? "archived" : "cancelled";
      if (published) archived += 1;
      else deleted += 1;
      await connection.query(
        "UPDATE content_matrix_item SET status = ?, scheduled_at = NULL, platform_account = NULL, version = version + 1 WHERE id = ?",
        [nextStatus, String(item.id)]
      );
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: published ? "formal_task_archived" : "formal_task_soft_deleted",
        objectType: "content_matrix_item",
        objectId: String(item.id),
        beforeSummary: { status: String(item.status), scheduledAt: item.scheduled_at, hasPublishedResult: published },
        afterSummary: { status: nextStatus, draftUsableInActiveQueue: false },
        correlationId: String(plan.id)
      });
    }
    const nextVersion = Number(plan.version) + 1;
    await connection.query("UPDATE monthly_plan SET version = ? WHERE id = ? AND version = ?", [nextVersion, String(plan.id), Number(plan.version)]);
    const [remainingRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS remaining FROM content_matrix_item WHERE monthly_plan_id = ? AND status NOT IN ('cancelled', 'archived')", [String(plan.id)]);
    return { archived, deleted, remaining: Number(remainingRows[0]?.remaining || 0), planVersion: nextVersion };
  });
}

export async function saveFormalPublishResult(input: {
  taskId: string; request: SavePublishResultRequest; actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [itemRows] = await connection.query<RowDataPacket[]>(
      `SELECT i.*, p.id AS plan_id FROM content_matrix_item i JOIN monthly_plan p ON p.id = i.monthly_plan_id WHERE i.id = ? FOR UPDATE`, [input.taskId]
    );
    const item = itemRows[0];
    if (!item) throw new V5GovernanceRepositoryError("formal_task_not_found", "正式矩阵项不存在。", 404);
    const [resultRows] = await connection.query<RowDataPacket[]>("SELECT * FROM content_publish_result WHERE matrix_item_id = ? FOR UPDATE", [input.taskId]);
    const current = resultRows[0];
    const currentVersion = current ? Number(current.version) : 0;
    if (currentVersion !== input.request.expectedVersion) throw new V5GovernanceRepositoryError("publish_result_version_conflict", `发布结果当前 version 为 ${currentVersion}。`, 409);
    if (input.request.status === "published" && !/^https?:\/\//i.test(input.request.publicUrl || "")) {
      throw new V5GovernanceRepositoryError("public_url_required", "确认发布时必须填写可访问的 http(s) URL。", 422);
    }
    if (input.request.status !== "published" && !input.request.failureReason?.trim()) {
      throw new V5GovernanceRepositoryError("failure_reason_required", "失败或人工接管必须填写原因。", 422);
    }
    const [draftRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM draft_version WHERE matrix_item_id = ? AND copy_allowed = TRUE AND test_only = FALSE ORDER BY created_at DESC LIMIT 1", [input.taskId]
    );
    const resultId = current ? String(current.id) : `publish-${randomUUID()}`;
    if (current) {
      await connection.query(
        `UPDATE content_publish_result SET draft_version_id = ?, status = ?, public_url = ?, external_content_id = ?, failure_reason = ?, metrics = ?,
         published_at = ?, confirmed_by = ?, version = version + 1 WHERE id = ? AND version = ?`,
        [draftRows[0]?.id || null, input.request.status, input.request.publicUrl || null, input.request.externalContentId || null,
          input.request.failureReason || null, stringifyV5Json(input.request.metrics), input.request.status === "published" ? new Date() : null,
          input.actor.actorId, resultId, currentVersion]
      );
    } else {
      await connection.query(
        `INSERT INTO content_publish_result
         (id, matrix_item_id, draft_version_id, channel, status, public_url, external_content_id, failure_reason, metrics, published_at, confirmed_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [resultId, input.taskId, draftRows[0]?.id || null, String(item.channel), input.request.status, input.request.publicUrl || null,
          input.request.externalContentId || null, input.request.failureReason || null, stringifyV5Json(input.request.metrics),
          input.request.status === "published" ? new Date() : null, input.actor.actorId]
      );
    }
    const matrixStatus = input.request.status === "published" ? "published" : input.request.status === "failed" ? "publish_failed" : "scheduled";
    await connection.query("UPDATE content_matrix_item SET status = ?, version = version + 1 WHERE id = ?", [matrixStatus, input.taskId]);
    const captureTaskIds = input.request.status === "published" ? await createPublishedContentRetestTasks(connection, {
      productId: String(item.product_id),
      question: String(item.source_problem || item.title),
      questionVersionId: item.question_version_id ? String(item.question_version_id) : undefined,
      publishedContentId: input.taskId,
      sourcePublishResultId: resultId
    }) : [];
    const [remainingRows] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS remaining FROM content_matrix_item WHERE monthly_plan_id = ? AND status NOT IN ('published', 'cancelled')", [String(item.plan_id)]
    );
    await connection.query("UPDATE monthly_plan SET status = ? WHERE id = ?", [Number(remainingRows[0]?.remaining || 0) === 0 ? "review_ready" : "in_execution", String(item.plan_id)]);
    await writeV5GovernanceAudit(connection, {
      ...input.actor, eventType: "formal_publish_result_saved", objectType: "content_publish_result", objectId: resultId,
      afterSummary: { taskId: input.taskId, status: input.request.status, publicUrl: input.request.publicUrl, metricKeys: Object.keys(input.request.metrics) },
      correlationId: String(item.plan_id)
    });
    return { publishResultId: resultId, taskId: input.taskId, status: input.request.status, version: currentVersion + 1, publicUrl: input.request.publicUrl, metrics: input.request.metrics, captureTaskIds };
  });
}

export async function backfillFormalPublishJobResult(input: {
  taskId: string;
  status: "published" | "failed" | "manual_takeover";
  publicUrl?: string;
  externalContentId?: string;
  failureReason?: string;
  publishScheduleId?: string;
  publishedAt?: string;
  urlStatus?: string;
  firstPublicObservedAt?: string;
  lastVerifiedAt?: string;
  stablePublishedAt?: string;
  removedAt?: string;
  verificationCount?: number;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [itemRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, monthly_plan_id, product_id, question_version_id, source_problem, title, channel FROM content_matrix_item WHERE id = ? FOR UPDATE",
      [input.taskId]
    );
    const item = itemRows[0];
    if (!item) return { synced: false, reason: "formal_task_not_found" };
    const [resultRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM content_publish_result WHERE matrix_item_id = ? FOR UPDATE",
      [input.taskId]
    );
    const current = resultRows[0];
    const publishedAt = input.status === "published"
      ? toDatabaseDate(input.publishedAt) || current?.published_at || new Date()
      : current?.published_at || null;
    const firstPublicObservedAt = toDatabaseDate(input.firstPublicObservedAt) || current?.first_public_observed_at || null;
    const lastVerifiedAt = toDatabaseDate(input.lastVerifiedAt) || current?.last_verified_at || null;
    const stablePublishedAt = toDatabaseDate(input.stablePublishedAt) || current?.stable_published_at || null;
    const removedAt = toDatabaseDate(input.removedAt) || current?.removed_at || null;
    const verificationCount = Math.max(Number(current?.verification_count || 0), Number(input.verificationCount || 0));
    const unchanged = current
      && String(current.status) === input.status
      && String(current.public_url || "") === String(input.publicUrl || "")
      && String(current.external_content_id || "") === String(input.externalContentId || "")
      && String(current.publish_schedule_id || "") === String(input.publishScheduleId || "")
      && String(current.url_status || "") === String(input.urlStatus || "")
      && comparableTimestamp(current.published_at) === comparableTimestamp(publishedAt)
      && comparableTimestamp(current.first_public_observed_at) === comparableTimestamp(firstPublicObservedAt)
      && comparableTimestamp(current.last_verified_at) === comparableTimestamp(lastVerifiedAt)
      && comparableTimestamp(current.stable_published_at) === comparableTimestamp(stablePublishedAt)
      && comparableTimestamp(current.removed_at) === comparableTimestamp(removedAt)
      && Number(current.verification_count || 0) === verificationCount
      && String(current.failure_reason || "") === String(input.failureReason || "");
    if (unchanged) {
      const captureTaskIds = input.status === "published" ? await createPublishedContentRetestTasks(connection, {
        productId: String(item.product_id), question: String(item.source_problem || item.title),
        questionVersionId: item.question_version_id ? String(item.question_version_id) : undefined,
        publishedContentId: input.taskId, sourcePublishResultId: String(current.id)
      }) : [];
      return { synced: true, unchanged: true, captureTaskIds };
    }
    const resultId = current ? String(current.id) : `publish-${randomUUID()}`;
    const [draftRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM draft_version WHERE matrix_item_id = ? AND copy_allowed = TRUE AND test_only = FALSE ORDER BY created_at DESC LIMIT 1",
      [input.taskId]
    );
    if (current) {
      await connection.query(
        `UPDATE content_publish_result SET draft_version_id = ?, status = ?, public_url = ?, external_content_id = ?,
         publish_schedule_id = ?, url_status = ?, failure_reason = ?, published_at = ?, first_public_observed_at = ?,
         last_verified_at = ?, stable_published_at = ?, removed_at = ?, verification_count = ?,
         confirmed_by = 'publish_job_worker', version = version + 1 WHERE id = ?`,
        [draftRows[0]?.id || null, input.status, input.publicUrl || null, input.externalContentId || null,
          input.publishScheduleId || null, input.urlStatus || null, input.failureReason || null, publishedAt,
          firstPublicObservedAt, lastVerifiedAt, stablePublishedAt, removedAt, verificationCount, resultId]
      );
    } else {
      await connection.query(
        `INSERT INTO content_publish_result
         (id, matrix_item_id, draft_version_id, channel, status, public_url, external_content_id, publish_schedule_id,
          url_status, failure_reason, metrics, published_at, first_public_observed_at, last_verified_at,
          stable_published_at, removed_at, verification_count, confirmed_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'publish_job_worker', 1)`,
        [resultId, input.taskId, draftRows[0]?.id || null, String(item.channel), input.status, input.publicUrl || null,
          input.externalContentId || null, input.publishScheduleId || null, input.urlStatus || null, input.failureReason || null,
          stringifyV5Json({}), publishedAt, firstPublicObservedAt, lastVerifiedAt, stablePublishedAt, removedAt, verificationCount]
      );
    }
    const matrixStatus = input.status === "published" ? "published" : input.status === "failed" ? "publish_failed" : "scheduled";
    await connection.query("UPDATE content_matrix_item SET status = ?, version = version + 1 WHERE id = ?", [matrixStatus, input.taskId]);
    const captureTaskIds = input.status === "published" ? await createPublishedContentRetestTasks(connection, {
      productId: String(item.product_id), question: String(item.source_problem || item.title),
      questionVersionId: item.question_version_id ? String(item.question_version_id) : undefined,
      publishedContentId: input.taskId, sourcePublishResultId: resultId
    }) : [];
    await writeV5GovernanceAudit(connection, {
      actorId: "publish_job_worker",
      actorRole: "system",
      actorType: "system",
      auditReason: "Durable Publish Job lifecycle backfill.",
      eventType: "publish_job_result_backfilled",
      objectType: "content_publish_result",
      objectId: resultId,
      afterSummary: {
        taskId: input.taskId,
        status: input.status,
        publicUrl: input.publicUrl,
        publishScheduleId: input.publishScheduleId,
        urlStatus: input.urlStatus,
        firstPublicObservedAt: input.firstPublicObservedAt,
        lastVerifiedAt: input.lastVerifiedAt,
        stablePublishedAt: input.stablePublishedAt,
        removedAt: input.removedAt,
        verificationCount
      },
      correlationId: String(item.monthly_plan_id)
    });
    return { synced: true, unchanged: false, captureTaskIds };
  });
}

export async function readFormalObservationRows() {
  return withV5GovernanceTransaction(async (connection) => {
    const [plans] = await connection.query<RowDataPacket[]>(
      "SELECT id, plan_month, question_version_ids, workspace_config FROM monthly_plan ORDER BY plan_month"
    );
    const [published] = await connection.query<RowDataPacket[]>(
      `SELECT r.id, r.matrix_item_id, i.question_version_id, i.title, i.channel, r.public_url, r.metrics, r.published_at,
              r.publish_schedule_id, r.url_status, r.first_public_observed_at, r.last_verified_at,
              r.stable_published_at, r.removed_at, r.verification_count
       FROM content_publish_result r JOIN content_matrix_item i ON i.id = r.matrix_item_id WHERE r.status = 'published' ORDER BY r.published_at`
    );
    return { plans, published };
  });
}
