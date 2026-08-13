import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import type { SingleArticleActor } from "./single-article-contracts";
import { prepareAndGenerateSingleArticle } from "./single-article-production-service";

const sampleScope = "product_sample_calibration";

function firstDistilledTerm(value: unknown) {
  const items = parseV5Json<unknown[]>(value, []);
  for (const item of items) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const field of ["distilledTermId", "termId", "id"]) {
        if (typeof record[field] === "string" && record[field].trim()) return record[field].trim();
      }
    }
  }
  return undefined;
}

export function createProductSampleStableId(prefix: string, value: unknown) {
  const hashLength = Math.max(8, 64 - prefix.length - 1);
  return `${prefix}-${hashV5GovernancePayload(value).slice(0, hashLength)}`;
}

export function selectRepresentativeSampleQuestion(definition: Record<string, unknown>, productName: string) {
  const questions = Array.isArray(definition.suitableQuestions)
    ? definition.suitableQuestions.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const selected = questions.find((question) => /人工|边界|条件|采用|场景/.test(question))
    || questions[0]
    || "适合哪些真实工作场景，采用前需要确认哪些人机协作边界？";
  return selected.includes(productName) ? selected : `${productName} ${selected}`;
}

async function ensurePromptBinding(
  connection: Parameters<Parameters<typeof withV5GovernanceTransaction>[0]>[0],
  input: { productId: string; productName: string; actor: SingleArticleActor }
) {
  const [existingGroups] = await connection.query<RowDataPacket[]>(
    `SELECT pg.id AS prompt_group_id, pg.active_version_id, pg.status AS prompt_group_status,
            pgv.status AS prompt_version_status, pgv.immutable_at AS prompt_immutable_at
     FROM prompt_group pg
     LEFT JOIN prompt_group_version pgv ON pgv.id = pg.active_version_id
     WHERE pg.product_id = ? AND pg.channel = 'wechat' AND pg.platform_content_type = 'explicit_product_intro'
     LIMIT 1 FOR UPDATE`,
    [input.productId]
  );
  let promptGroupId: string;
  let promptGroupVersionId: string;
  const existing = existingGroups[0];
  if (existing) {
    if (String(existing.prompt_group_status) !== "approved"
      || String(existing.prompt_version_status) !== "approved"
      || !existing.prompt_immutable_at
      || !existing.active_version_id) {
      throw new V5GovernanceRepositoryError(
        "sample_prompt_binding_not_ready",
        "产品已有公众号 Prompt Group，但尚未批准并冻结。",
        409,
        "先完成现有 Prompt Group 的人工审核，系统不会覆盖已有规则。"
      );
    }
    promptGroupId = String(existing.prompt_group_id);
    promptGroupVersionId = String(existing.active_version_id);
  } else {
    promptGroupId = createProductSampleStableId("sample-prompt", { productId: input.productId, channel: "wechat" });
    promptGroupVersionId = createProductSampleStableId("sample-prompt-v1", { promptGroupId, version: "v1.0.0" });
    const hardRules = [
      { text: "只使用冻结 EvidencePack 中的事实与原文", action: "block" },
      { text: "事实句必须关联 EvidenceItem、Claim 和 SourceRevision", action: "block" },
      { text: "不得把限制条件、规划能力或推测改写为已全面上线", action: "block" },
      { text: "样稿只用于人工内容质量校准，不能直接发布", action: "block" }
    ];
    await connection.query(
      `INSERT INTO prompt_group
       (id, product_id, name, channel, platform_content_type, status, active_version_id, created_by)
       VALUES (?, ?, ?, 'wechat', 'explicit_product_intro', 'approved', ?, ?)`,
      [promptGroupId, input.productId, `${input.productName} 公众号产品样稿`, promptGroupVersionId, input.actor.actorId]
    );
    await connection.query(
      `INSERT INTO prompt_group_version
       (id, prompt_group_id, version, status, system_prompt, user_prompt_template, hard_rules,
        created_by, approved_by, approved_at, immutable_at)
       VALUES (?, ?, 'v1.0.0', 'approved', ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        promptGroupVersionId,
        promptGroupId,
        "你是企业产品内容编辑。把已批准证据组织成自然、准确、可审计的中文公众号正文，不得补写证据之外的事实。",
        "围绕冻结标题解释产品能做什么、适合谁、采用路径和适用边界。正文服务真实读者，不展示内部治理日志。",
        stringifyV5Json(hardRules),
        input.actor.actorId,
        input.actor.actorId
      ]
    );
  }

  const [channelRows] = await connection.query<RowDataPacket[]>(
    `SELECT id, required_format, prohibited_patterns, cta_boundary FROM channel_rule_version
     WHERE channel = 'wechat' AND status = 'approved' AND immutable_at IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  );
  let channelRuleVersionId = channelRows[0]?.id ? String(channelRows[0].id) : "";
  let requiredFormat = channelRows[0] ? parseV5Json<unknown[]>(channelRows[0].required_format, []) : [];
  let prohibitedPatterns = channelRows[0] ? parseV5Json<unknown[]>(channelRows[0].prohibited_patterns, []) : [];
  let ctaBoundary = channelRows[0]?.cta_boundary ? String(channelRows[0].cta_boundary) : "";
  if (!channelRuleVersionId) {
    channelRuleVersionId = createProductSampleStableId("sample-wechat-rule", { channel: "wechat", version: "v1.0.0" });
    requiredFormat = ["Markdown 标题", "正文分节", "能力与边界并列呈现", "结尾不做证据外承诺"];
    prohibitedPatterns = ["虚构客户案例", "无证据的竞品优劣", "绝对化承诺", "伪造性能或 ROI 数字"];
    ctaBoundary = "允许邀请读者查看已提供的正式产品资料，不承诺 EvidencePack 之外的能力。";
    await connection.query(
      `INSERT INTO channel_rule_version
       (id, channel, version, status, required_format, prohibited_patterns, cta_boundary,
        created_by, approved_by, approved_at, immutable_at)
       VALUES (?, 'wechat', 'product-sample-v1.0.0', 'approved', ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        channelRuleVersionId,
        stringifyV5Json(requiredFormat),
        stringifyV5Json(prohibitedPatterns),
        ctaBoundary,
        input.actor.actorId,
        input.actor.actorId
      ]
    );
  }
  return {
    promptGroupId,
    promptGroupVersionId,
    channelRuleVersionId,
    channelRuleSnapshot: {
      channelRuleVersionId,
      channel: "wechat",
      requiredFormat,
      prohibitedPatterns,
      ctaBoundary
    }
  };
}

export async function ensureProductSampleArticleTask(input: {
  productId: string;
  strategyPackId: string;
  actor: SingleArticleActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [strategyRows] = await connection.query<RowDataPacket[]>(
      `SELECT p.display_name, p.strategy_pack_id, sp.status AS strategy_status,
              atv.article_type_version_id, atv.name AS article_type_name,
              atv.definition_json, atv.definition_hash
       FROM product_entity p
       JOIN product_strategy_packs sp ON sp.id = p.strategy_pack_id
       JOIN product_strategy_article_type_versions atv
         ON atv.strategy_pack_id = sp.id AND atv.status IN ('active', 'frozen')
       WHERE p.id = ? AND sp.id = ? AND sp.status IN ('strategy_approved', 'pending_sample_review')
         AND JSON_UNQUOTE(JSON_EXTRACT(atv.definition_json, '$.evidenceReadiness')) = 'ready'
       ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(atv.definition_json, '$.proposedMonthlyShare')) AS DECIMAL(8,6)) DESC,
                atv.portfolio_item_id
       LIMIT 1 FOR UPDATE`,
      [input.productId, input.strategyPackId]
    );
    const strategy = strategyRows[0];
    if (!strategy) {
      throw new V5GovernanceRepositoryError(
        "sample_ready_article_type_missing",
        "已确认策略中没有证据就绪且已激活的文章类型。",
        409,
        "补充正式资料并重新编译策略，禁止用资料待补类型生成样稿。"
      );
    }
    const [snapshotRows] = await connection.query<RowDataPacket[]>(
      `SELECT s.id AS snapshot_id, m.knowledge_base_ids, m.active_rule_package_version_id,
              r.distilled_term_suggestions
       FROM rag_index_snapshot s
       JOIN rag_ingestion_manifest m ON m.id = s.manifest_id
       JOIN rule_package_version r ON r.id = m.active_rule_package_version_id
       WHERE s.product_id = ? AND s.namespace = 'production_public' AND s.language = 'zh-CN'
         AND s.status = 'active' AND s.immutable_at IS NOT NULL
         AND m.status = 'approved' AND m.approved_by IS NOT NULL AND m.approved_at IS NOT NULL
         AND r.status = 'active' AND r.immutable_at IS NOT NULL
       ORDER BY s.activated_at DESC LIMIT 1`,
      [input.productId]
    );
    const snapshot = snapshotRows[0];
    if (!snapshot) {
      throw new V5GovernanceRepositoryError(
        "sample_active_snapshot_missing",
        "产品尚无可用于正式样稿的 active production_public 索引快照。",
        409,
        "先完成知识索引构建、评测和激活；不能回退到模型记忆生成。"
      );
    }
    const binding = await ensurePromptBinding(connection, {
      productId: input.productId,
      productName: String(strategy.display_name),
      actor: input.actor
    });
    const taskId = createProductSampleStableId("product-sample", { strategyPackId: input.strategyPackId });
    const articleDefinition = parseV5Json<Record<string, unknown>>(strategy.definition_json, {});
    const productName = String(strategy.display_name);
    const representativeQuestion = selectRepresentativeSampleQuestion(articleDefinition, productName);
    const title = representativeQuestion;
    const sourceProblem = `回答真实用户问题“${representativeQuestion}”。基于已批准证据解释 ${productName} 的产品能力、适用场景、采用路径，以及哪些环节可由 AI 执行、哪些判断仍应由人负责；不讨论证据不足的竞品优劣、案例、ROI、价格或底层架构。`;
    const expressionSnapshot = {
      productionScope: sampleScope,
      articleTypeName: String(strategy.article_type_name),
      articleTypeDefinitionHash: String(strategy.definition_hash),
      evidenceReadiness: articleDefinition.evidenceReadiness,
      channelRuleSnapshot: binding.channelRuleSnapshot,
      sampleOnly: true,
      representativeQuestion
    };
    await connection.query(
      `INSERT INTO product_sample_article_task
       (id, product_id, product_strategy_pack_id, article_type_version_id, channel, platform_content_type,
        title, target_audience, primary_distilled_term_id, secondary_distilled_term_ids, knowledge_base_ids,
        rule_package_version_id, prompt_group_id, prompt_group_version_id, channel_rule_version_id,
        platform_expression_snapshot, source_problem, status, approved_at, approved_by)
       VALUES (?, ?, ?, ?, 'wechat', 'explicit_product_intro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', NOW(), ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        taskId,
        input.productId,
        input.strategyPackId,
        String(strategy.article_type_version_id),
        title,
        "正在判断企业 AI 产品是否适合真实工作场景的业务负责人、技术负责人和产品负责人",
        firstDistilledTerm(snapshot.distilled_term_suggestions) || null,
        stringifyV5Json([]),
        stringifyV5Json(parseV5Json(snapshot.knowledge_base_ids, [])),
        String(snapshot.active_rule_package_version_id),
        binding.promptGroupId,
        binding.promptGroupVersionId,
        binding.channelRuleVersionId,
        stringifyV5Json(expressionSnapshot),
        sourceProblem,
        input.actor.actorId
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_sample_article_task_ready",
      objectType: "product_sample_article_task",
      objectId: taskId,
      afterSummary: {
        productId: input.productId,
        strategyPackId: input.strategyPackId,
        articleTypeVersionId: String(strategy.article_type_version_id),
        sourceSnapshotId: String(snapshot.snapshot_id),
        productionScope: sampleScope
      },
      correlationId: input.strategyPackId
    });
    return { taskId, title, articleTypeVersionId: String(strategy.article_type_version_id) };
  });
}

export async function generateProductSampleArticle(input: {
  productId: string;
  strategyPackId: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}) {
  const task = await ensureProductSampleArticleTask(input);
  const result = await prepareAndGenerateSingleArticle({
    taskId: task.taskId,
    idempotencyKey: input.idempotencyKey,
    actor: { ...input.actor, auditReason: "用户确认产品 GEO 策略后自动生成一篇公众号质量验收样稿" },
    productionMode: "sample"
  });
  return { ...task, result };
}

export async function readLatestProductSampleArticle(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT task.id AS task_id, task.product_strategy_pack_id, task.status AS task_status,
            task.title AS task_title, task.article_type_version_id,
            operation.status AS operation_status, operation.error_code, operation.error_message, operation.next_action,
            draft.id AS draft_version_id, draft.title, draft.markdown, draft.copy_allowed,
            draft.hard_rule_result, draft.created_at
     FROM product_sample_article_task task
     LEFT JOIN single_article_operation operation ON operation.id = (
       SELECT candidate.id FROM single_article_operation candidate
       WHERE candidate.task_id = task.id ORDER BY candidate.created_at DESC LIMIT 1
     )
     LEFT JOIN draft_version draft ON draft.id = operation.draft_version_id AND draft.test_only = FALSE
     WHERE task.product_id = ?
     ORDER BY task.updated_at DESC LIMIT 1`,
    [productId]
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    taskId: String(row.task_id),
    strategyPackId: String(row.product_strategy_pack_id),
    taskStatus: String(row.task_status),
    taskTitle: String(row.task_title),
    articleTypeVersionId: String(row.article_type_version_id),
    operationStatus: row.operation_status ? String(row.operation_status) : undefined,
    error: row.error_code ? {
      code: String(row.error_code),
      message: String(row.error_message || "样稿生成失败。"),
      nextAction: String(row.next_action || "处理前置条件后重试。")
    } : undefined,
    draft: row.draft_version_id ? {
      draftVersionId: String(row.draft_version_id),
      title: String(row.title),
      markdown: String(row.markdown),
      copyAllowed: Boolean(row.copy_allowed),
      hardRuleResult: parseV5Json(row.hard_rule_result, {}),
      createdAt: new Date(row.created_at).toISOString()
    } : undefined
  };
}
