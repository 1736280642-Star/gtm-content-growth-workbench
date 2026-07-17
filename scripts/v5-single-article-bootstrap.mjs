import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
const actorId = String(process.env.V5_SINGLE_ARTICLE_BOOTSTRAP_ACTOR_ID || "single-article-bootstrap").trim();
const actorRole = String(process.env.V5_SINGLE_ARTICLE_BOOTSTRAP_ACTOR_ROLE || "developer_admin").trim();
const auditReason = "Bootstrap one approved Pharaoh Command single-article matrix item";
const month = String(process.env.V5_SINGLE_ARTICLE_MONTH || new Date().toISOString().slice(0, 7)).trim();
const scope = "single_article_acceptance";

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(code, message, nextAction, details = []) {
  const error = new Error(message);
  Object.assign(error, { code, nextAction, details });
  throw error;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function stableSuffix(...parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function firstDistilledTerm(value) {
  const items = parseJson(value, []);
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      for (const field of ["distilledTermId", "termId", "id"]) {
        if (typeof item[field] === "string" && item[field].trim()) return item[field].trim();
      }
    }
  }
  return null;
}

if (missingEnv.length) {
  emit({ ok: false, status: "pending_config", code: "mysql_pending_config", missingConfig: missingEnv, nextAction: "为独立集成环境配置 MySQL 后重试。" });
  process.exit(1);
}

if (!actorId || !["workbench_operator", "developer_admin"].includes(actorRole)) {
  emit({
    ok: false,
    status: "pending_config",
    code: "bootstrap_actor_invalid",
    missingConfig: ["V5_SINGLE_ARTICLE_BOOTSTRAP_ACTOR_ID", "V5_SINGLE_ARTICLE_BOOTSTRAP_ACTOR_ROLE"],
    nextAction: "配置非空操作者，并将角色设为 workbench_operator 或 developer_admin。"
  });
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
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [productRows] = await connection.query(
      `SELECT * FROM product_entity
       WHERE status = 'active' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
         AND (LOWER(canonical_name) LIKE '%pharaoh%command%' OR LOWER(display_name) LIKE '%pharaoh%command%'
           OR LOWER(CAST(aliases AS CHAR)) LIKE '%pharaoh%command%')
       ORDER BY CASE WHEN LOWER(canonical_name) = 'pharaoh command' THEN 0 ELSE 1 END, created_at LIMIT 2`
    );
    if (productRows.length !== 1) {
      fail("pharaoh_product_not_unique", `需要且只能找到一个已确认 Pharaoh Command 产品，当前为 ${productRows.length} 个。`, "完成 Source Import 与产品实体人工确认，并消除重名后重试。");
    }
    const product = productRows[0];
    const [snapshotRows] = await connection.query(
      `SELECT s.*, m.status AS manifest_status, m.active_rule_package_version_id, m.approved_claim_ids,
        m.knowledge_base_ids, m.monthly_production_readiness_id, m.matrix_scope_version
       FROM rag_index_snapshot s JOIN rag_ingestion_manifest m ON m.id = s.manifest_id
       WHERE s.product_id = ? AND s.namespace = 'production_public' AND s.language = 'zh-CN' AND s.status = 'active'
         AND s.immutable_at IS NOT NULL AND m.status = 'approved' AND m.approved_by IS NOT NULL AND m.approved_at IS NOT NULL
       ORDER BY s.activated_at DESC LIMIT 2`,
      [product.id]
    );
    if (snapshotRows.length !== 1) {
      fail("active_snapshot_not_unique", `需要且只能找到一个 active production_public Snapshot，当前为 ${snapshotRows.length} 个。`, "完成 RAG 索引评测与人工激活，并确保同一分区只有一个 active Snapshot。");
    }
    const snapshot = snapshotRows[0];
    const [ruleRows] = await connection.query(
      `SELECT * FROM rule_package_version WHERE id = ? AND product_id = ? AND status = 'active'
       AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND immutable_at IS NOT NULL LIMIT 1`,
      [snapshot.active_rule_package_version_id, product.id]
    );
    if (!ruleRows[0]) fail("active_rule_missing", "active Snapshot 的规则包不是已批准、已冻结的 active 版本。", "完成人工批准与规则包激活后重试。");
    const rule = ruleRows[0];
    const [readinessRows] = await connection.query(
      `SELECT * FROM monthly_production_readiness WHERE id = ? AND product_id = ? AND rule_package_version_id = ?
       AND monthly_production_ready = TRUE AND status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL LIMIT 1`,
      [snapshot.monthly_production_readiness_id, product.id, rule.id]
    );
    if (!readinessRows[0]) fail("monthly_readiness_missing", "Manifest 绑定的 G6 月度生产准入未通过。", "完成月度生产准备度人工批准后重试。");
    const approvedClaimIds = parseJson(snapshot.approved_claim_ids, []).filter((value) => typeof value === "string" && value.trim());
    if (!approvedClaimIds.length) fail("approved_claim_missing", "approved Manifest 未包含可用于标题的 Claim。", "重新生成并批准包含官网产品 Claim 的 Manifest。");
    const claimPlaceholders = approvedClaimIds.map(() => "?").join(", ");
    const [claimRows] = await connection.query(
      `SELECT pc.* FROM product_claim pc
       JOIN source_asset sa ON sa.id = pc.source_id
       WHERE pc.id IN (${claimPlaceholders}) AND pc.product_id = ?
         AND pc.review_status IN ('supported', 'conditional') AND pc.conflict_group_id IS NULL
         AND pc.reviewed_by IS NOT NULL AND pc.reviewed_at IS NOT NULL
         AND pc.authority_level IN ('A1', 'A2')
         AND sa.document_type LIKE 'official_%' AND sa.visibility = 'public' AND sa.lifecycle_status = 'current'
       ORDER BY FIELD(pc.claim_type, 'product_identity', 'positioning', 'capability', 'feature'),
         FIELD(pc.authority_level, 'A1', 'A2'), pc.confidence DESC`,
      [...approvedClaimIds, product.id]
    );
    const titleClaim = claimRows.find((claim) => typeof claim.normalized_claim === "string" && claim.normalized_claim.trim().length <= 500);
    if (!titleClaim) fail("title_claim_missing", "Manifest 中没有适合作为标题的已批准官网 Claim。", "人工批准一条 500 字以内的产品身份或能力 Claim 后重建 Manifest。");
    const manifestScope = String(snapshot.matrix_scope_version || "").trim();
    if (!manifestScope) fail("matrix_scope_missing", "approved Manifest 缺少 matrixScopeVersion。", "按目标矩阵范围重新生成 Manifest。");
    const suffix = stableSuffix(product.id, month, manifestScope);
    const monthlyPlanId = `single-plan-${suffix}`;
    const strategyVersionId = `single-strategy-${suffix}`;
    const numericScope = /^\d+$/.test(manifestScope) ? Number(manifestScope) : undefined;
    if (numericScope !== undefined && (!Number.isSafeInteger(numericScope) || numericScope <= 0)) {
      fail("matrix_scope_invalid", "approved Manifest 的数字 matrixScopeVersion 必须为正整数。", "按目标矩阵版本重新生成并批准 Manifest。");
    }
    if (numericScope === undefined && manifestScope.length > 64) {
      fail("matrix_scope_too_long", "approved Manifest 的 matrixScopeVersion 超过矩阵版本 ID 长度限制。", "使用 64 字符以内的矩阵版本 ID 重建 Manifest。");
    }
    const matrixVersionId = numericScope === undefined ? manifestScope : `single-matrix-${suffix}`;
    const matrixVersionNumber = numericScope || 1;
    const matrixItemId = `single-pharaoh-${suffix}`;
    const productionProfileSuffix = stableSuffix(product.id, "wechat", "explicit_product_intro", "v1.0.0");
    const promptGroupId = `single-prompt-${productionProfileSuffix}`;
    const promptGroupVersionId = `single-prompt-v1-${productionProfileSuffix}`;
    const channelRuleVersionId = `single-wechat-rule-${stableSuffix("wechat", "v1.0.0")}`;
    const now = new Date();
    const promptHardRules = [
      { text: "只使用 Final EvidencePack 中的事实与原文", action: "block" },
      { text: "至少 8 个事实句必须关联 EvidenceItem、Claim 和 SourceRevision", action: "block" },
      { text: "不得把 planned、conditional 或限制条件改写为已全面上线", action: "block" }
    ];
    const channelRuleSnapshot = {
      channelRuleVersionId,
      channel: "wechat",
      requiredFormat: ["Markdown 一级标题", "正文分节", "事实与限制并列呈现", "结尾 CTA 遵守边界"],
      prohibitedPatterns: ["虚构客户案例", "无法由证据支持的绝对化承诺", "伪造性能数字"],
      ctaBoundary: "只允许邀请读者查看已提供的正式产品资料，不承诺 EvidencePack 之外的能力。"
    };
    await connection.query(
      `INSERT INTO prompt_group (id, product_id, name, channel, platform_content_type, status, active_version_id, created_by)
       VALUES (?, ?, 'Pharaoh Command 微信正式产品介绍', 'wechat', 'explicit_product_intro', 'approved', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [promptGroupId, product.id, promptGroupVersionId, actorId]
    );
    await connection.query(
      `INSERT INTO prompt_group_version
       (id, prompt_group_id, version, status, system_prompt, user_prompt_template, hard_rules, created_by, approved_by, approved_at, immutable_at)
       VALUES (?, ?, 'v1.0.0', 'approved', ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [promptGroupVersionId, promptGroupId,
        "你是企业产品内容编辑。你的职责是把已批准证据组织成自然、准确、可审计的中文公众号 Markdown 正文，不得补写证据之外的事实。",
        "围绕冻结标题解释产品是什么、解决什么问题、已证实能力、适用条件与限制。正文服务真实读者，不写治理日志。",
        JSON.stringify(promptHardRules), actorId, actorId, now, now]
    );
    await connection.query(
      `INSERT INTO channel_rule_version
       (id, channel, version, status, required_format, prohibited_patterns, cta_boundary, created_by, approved_by, approved_at, immutable_at)
       VALUES (?, 'wechat', 'v1.0.0', 'approved', ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [channelRuleVersionId, JSON.stringify(channelRuleSnapshot.requiredFormat), JSON.stringify(channelRuleSnapshot.prohibitedPatterns),
        channelRuleSnapshot.ctaBoundary, actorId, actorId, now, now]
    );
    const [promptBindingRows] = await connection.query(
      `SELECT pg.id AS prompt_group_id, pg.active_version_id, pg.status AS prompt_group_status,
        pgv.id AS prompt_group_version_id, pgv.status AS prompt_version_status, pgv.immutable_at AS prompt_immutable_at,
        crv.id AS channel_rule_version_id, crv.status AS channel_rule_status, crv.immutable_at AS channel_rule_immutable_at
       FROM prompt_group pg
       JOIN prompt_group_version pgv ON pgv.id = pg.active_version_id AND pgv.prompt_group_id = pg.id
       JOIN channel_rule_version crv ON crv.id = ?
       WHERE pg.id = ? AND pg.product_id = ? AND pg.channel = 'wechat' AND pg.platform_content_type = 'explicit_product_intro' LIMIT 1`,
      [channelRuleVersionId, promptGroupId, product.id]
    );
    const promptBinding = promptBindingRows[0];
    if (!promptBinding
      || String(promptBinding.prompt_group_version_id) !== promptGroupVersionId
      || String(promptBinding.prompt_group_status) !== "approved"
      || String(promptBinding.prompt_version_status) !== "approved"
      || String(promptBinding.channel_rule_status) !== "approved"
      || !promptBinding.prompt_immutable_at
      || !promptBinding.channel_rule_immutable_at) {
      fail("formal_prompt_binding_conflict", "正式 Prompt Group 或 ChannelRule 与现有唯一作用域冲突。", "检查同产品、渠道和版本的既有正式规则，确认后再运行 Bootstrap。");
    }
    const [existingPlanRows] = await connection.query("SELECT id FROM monthly_plan WHERE plan_month = ? LIMIT 1", [month]);
    if (existingPlanRows[0] && String(existingPlanRows[0].id) !== monthlyPlanId) {
      fail("month_already_owned", `月份 ${month} 已存在其他正式月度计划。`, "设置 V5_SINGLE_ARTICLE_MONTH 为独立验收月份后重试，避免覆盖现有计划。");
    }
    await connection.query(
      `INSERT INTO monthly_plan
       (id, plan_month, status, goals, product_quotas, channel_mix, content_type_mix, publish_frequency,
        strategy_package_version_id, matrix_version_id, approved_at, approved_by, version)
       VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE id = id`,
      [monthlyPlanId, month, JSON.stringify({ businessGoal: "验证 Pharaoh Command 单篇正式内容生产链路" }),
        JSON.stringify({ [product.id]: 1 }), JSON.stringify({ wechat: 1 }), JSON.stringify({ explicit_product_intro: 1 }),
        JSON.stringify({ articleCount: 1 }), strategyVersionId, matrixVersionId, now, actorId]
    );
    await connection.query(
      `INSERT INTO monthly_strategy_package_version
       (id, monthly_plan_id, version_number, status, product_allocation, channel_allocation, content_type_allocation,
        distilled_term_coverage, evidence_readiness_summary, risks, gaps, rule_validation_result, approved_at, approved_by)
       VALUES (?, ?, 1, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [strategyVersionId, monthlyPlanId, JSON.stringify({ [product.id]: 1 }), JSON.stringify({ wechat: 1 }),
        JSON.stringify({ explicit_product_intro: 1 }), JSON.stringify([]), JSON.stringify({ activeSnapshotId: snapshot.id, readinessId: readinessRows[0].id }),
        JSON.stringify([]), JSON.stringify([]), JSON.stringify({ passed: true, rulePackageVersionId: rule.id }), now, actorId]
    );
    const [existingMatrixRows] = await connection.query("SELECT monthly_plan_id, version_number FROM content_matrix_version WHERE id = ? LIMIT 1", [matrixVersionId]);
    if (existingMatrixRows[0] && (String(existingMatrixRows[0].monthly_plan_id) !== monthlyPlanId || Number(existingMatrixRows[0].version_number) !== matrixVersionNumber)) {
      fail("manifest_matrix_scope_conflict", "Manifest matrixScopeVersion 已被其他月度计划占用。", "使用与当前单篇矩阵匹配的 approved Manifest 重建并激活 Snapshot。");
    }
    await connection.query(
      `INSERT INTO content_matrix_version
       (id, monthly_plan_id, version_number, based_on_strategy_package_version_id, status, item_ids, approved_at, approved_by)
       VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [matrixVersionId, monthlyPlanId, matrixVersionNumber, strategyVersionId, JSON.stringify([matrixItemId]), now, actorId]
    );
    const primaryDistilledTermId = firstDistilledTerm(rule.distilled_term_suggestions);
    await connection.query(
      `INSERT INTO content_matrix_item
       (id, monthly_plan_id, matrix_version_id, publish_date, publish_time, week_index, product_id, channel, content_type,
        platform_content_type, title, target_audience, primary_distilled_term_id, secondary_distilled_term_ids, knowledge_base_ids,
        rule_package_version_id, prompt_group_id, prompt_group_version_id, channel_rule_version_id, production_scope,
        platform_expression_snapshot, source_problem, status, approved_at, approved_by, version)
       VALUES (?, ?, ?, ?, '10:00:00', 1, ?, 'wechat', 'explicit_product_intro', 'explicit_product_intro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 1)
       ON DUPLICATE KEY UPDATE id = id`,
      [matrixItemId, monthlyPlanId, matrixVersionId, `${month}-01`, product.id, String(titleClaim.normalized_claim).trim(),
        "正在评估企业 AI 产品与内容生产方案的负责人", primaryDistilledTermId, JSON.stringify([]), JSON.stringify(parseJson(snapshot.knowledge_base_ids, [])),
        rule.id, promptGroupId, promptGroupVersionId, channelRuleVersionId, scope,
        JSON.stringify({ platformContentType: "explicit_product_intro", titleClaimId: titleClaim.id, channelRuleSnapshot }),
        "基于已批准官网证据解释 Pharaoh Command 的产品定位、已证实能力、适用条件与限制。", now, actorId]
    );
    const [bindingRows] = await connection.query(
      `SELECT i.id, i.monthly_plan_id, i.matrix_version_id, i.product_id, i.channel, i.content_type,
        i.platform_content_type, i.rule_package_version_id, i.prompt_group_id, i.prompt_group_version_id,
        i.channel_rule_version_id, i.production_scope, i.status, v.status AS matrix_status, p.status AS plan_status
       FROM content_matrix_item i
       JOIN content_matrix_version v ON v.id = i.matrix_version_id
       JOIN monthly_plan p ON p.id = i.monthly_plan_id
       WHERE i.id = ? LIMIT 1`,
      [matrixItemId]
    );
    const binding = bindingRows[0];
    if (!binding
      || String(binding.monthly_plan_id) !== monthlyPlanId
      || String(binding.matrix_version_id) !== matrixVersionId
      || String(binding.product_id) !== String(product.id)
      || String(binding.channel) !== "wechat"
      || String(binding.content_type) !== "explicit_product_intro"
      || String(binding.platform_content_type) !== "explicit_product_intro"
      || String(binding.rule_package_version_id) !== String(rule.id)
      || String(binding.prompt_group_id) !== promptGroupId
      || String(binding.prompt_group_version_id) !== promptGroupVersionId
      || String(binding.channel_rule_version_id) !== channelRuleVersionId
      || String(binding.production_scope) !== scope
      || String(binding.status) !== "approved"
      || String(binding.matrix_status) !== "approved"
      || String(binding.plan_status) !== "approved") {
      fail("single_item_binding_conflict", "现有正式矩阵项与本次 approved Manifest、规则或任务版本不一致。", "使用独立验收月份，或清理冲突数据后重新运行 Bootstrap。");
    }
    const [scopeRows] = await connection.query("SELECT id FROM content_matrix_item WHERE production_scope = ?", [scope]);
    if (scopeRows.length !== 1 || String(scopeRows[0].id) !== matrixItemId) {
      fail("single_item_invariant_failed", `正式单篇范围必须且只能存在 1 个矩阵项，当前为 ${scopeRows.length} 个。`, "清理重复的验收矩阵项后重新运行 Bootstrap。");
    }
    await connection.query(
      `INSERT INTO governance_audit_event
       (id, event_type, actor_id, actor_role, actor_type, object_type, object_id, related_source_ids, before_summary, after_summary, reason, correlation_id)
       VALUES (?, 'single_article_bootstrapped', ?, ?, 'human', 'content_matrix_item', ?, ?, NULL, ?, ?, ?)`,
      [`audit-${randomUUID()}`, actorId, actorRole, matrixItemId, JSON.stringify([titleClaim.source_revision_id]),
        JSON.stringify({ monthlyPlanId, matrixVersionId, matrixItemId, promptGroupVersionId, channelRuleVersionId, rulePackageVersionId: rule.id, manifestId: snapshot.manifest_id, activeSnapshotId: snapshot.id, titleClaimId: titleClaim.id }),
        auditReason, matrixItemId]
    );
    await connection.commit();
    emit({ ok: true, status: "ready", month, monthlyPlanId, matrixVersionId, matrixItemId, promptGroupVersionId, channelRuleVersionId, rulePackageVersionId: String(rule.id), manifestId: String(snapshot.manifest_id), activeSnapshotId: String(snapshot.id), titleClaimId: String(titleClaim.id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
} catch (error) {
  emit({
    ok: false,
    status: "failed",
    code: error?.code || "single_article_bootstrap_failed",
    message: error instanceof Error ? error.message : "单篇 Bootstrap 失败。",
    nextAction: error?.nextAction || "检查 MySQL 正式治理数据与迁移状态后重试。",
    details: Array.isArray(error?.details) ? error.details : []
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
