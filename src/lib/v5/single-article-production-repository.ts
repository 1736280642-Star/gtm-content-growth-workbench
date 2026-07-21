import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { RagFinalEvidencePack } from "./rag/contracts";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import type {
  FormalDraftVersion,
  FormalGenerationRun,
  HardRuleResult,
  SingleArticleActor,
  SingleArticleFailure,
  SingleArticleOperationStatus,
  SingleArticleResult
} from "./single-article-contracts";
import type { BatchQueueItem } from "./monthly-workspace-contracts";

export const SINGLE_ARTICLE_SCOPE = "single_article_acceptance";

export interface FormalGenerationContext {
  taskId: string;
  taskVersion: number;
  promptGroupId: string;
  promptGroupVersionId: string;
  channelRuleVersionId: string;
  rulePackageVersionId: string;
  systemPrompt: string;
  userPromptTemplate: string;
  promptHardRules: unknown;
  allowedExpressions: unknown;
  conditionalExpressions: unknown;
  blockedExpressions: unknown;
  evidenceRequirements: unknown;
  channelRequiredFormat: unknown;
  channelProhibitedPatterns: unknown;
  ctaBoundary: string;
}

export interface SingleArticleOperationRecord {
  operationId: string;
  taskId: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  status: SingleArticleOperationStatus;
  retrievalRunId?: string;
  evidencePreviewId?: string;
  finalEvidencePackId?: string;
  generationRunId?: string;
  draftVersionId?: string;
  errorCode?: string;
  errorMessage?: string;
  nextAction?: string;
}

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

function mapOperation(row: RowDataPacket): SingleArticleOperationRecord {
  return {
    operationId: String(row.id),
    taskId: String(row.task_id),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    correlationId: String(row.correlation_id),
    status: String(row.status) as SingleArticleOperationStatus,
    retrievalRunId: row.retrieval_run_id ? String(row.retrieval_run_id) : undefined,
    evidencePreviewId: row.evidence_preview_id ? String(row.evidence_preview_id) : undefined,
    finalEvidencePackId: row.final_evidence_pack_id ? String(row.final_evidence_pack_id) : undefined,
    generationRunId: row.generation_run_id ? String(row.generation_run_id) : undefined,
    draftVersionId: row.draft_version_id ? String(row.draft_version_id) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    nextAction: row.next_action ? String(row.next_action) : undefined
  };
}

function mapGenerationRun(row: RowDataPacket): FormalGenerationRun {
  return {
    generationRunId: String(row.id),
    taskId: String(row.task_id),
    taskVersion: Number(row.task_version),
    matrixItemId: String(row.matrix_item_id),
    finalEvidencePackId: String(row.final_evidence_pack_id),
    provider: String(row.provider),
    model: row.model ? String(row.model) : undefined,
    status: String(row.status) as FormalGenerationRun["status"],
    correlationId: String(row.correlation_id),
    hardRuleResult: parseV5Json<HardRuleResult>(row.hard_rule_result, { passed: false, blockers: [], checkedRuleCount: 0, traceableFactCount: 0 }),
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    nextAction: row.next_action ? String(row.next_action) : undefined,
    testOnly: false,
    startedAt: asDate(row.started_at) || "",
    completedAt: asDate(row.completed_at)
  };
}

function mapDraft(row: RowDataPacket): FormalDraftVersion {
  return {
    draftVersionId: String(row.id),
    generationRunId: String(row.generation_run_id),
    taskId: String(row.task_id),
    taskVersion: Number(row.task_version),
    matrixItemId: String(row.matrix_item_id),
    finalEvidencePackId: String(row.final_evidence_pack_id),
    rulePackageVersionId: String(row.rule_package_version_id),
    versionNumber: Number(row.version_number),
    title: String(row.title),
    markdown: String(row.markdown),
    factTraces: parseV5Json(row.fact_traces, []),
    hardRuleResult: parseV5Json<HardRuleResult>(row.hard_rule_result, { passed: false, blockers: [], checkedRuleCount: 0, traceableFactCount: 0 }),
    copyAllowed: Boolean(row.copy_allowed),
    testOnly: false,
    createdBy: String(row.created_by),
    createdAt: asDate(row.created_at) || ""
  };
}

export function singleArticleRequestHash(taskId: string) {
  return hashV5GovernancePayload({ operation: "v5_single_article_prepare_and_generate_v1", taskId });
}

export async function claimSingleArticleOperation(input: {
  taskId: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}) {
  const requestHash = singleArticleRequestHash(input.taskId);
  return withV5GovernanceTransaction(async (connection) => {
    const operationId = `single-op-${randomUUID()}`;
    const correlationId = operationId;
    const [inserted] = await connection.query<ResultSetHeader>(
      `INSERT IGNORE INTO single_article_operation
       (id, task_id, idempotency_key, request_hash, correlation_id, status, actor_id, actor_role, audit_reason)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      [operationId, input.taskId, input.idempotencyKey, requestHash, correlationId, input.actor.actorId, input.actor.actorRole, input.actor.auditReason]
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM single_article_operation WHERE task_id = ? AND idempotency_key = ? FOR UPDATE",
      [input.taskId, input.idempotencyKey]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("operation_claim_failed", "无法创建单篇生成操作。", 500);
    if (String(row.request_hash) !== requestHash) {
      throw new V5GovernanceRepositoryError("idempotency_conflict", "同一幂等键已用于不同的正式生成请求。", 409, "使用原请求重试，或为新操作生成新的幂等键。");
    }
    if (inserted.affectedRows === 1) {
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "single_article_operation_started",
        objectType: "single_article_operation",
        objectId: String(row.id),
        afterSummary: { taskId: input.taskId, status: "running" },
        correlationId: String(row.correlation_id)
      });
    }
    return { operation: mapOperation(row), claimed: inserted.affectedRows === 1 };
  });
}

export async function recordSingleArticleEvidence(input: {
  operationId: string;
  retrievalRunId: string;
  evidencePreviewId?: string;
  finalEvidencePackId: string;
  actor: SingleArticleActor;
}) {
  await withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `UPDATE single_article_operation
       SET retrieval_run_id = ?, evidence_preview_id = ?, final_evidence_pack_id = ?
       WHERE id = ? AND status = 'running'`,
      [input.retrievalRunId, input.evidencePreviewId || null, input.finalEvidencePackId, input.operationId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "single_article_evidence_frozen",
      objectType: "single_article_operation",
      objectId: input.operationId,
      afterSummary: {
        retrievalRunId: input.retrievalRunId,
        ...(input.evidencePreviewId ? { evidencePreviewId: input.evidencePreviewId } : {}),
        finalEvidencePackId: input.finalEvidencePackId
      },
      correlationId: input.operationId
    });
  });
}

export async function recordSingleArticleFailure(input: {
  operationId: string;
  status: Exclude<SingleArticleOperationStatus, "running" | "completed">;
  failure: SingleArticleFailure;
  actor: SingleArticleActor;
}) {
  await withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `UPDATE single_article_operation
       SET status = ?, error_code = ?, error_message = ?, next_action = ?, completed_at = NOW()
       WHERE id = ? AND status = 'running'`,
      [input.status, input.failure.code, input.failure.message, input.failure.nextAction, input.operationId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "single_article_operation_failed",
      objectType: "single_article_operation",
      objectId: input.operationId,
      afterSummary: { status: input.status, code: input.failure.code, nextAction: input.failure.nextAction },
      correlationId: input.operationId
    });
  });
}

export async function readFormalGenerationContext(taskId: string): Promise<FormalGenerationContext> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT i.id, i.version AS task_version, i.prompt_group_id, i.prompt_group_version_id, i.channel_rule_version_id, i.rule_package_version_id,
      pg.status AS prompt_group_status, pg.active_version_id, pgv.status AS prompt_version_status,
      pgv.system_prompt, pgv.user_prompt_template, pgv.hard_rules, pgv.immutable_at AS prompt_immutable_at,
      crv.status AS channel_rule_status, crv.required_format, crv.prohibited_patterns, crv.cta_boundary,
      crv.immutable_at AS channel_rule_immutable_at, r.status AS rule_status, r.immutable_at AS rule_immutable_at,
      r.allowed_expressions, r.conditional_expressions, r.blocked_expressions, r.evidence_requirements
     FROM content_matrix_item i
     LEFT JOIN prompt_group pg ON pg.id = i.prompt_group_id
     LEFT JOIN prompt_group_version pgv ON pgv.id = i.prompt_group_version_id
     LEFT JOIN channel_rule_version crv ON crv.id = i.channel_rule_version_id
     LEFT JOIN rule_package_version r ON r.id = i.rule_package_version_id
     WHERE i.id = ? AND i.production_scope = ? LIMIT 1`,
    [taskId, SINGLE_ARTICLE_SCOPE]
  );
  const row = rows[0];
  if (!row) throw new V5GovernanceRepositoryError("formal_task_not_found", "正式单篇矩阵项不存在。", 404, "先运行单篇 Bootstrap，并确认 MySQL 中存在 Pharaoh Command 正式任务。");
  const ready = String(row.prompt_group_status) === "approved"
    && String(row.prompt_version_status) === "approved"
    && String(row.active_version_id) === String(row.prompt_group_version_id)
    && Boolean(row.prompt_immutable_at)
    && String(row.channel_rule_status) === "approved"
    && Boolean(row.channel_rule_immutable_at)
    && String(row.rule_status) === "active"
    && Boolean(row.rule_immutable_at);
  if (!ready) {
    throw new V5GovernanceRepositoryError("formal_rules_not_ready", "Prompt Group、ChannelRule 或产品规则包尚未完成正式冻结。", 409, "完成人工批准并冻结对应版本后重试。");
  }
  return {
    taskId: String(row.id),
    taskVersion: Number(row.task_version),
    promptGroupId: String(row.prompt_group_id),
    promptGroupVersionId: String(row.prompt_group_version_id),
    channelRuleVersionId: String(row.channel_rule_version_id),
    rulePackageVersionId: String(row.rule_package_version_id),
    systemPrompt: String(row.system_prompt),
    userPromptTemplate: String(row.user_prompt_template),
    promptHardRules: parseV5Json(row.hard_rules, []),
    allowedExpressions: parseV5Json(row.allowed_expressions, []),
    conditionalExpressions: parseV5Json(row.conditional_expressions, []),
    blockedExpressions: parseV5Json(row.blocked_expressions, []),
    evidenceRequirements: parseV5Json(row.evidence_requirements, []),
    channelRequiredFormat: parseV5Json(row.required_format, []),
    channelProhibitedPatterns: parseV5Json(row.prohibited_patterns, []),
    ctaBoundary: String(row.cta_boundary)
  };
}

export async function beginFormalGenerationRun(input: {
  operationId: string;
  idempotencyKey: string;
  pack: RagFinalEvidencePack;
  context: FormalGenerationContext;
  provider: string;
  actor: SingleArticleActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const generationRunId = `generation-${randomUUID()}`;
    const startedAt = new Date();
    await connection.query(
      `INSERT INTO generation_run
       (id, task_id, task_version, matrix_item_id, final_evidence_pack_id, prompt_group_version_id, rule_package_version_id,
        channel_rule_version_id, provider, status, correlation_id, idempotency_key, hard_rule_result, actor_id, audit_reason, test_only, started_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', correlation_id, ?, ?, ?, ?, FALSE, ?
       FROM single_article_operation WHERE id = ? AND status = 'running'`,
      [generationRunId, input.pack.taskId, input.pack.taskVersion, input.pack.matrixItemId, input.pack.evidencePackId,
        input.context.promptGroupVersionId, input.context.rulePackageVersionId, input.context.channelRuleVersionId, input.provider,
        input.idempotencyKey, stringifyV5Json({ passed: false, blockers: [], checkedRuleCount: 0, traceableFactCount: 0 }),
        input.actor.actorId, input.actor.auditReason, startedAt, input.operationId]
    );
    await connection.query("UPDATE single_article_operation SET generation_run_id = ? WHERE id = ? AND status = 'running'", [generationRunId, input.operationId]);
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "formal_generation_started",
      objectType: "generation_run",
      objectId: generationRunId,
      afterSummary: { taskId: input.pack.taskId, taskVersion: input.pack.taskVersion, finalEvidencePackId: input.pack.evidencePackId, provider: input.provider, testOnly: false },
      correlationId: input.operationId
    });
    return generationRunId;
  });
}

export async function failFormalGenerationRun(input: {
  operationId: string;
  generationRunId: string;
  status: "pending_config" | "failed";
  failure: SingleArticleFailure;
  hardRuleResult?: HardRuleResult;
  actor: SingleArticleActor;
}) {
  await withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `UPDATE generation_run SET status = ?, hard_rule_result = ?, failure_code = ?, failure_message = ?, next_action = ?, completed_at = NOW()
       WHERE id = ? AND status = 'running'`,
      [input.status, stringifyV5Json(input.hardRuleResult || { passed: false, blockers: [], checkedRuleCount: 0, traceableFactCount: 0 }),
        input.failure.code, input.failure.message, input.failure.nextAction, input.generationRunId]
    );
    await connection.query(
      `UPDATE single_article_operation SET status = ?, error_code = ?, error_message = ?, next_action = ?, completed_at = NOW()
       WHERE id = ? AND status = 'running'`,
      [input.status, input.failure.code, input.failure.message, input.failure.nextAction, input.operationId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "formal_generation_failed",
      objectType: "generation_run",
      objectId: input.generationRunId,
      afterSummary: { status: input.status, code: input.failure.code, nextAction: input.failure.nextAction },
      correlationId: input.operationId
    });
  });
}

export async function completeFormalGeneration(input: {
  operationId: string;
  generationRunId: string;
  pack: RagFinalEvidencePack;
  context: FormalGenerationContext;
  title: string;
  markdown: string;
  factTraces: FormalDraftVersion["factTraces"];
  hardRuleResult: HardRuleResult;
  providerModel?: string;
  actor: SingleArticleActor;
}): Promise<{ generationRun: FormalGenerationRun; draftVersion: FormalDraftVersion }> {
  return withV5GovernanceTransaction(async (connection) => {
    const draftVersionId = `draft-${randomUUID()}`;
    const completedAt = new Date();
    const [versionRows] = await connection.query<RowDataPacket[]>("SELECT COALESCE(MAX(version_number), 0) AS version_number FROM draft_version WHERE task_id = ? FOR UPDATE", [input.pack.taskId]);
    const versionNumber = Number(versionRows[0]?.version_number || 0) + 1;
    await connection.query(
      `INSERT INTO draft_version
       (id, generation_run_id, task_id, task_version, matrix_item_id, final_evidence_pack_id, rule_package_version_id,
        version_number, title, markdown, fact_traces, hard_rule_result, copy_allowed, test_only, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE, ?)`,
      [draftVersionId, input.generationRunId, input.pack.taskId, input.pack.taskVersion, input.pack.matrixItemId, input.pack.evidencePackId,
        input.context.rulePackageVersionId, versionNumber, input.title, input.markdown, stringifyV5Json(input.factTraces), stringifyV5Json(input.hardRuleResult), input.actor.actorId]
    );
    await connection.query(
      "UPDATE generation_run SET model = ?, status = 'completed', hard_rule_result = ?, completed_at = ? WHERE id = ? AND status = 'running'",
      [input.providerModel || null, stringifyV5Json(input.hardRuleResult), completedAt, input.generationRunId]
    );
    await connection.query(
      `UPDATE single_article_operation
       SET status = 'completed', draft_version_id = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
      [draftVersionId, completedAt, input.operationId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "formal_draft_persisted",
      objectType: "draft_version",
      objectId: draftVersionId,
      relatedSourceIds: input.pack.evidenceItems.map((item) => item.sourceRevisionId),
      afterSummary: { generationRunId: input.generationRunId, taskId: input.pack.taskId, taskVersion: input.pack.taskVersion, finalEvidencePackId: input.pack.evidencePackId, traceableFactCount: input.factTraces.length, copyAllowed: true, testOnly: false },
      correlationId: input.operationId
    });
    const [generationRows] = await connection.query<RowDataPacket[]>("SELECT * FROM generation_run WHERE id = ? LIMIT 1", [input.generationRunId]);
    const [draftRows] = await connection.query<RowDataPacket[]>("SELECT * FROM draft_version WHERE id = ? LIMIT 1", [draftVersionId]);
    return { generationRun: mapGenerationRun(generationRows[0]), draftVersion: mapDraft(draftRows[0]) };
  });
}

export async function readFormalDraftVersion(id: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM draft_version WHERE id = ? AND test_only = FALSE LIMIT 1", [id]);
  return rows[0] ? mapDraft(rows[0]) : undefined;
}

export async function readCompletedSingleArticleResult(operation: SingleArticleOperationRecord): Promise<SingleArticleResult | undefined> {
  if (operation.status !== "completed" || !operation.generationRunId || !operation.draftVersionId || !operation.retrievalRunId || !operation.finalEvidencePackId) return undefined;
  const pool = getV5GovernancePool();
  const [generationRows] = await pool.query<RowDataPacket[]>("SELECT * FROM generation_run WHERE id = ? AND test_only = FALSE LIMIT 1", [operation.generationRunId]);
  const [draftRows] = await pool.query<RowDataPacket[]>("SELECT * FROM draft_version WHERE id = ? AND test_only = FALSE LIMIT 1", [operation.draftVersionId]);
  if (!generationRows[0] || !draftRows[0]) return undefined;
  return {
    operationId: operation.operationId,
    correlationId: operation.correlationId,
    replayed: true,
    retrievalRunId: operation.retrievalRunId,
    ...(operation.evidencePreviewId ? { evidencePreviewId: operation.evidencePreviewId } : {}),
    finalEvidencePackId: operation.finalEvidencePackId,
    evidenceDecision: "generatable",
    generationRun: mapGenerationRun(generationRows[0]),
    draftVersion: mapDraft(draftRows[0])
  };
}

export async function readFormalProductionQueue(month: string): Promise<BatchQueueItem[]> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT i.*, p.plan_month, pe.display_name AS product_display_name, pe.canonical_name AS product_canonical_name,
      r.version AS rule_version, f.decision AS evidence_decision, f.evidence_items,
      g.id AS generation_run_id, g.status AS generation_status, g.hard_rule_result, g.failure_message, g.next_action,
      d.id AS draft_version_id
     FROM content_matrix_item i
     JOIN monthly_plan p ON p.id = i.monthly_plan_id
     LEFT JOIN product_entity pe ON pe.id = i.product_id
     LEFT JOIN rule_package_version r ON r.id = i.rule_package_version_id
     LEFT JOIN final_evidence_pack f ON f.id = i.final_evidence_pack_id
     LEFT JOIN generation_run g ON g.id = (
       SELECT g2.id FROM generation_run g2 WHERE g2.matrix_item_id = i.id ORDER BY g2.started_at DESC LIMIT 1
     )
     LEFT JOIN draft_version d ON d.generation_run_id = g.id AND d.test_only = FALSE
     WHERE i.production_scope = ? AND p.plan_month = ?
     ORDER BY i.publish_date, i.created_at LIMIT 1`,
    [SINGLE_ARTICLE_SCOPE, month]
  );
  return rows.map((row) => {
    const decision = row.evidence_decision ? String(row.evidence_decision) : "";
    const generationStatus = row.generation_status ? String(row.generation_status) : "";
    const draftId = row.draft_version_id ? String(row.draft_version_id) : undefined;
    const hardRuleResult = parseV5Json<HardRuleResult>(row.hard_rule_result, { passed: false, blockers: [], checkedRuleCount: 0, traceableFactCount: 0 });
    const evidenceItems = parseV5Json<unknown[]>(row.evidence_items, []);
    const rawEvidencePreview = String(row.evidence_preview_status || "pending_config");
    const evidencePreview: BatchQueueItem["evidencePreview"] = ["ready", "ready_with_auto_downgrade", "needs_material", "needs_review", "blocked", "pending_config"].includes(rawEvidencePreview)
      ? rawEvidencePreview as BatchQueueItem["evidencePreview"]
      : "pending_config";
    const finalEvidenceGate: BatchQueueItem["finalEvidenceGate"] = decision === "generatable" ? "ready"
      : decision === "needs_review" || decision === "generatable_with_downgrade" ? "needs_review"
      : decision === "blocked" || decision === "needs_material" ? "blocked"
      : "not_created";
    const queueGenerationStatus: BatchQueueItem["generationStatus"] = generationStatus === "running" ? "generating"
      : generationStatus === "completed" && draftId ? "generated"
      : generationStatus === "failed" || generationStatus === "pending_config" ? "provider_failed"
      : "pending";
    const displayStatus: BatchQueueItem["displayStatus"] = draftId ? "qualified" : queueGenerationStatus === "generating" ? "generating" : finalEvidenceGate === "ready" ? "ready" : finalEvidenceGate === "blocked" ? "exception" : "preparing";
    return {
      id: String(row.id), monthlyPlanId: String(row.monthly_plan_id), matrixVersionId: String(row.matrix_version_id), matrixItemId: String(row.id),
      title: String(row.title), primaryDistilledTerm: String(row.primary_distilled_term_id || "未设置"), priority: "P0" as const,
      contentType: String(row.content_type), product: String(row.product_display_name || row.product_canonical_name || row.product_id),
      rulePackageVersion: String(row.rule_version || row.rule_package_version_id || ""), channel: String(row.channel),
      platformExpressionType: String(row.platform_content_type || row.content_type), titleConfirmed: ["approved", "ready_for_generation", "generated"].includes(String(row.status)),
      evidencePreview, finalEvidenceGate,
      claimCount: evidenceItems.length, generationStatus: queueGenerationStatus,
      hardRuleStatus: hardRuleResult.passed ? "passed" : generationStatus === "failed" ? "blocked" : "pending",
      qualityResult: hardRuleResult.passed ? "passed" : generationStatus === "failed" ? "exception" : "pending",
      scheduleStatus: "unscheduled" as const, prepublishConfirmed: false, displayStatus,
      formal: true, evidencePackId: row.final_evidence_pack_id ? String(row.final_evidence_pack_id) : undefined,
      draftId, failureReason: row.failure_message ? String(row.failure_message) : undefined,
      nextAction: row.next_action ? String(row.next_action) : undefined
    };
  });
}
