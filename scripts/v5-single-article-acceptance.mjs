import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => arg.startsWith("--base-url="));
const baseUrl = String(baseUrlArg?.split("=").slice(1).join("=") || process.env.V5_SINGLE_ARTICLE_BASE_URL || "http://127.0.0.1:3077").replace(/\/$/, "");
const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingConfig = requiredEnv.filter((name) => !process.env[name]?.trim());

function emit(payload) { process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`); }
function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return fallback; } }
  return value;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

if (missingConfig.length) {
  emit({ ok: false, status: "pending_config", missingConfig, nextAction: "为独立验收环境配置 MySQL 后重试。" });
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectionLimit: 2,
  enableKeepAlive: true
});

try {
  const [taskRows] = await pool.query(
    `SELECT i.id, i.status, i.rule_package_version_id, i.prompt_group_version_id, i.channel_rule_version_id,
      pg.status AS prompt_group_status, pgv.status AS prompt_version_status, pgv.immutable_at AS prompt_immutable_at,
      crv.status AS channel_rule_status, crv.immutable_at AS channel_rule_immutable_at,
      r.status AS rule_status, r.immutable_at AS rule_immutable_at,
      s.id AS active_snapshot_id, m.id AS manifest_id, m.status AS manifest_status
     FROM content_matrix_item i
     JOIN prompt_group pg ON pg.id = i.prompt_group_id AND pg.active_version_id = i.prompt_group_version_id
     JOIN prompt_group_version pgv ON pgv.id = i.prompt_group_version_id
     JOIN channel_rule_version crv ON crv.id = i.channel_rule_version_id
     JOIN rule_package_version r ON r.id = i.rule_package_version_id
     JOIN rag_index_snapshot s ON s.product_id = i.product_id AND s.namespace = 'production_public' AND s.language = 'zh-CN' AND s.status = 'active'
     JOIN rag_ingestion_manifest m ON m.id = s.manifest_id AND m.status = 'approved'
     WHERE i.production_scope = 'single_article_acceptance'`
  );
  assert(taskRows.length === 1, `页面验收范围必须且只能有 1 个正式矩阵项，当前为 ${taskRows.length} 个。`);
  const task = taskRows[0];
  assert(task.prompt_group_status === "approved" && task.prompt_version_status === "approved" && task.prompt_immutable_at, "矩阵项没有绑定已批准并冻结的 Prompt Group。" );
  assert(task.channel_rule_status === "approved" && task.channel_rule_immutable_at, "矩阵项没有绑定已批准并冻结的 ChannelRule。" );
  assert(task.rule_status === "active" && task.rule_immutable_at, "矩阵项没有绑定 active 且冻结的产品规则包。" );
  const idempotencyKey = String(process.env.V5_SINGLE_ARTICLE_ACCEPTANCE_KEY || `acceptance-${task.id}-v1`);
  const [[beforeCountRow]] = await pool.query("SELECT COUNT(*) AS count FROM draft_version WHERE task_id = ? AND test_only = FALSE", [task.id]);
  const request = () => fetch(`${baseUrl}/api/v5/content-tasks/${encodeURIComponent(task.id)}/prepare-and-generate`, { method: "POST", headers: { "x-idempotency-key": idempotencyKey } });
  const firstResponse = await request();
  const first = await firstResponse.json();
  assert(firstResponse.ok && first.ok, `首次正式生成失败：${first.error?.message || firstResponse.status}`);
  const [[afterFirstCountRow]] = await pool.query("SELECT COUNT(*) AS count FROM draft_version WHERE task_id = ? AND test_only = FALSE", [task.id]);
  const retryResponse = await request();
  const retry = await retryResponse.json();
  assert(retryResponse.ok && retry.ok, `同幂等键重试失败：${retry.error?.message || retryResponse.status}`);
  const [[afterRetryCountRow]] = await pool.query("SELECT COUNT(*) AS count FROM draft_version WHERE task_id = ? AND test_only = FALSE", [task.id]);
  assert(first.data.draftVersion.draftVersionId === retry.data.draftVersion.draftVersionId, "同幂等键没有返回原 DraftVersion。");
  assert(Number(afterFirstCountRow.count) === Number(afterRetryCountRow.count), "同幂等键重试新增了 DraftVersion。");
  assert(Number(afterFirstCountRow.count) >= Number(beforeCountRow.count), "DraftVersion 计数异常回退。");
  const draftId = first.data.draftVersion.draftVersionId;
  const [rows] = await pool.query(
    `SELECT d.*, g.status AS generation_status, g.test_only AS generation_test_only,
      g.correlation_id AS generation_correlation_id, g.actor_id AS generation_actor_id, g.audit_reason AS generation_audit_reason,
      o.id AS operation_id, o.correlation_id AS operation_correlation_id, o.actor_id AS operation_actor_id, o.audit_reason AS operation_audit_reason,
      f.decision AS evidence_decision, f.test_only AS evidence_test_only, f.index_snapshot_ids, f.evidence_items,
      rr.status AS retrieval_status
     FROM draft_version d
     JOIN generation_run g ON g.id = d.generation_run_id
     JOIN single_article_operation o ON o.generation_run_id = g.id AND o.draft_version_id = d.id
     JOIN final_evidence_pack f ON f.id = d.final_evidence_pack_id
     JOIN retrieval_run rr ON rr.id = f.retrieval_run_id
     WHERE d.id = ? LIMIT 1`,
    [draftId]
  );
  assert(rows.length === 1, "MySQL 中不存在对应 DraftVersion。" );
  const record = rows[0];
  assert(record.retrieval_status === "completed", "RetrievalRun 未完成。" );
  assert(record.evidence_decision === "generatable", "Final EvidencePack 不是 generatable。" );
  assert(record.generation_status === "completed", "GenerationRun 未完成。" );
  assert(!record.test_only && !record.generation_test_only && !record.evidence_test_only, "正式链路出现 testOnly=true。" );
  assert(record.operation_id === record.operation_correlation_id && record.operation_correlation_id === record.generation_correlation_id, "操作与 GenerationRun 没有使用同一个关联 ID。" );
  assert(record.operation_actor_id && record.operation_audit_reason && record.generation_actor_id && record.generation_audit_reason, "正式操作缺少操作者或审计原因。" );
  const factTraces = parseJson(record.fact_traces, []);
  const evidenceItems = parseJson(record.evidence_items, []);
  const uniqueFactTraces = [...new Map(factTraces.map((trace) => [trace.sentence, trace])).values()];
  assert(uniqueFactTraces.length >= 8, `唯一事实追溯不足 8 条，当前为 ${uniqueFactTraces.length} 条。`);
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  assert(evidenceItems.some((item) => item.allowedUsage?.includes("product_mechanism") && String(item.originalQuote || "").trim()), "EvidencePack 缺少产品事实证据。" );
  assert(evidenceItems.some((item) => item.allowedUsage?.includes("human_boundary") || item.conditions?.length || item.limitations?.length), "EvidencePack 缺少限制或人工边界证据。" );
  for (const trace of uniqueFactTraces.slice(0, 8)) {
    const item = evidenceById.get(trace.evidenceItemId);
    assert(item, `事实追溯引用不存在的 EvidenceItem：${trace.evidenceItemId}`);
    assert(String(record.markdown).includes(trace.sentence), `Markdown 中不存在事实追溯原句：${trace.sentence}`);
    assert(trace.sourceRevisionId === item.sourceRevisionId, "事实追溯的 SourceRevision 不匹配。" );
    assert(trace.claimId === item.primaryClaimId || item.claimIds?.includes(trace.claimId), "事实追溯的 Claim 不匹配。" );
  }
  const sampledClaimIds = [...new Set(uniqueFactTraces.slice(0, 8).map((trace) => trace.claimId))];
  const claimPlaceholders = sampledClaimIds.map(() => "?").join(", ");
  const [claimRows] = await pool.query(
    `SELECT pc.id, pc.source_revision_id, pc.original_quote, sr.normalized_text_ref
     FROM product_claim pc JOIN source_revision sr ON sr.id = pc.source_revision_id
     WHERE pc.id IN (${claimPlaceholders})`,
    sampledClaimIds
  );
  const claimById = new Map(claimRows.map((row) => [String(row.id), row]));
  for (const trace of uniqueFactTraces.slice(0, 8)) {
    const claim = claimById.get(trace.claimId);
    assert(claim, `事实追溯无法回到 ProductClaim：${trace.claimId}`);
    assert(String(claim.source_revision_id) === trace.sourceRevisionId, `ProductClaim 与 SourceRevision 不匹配：${trace.claimId}`);
    assert(String(claim.original_quote || "").trim(), `ProductClaim 缺少原文引用：${trace.claimId}`);
    assert(String(claim.normalized_text_ref || "").trim(), `SourceRevision 缺少原文定位：${trace.sourceRevisionId}`);
  }
  const activeSnapshotIds = parseJson(record.index_snapshot_ids, []);
  assert(activeSnapshotIds.length === 1 && activeSnapshotIds[0] === task.active_snapshot_id, "Final EvidencePack 未绑定当前 active Snapshot。" );
  const draftResponse = await fetch(`${baseUrl}/api/v5/drafts/${encodeURIComponent(draftId)}`, { cache: "no-store" });
  const draftBody = await draftResponse.json();
  assert(draftResponse.ok && draftBody.ok && draftBody.data.draftVersionId === draftId, "Draft API 无法重新读取正式正文。" );
  const v4PageResponse = await fetch(`${baseUrl}/today`, { redirect: "manual" });
  assert(v4PageResponse.ok, "V4 今日发布页面不可访问。" );
  const v4ApiResponse = await fetch(`${baseUrl}/api/content-tasks/__v4_route_probe__/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert((v4ApiResponse.headers.get("content-type") || "").includes("application/json"), "V4 内容生成接口不可访问。" );
  emit({
    ok: true,
    status: "success",
    taskId: String(task.id),
    manifestId: String(task.manifest_id),
    activeSnapshotId: String(task.active_snapshot_id),
    retrievalRunId: String(first.data.retrievalRunId),
    finalEvidencePackId: String(first.data.finalEvidencePackId),
    generationRunId: String(first.data.generationRun.generationRunId),
    draftVersionId: String(draftId),
    traceableFactCount: uniqueFactTraces.length,
    idempotentDraftCount: Number(afterRetryCountRow.count),
    v4RouteStatus: v4ApiResponse.status
  });
} catch (error) {
  emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "单篇验收失败。", nextAction: "根据失败项修复正式数据或服务状态后重试。" });
  process.exitCode = 1;
} finally {
  await pool.end();
}
