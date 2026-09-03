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
import { queueSingleArticleOperation } from "./single-article-production-repository";
import { compileGeoArticleMission } from "./geo-article-mission-contracts";
import { normalizeJotoAdpIdentityPhrasing } from "./geo-product-identity";
import { ensureNarrativeSubjectTitle } from "./geo-article-title-policy";

const sampleScope = "product_sample_calibration";

interface ProductSampleTaskDescriptor {
  taskId: string;
  title: string;
  articleTypeVersionId: string;
  articleTypeName: string;
}

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
  return normalizeFrozenArticleTitle(selected.includes(productName) ? selected : `${productName} ${selected}`);
}

export function normalizeFrozenArticleTitle(value: string) {
  let title = value.trim().replace(/[。.]+/g, "").replace(/\s+([，。？！；：])/g, "$1");
  const questionCount = (title.match(/[？?]/g) || []).length;
  if (questionCount > 1) {
    let seen = 0;
    title = title.replace(/[？?]/g, () => (++seen < questionCount ? "，" : "？"));
  }
  return title.replace(/[，,；;：:、]+$/g, "");
}

export function compileNarrativeSubjectTitle(input: {
  representativeQuestion: string;
  productName: string;
  narrativeSubjectName: string;
  narrativeSubjectRole: "target_product" | "service_provider";
}) {
  const question = normalizeFrozenArticleTitle(input.representativeQuestion);
  return normalizeFrozenArticleTitle(ensureNarrativeSubjectTitle({
    title: question,
    productName: input.productName,
    narrativeSubjectName: input.narrativeSubjectName,
    narrativeSubjectRole: input.narrativeSubjectRole
  }));
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

export async function ensureProductSampleArticleTasks(input: {
  productId: string;
  strategyPackId: string;
  actor: SingleArticleActor;
  maxTasks?: number;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [strategyRows] = await connection.query<RowDataPacket[]>(
      `SELECT p.display_name, p.canonical_name, p.aliases, p.brand_name, p.official_entity, p.entity_relationship,
              p.strategy_pack_id, sp.status AS strategy_status, sp.content_plan_json,
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
       FOR UPDATE`,
      [input.productId, input.strategyPackId]
    );
    if (!strategyRows.length) {
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
    const productName = String(strategyRows[0].display_name);
    const binding = await ensurePromptBinding(connection, {
      productId: input.productId,
      productName,
      actor: input.actor
    });
    const tasks: ProductSampleTaskDescriptor[] = [];
    const selectedStrategies = input.maxTasks && input.maxTasks > 0
      ? strategyRows.slice(0, input.maxTasks)
      : strategyRows;
    for (const strategy of selectedStrategies) {
      const articleTypeVersionId = String(strategy.article_type_version_id);
      const [existingTaskRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, title, geo_intent_hash, entity_graph_hash FROM product_sample_article_task
         WHERE product_strategy_pack_id = ? AND article_type_version_id = ? LIMIT 1 FOR UPDATE`,
        [input.strategyPackId, articleTypeVersionId]
      );
      const taskId = existingTaskRows[0]?.id ? String(existingTaskRows[0].id) : createProductSampleStableId("product-sample", {
        strategyPackId: input.strategyPackId,
        articleTypeVersionId
      });
      const articleDefinition = parseV5Json<Record<string, unknown>>(strategy.definition_json, {});
      const representativeQuestion = selectRepresentativeSampleQuestion(articleDefinition, productName);
      const sourceProblem = `回答真实用户问题“${representativeQuestion}”。基于已批准证据解释 ${productName} 的产品能力、适用场景、采用路径，以及哪些环节可由 AI 执行、哪些判断仍应由人负责；不讨论证据不足的竞品优劣、案例、ROI、价格或底层架构。`;
      const geoMission = compileGeoArticleMission({
        identity: {
          productId: input.productId,
          canonicalName: String(strategy.canonical_name || productName),
          displayName: productName,
          aliases: parseV5Json<string[]>(strategy.aliases, []),
          brandName: strategy.brand_name ? String(strategy.brand_name) : undefined,
          officialEntity: strategy.official_entity ? String(strategy.official_entity) : undefined,
          entityRelationship: strategy.entity_relationship ? String(strategy.entity_relationship) : undefined
        },
        plan: parseV5Json(strategy.content_plan_json, {}),
        articleType: articleDefinition,
        primaryQuestion: representativeQuestion,
        sourceProblem
      });
      const title = compileNarrativeSubjectTitle({
        representativeQuestion,
        productName,
        narrativeSubjectName: geoMission.narrativeSubjectName,
        narrativeSubjectRole: geoMission.narrativeSubjectRole
      });
      const expressionSnapshot = {
        productionScope: sampleScope,
        articleTypeName: String(strategy.article_type_name),
        articleTypeDefinitionHash: String(strategy.definition_hash),
        evidenceReadiness: articleDefinition.evidenceReadiness,
        channelRuleSnapshot: binding.channelRuleSnapshot,
        sampleOnly: true,
        representativeQuestion
      };
      const existingTask = existingTaskRows[0];
      if (existingTask) {
        const missionChanged = String(existingTask.geo_intent_hash || "") !== geoMission.geoIntentHash
          || String(existingTask.entity_graph_hash || "") !== geoMission.entityGraph.graphHash
          || String(existingTask.title || "") !== title;
        await connection.query(
          `UPDATE product_sample_article_task
           SET title = ?, target_audience = ?, primary_distilled_term_id = ?, secondary_distilled_term_ids = ?, knowledge_base_ids = ?,
               rule_package_version_id = ?, prompt_group_id = ?, prompt_group_version_id = ?, channel_rule_version_id = ?,
               platform_expression_snapshot = ?, geo_mission_snapshot = ?, geo_intent_hash = ?, entity_graph_hash = ?, source_problem = ?,
               final_evidence_pack_id = IF(?, NULL, final_evidence_pack_id),
               evidence_gate_status = IF(?, NULL, evidence_gate_status),
               status = IF(?, 'approved', status), review_status = IF(?, 'pending_generation', review_status),
               row_version = row_version + IF(?, 1, 0), updated_at = NOW()
           WHERE id = ?`,
          [
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
            stringifyV5Json(geoMission),
            geoMission.geoIntentHash,
            geoMission.entityGraph.graphHash,
            sourceProblem,
            missionChanged,
            missionChanged,
            missionChanged,
            missionChanged,
            missionChanged,
            taskId
          ]
        );
      } else {
        await connection.query(
          `INSERT INTO product_sample_article_task
         (id, product_id, product_strategy_pack_id, article_type_version_id, channel, platform_content_type,
           title, target_audience, primary_distilled_term_id, secondary_distilled_term_ids, knowledge_base_ids,
           rule_package_version_id, prompt_group_id, prompt_group_version_id, channel_rule_version_id,
           platform_expression_snapshot, geo_mission_snapshot, geo_intent_hash, entity_graph_hash,
           source_problem, status, review_status, approved_at, approved_by)
          VALUES (?, ?, ?, ?, 'wechat', 'explicit_product_intro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'pending_generation', NOW(), ?)`,
         [
          taskId,
          input.productId,
          input.strategyPackId,
          articleTypeVersionId,
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
           stringifyV5Json(geoMission),
           geoMission.geoIntentHash,
           geoMission.entityGraph.graphHash,
           sourceProblem,
           input.actor.actorId
         ]
        );
      }
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "product_sample_article_task_ready",
        objectType: "product_sample_article_task",
        objectId: taskId,
        afterSummary: {
          productId: input.productId,
          strategyPackId: input.strategyPackId,
          articleTypeVersionId,
           sourceSnapshotId: String(snapshot.snapshot_id),
           productionScope: sampleScope,
           geoIntentHash: geoMission.geoIntentHash,
           entityGraphHash: geoMission.entityGraph.graphHash
        },
        correlationId: input.strategyPackId
      });
      tasks.push({ taskId, title, articleTypeVersionId, articleTypeName: String(strategy.article_type_name) });
    }
    return tasks;
  });
}

export async function ensureProductSampleArticleTask(input: {
  productId: string;
  strategyPackId: string;
  actor: SingleArticleActor;
}) {
  const tasks = await ensureProductSampleArticleTasks({ ...input, maxTasks: 1 });
  if (!tasks[0]) throw new V5GovernanceRepositoryError("sample_ready_article_type_missing", "没有可生成的样文类型。", 409);
  return tasks[0];
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

export async function enqueueProductSampleArticles(input: {
  productId: string;
  strategyPackId: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}) {
  const tasks = await ensureProductSampleArticleTasks(input);
  const queued: Array<ProductSampleTaskDescriptor & {
    operation: Awaited<ReturnType<typeof queueSingleArticleOperation>>["operation"];
    queued: boolean;
  }> = [];
  for (const task of tasks) {
    const operation = await queueSingleArticleOperation({
      taskId: task.taskId,
      idempotencyKey: `${input.idempotencyKey}:${task.articleTypeVersionId}`.slice(0, 128),
      actor: { ...input.actor, auditReason: "用户确认产品 GEO 策略后提交文章类型代表样文异步任务" }
    });
    queued.push({ ...task, operation: operation.operation, queued: operation.queued });
  }
  return queued;
}

export async function enqueueProductSampleArticle(input: {
  productId: string;
  strategyPackId: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}) {
  const task = await ensureProductSampleArticleTask(input);
  const operation = await queueSingleArticleOperation({
    taskId: task.taskId,
    idempotencyKey: `${input.idempotencyKey}:${task.articleTypeVersionId}`.slice(0, 128),
    actor: { ...input.actor, auditReason: "用户确认 GEO 托管策略后提交一篇代表样文异步任务" }
  });
  return { ...task, operation: operation.operation, queued: operation.queued };
}

export async function enqueueProductSampleRevision(input: {
  taskId: string;
  feedbackId: string;
  actor: SingleArticleActor;
}) {
  await withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT task.final_evidence_pack_id, task.source_problem, feedback.feedback_json
       FROM product_sample_article_task task
       JOIN sample_article_feedback feedback ON feedback.id = ?
       WHERE task.id = ? AND feedback.product_id = task.product_id
         AND feedback.product_strategy_pack_id = task.product_strategy_pack_id
       LIMIT 1 FOR UPDATE`,
      [input.feedbackId, input.taskId]
    );
    const row = rows[0];
    if (!row) {
      throw new V5GovernanceRepositoryError("sample_revision_feedback_not_found", "没有找到这篇样文对应的修改要求。", 404);
    }
    const feedback = parseV5Json<{ revisionInstruction?: string }>(row.feedback_json, {});
    const revisionInstruction = String(feedback.revisionInstruction || "").trim();
    if (!revisionInstruction) {
      throw new V5GovernanceRepositoryError("sample_revision_instruction_required", "修改要求不能为空。", 400);
    }
    const baseProblem = String(row.source_problem || "")
      .split("\n\n用户本轮修改要求：", 1)[0]
      .trim();
    const nextProblem = `${baseProblem}\n\n用户本轮修改要求：${revisionInstruction}`;
    const previousPackId = row.final_evidence_pack_id ? String(row.final_evidence_pack_id) : undefined;
    if (previousPackId) {
      await connection.query(
        `UPDATE final_evidence_pack
         SET invalidated_at = COALESCE(invalidated_at, NOW()),
             invalidation_reason = COALESCE(invalidation_reason, 'sample_revision_requires_fresh_evidence')
         WHERE id = ?`,
        [previousPackId]
      );
    }
    await connection.query(
      `UPDATE product_sample_article_task
       SET review_status = 'pending_revision', source_problem = ?,
           final_evidence_pack_id = NULL, evidence_gate_status = NULL,
           status = 'approved', row_version = row_version + 1, updated_at = NOW()
       WHERE id = ?`,
      [nextProblem, input.taskId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "sample_revision_evidence_refresh_requested",
      objectType: "product_sample_article_task",
      objectId: input.taskId,
      beforeSummary: { finalEvidencePackId: previousPackId },
      afterSummary: { feedbackId: input.feedbackId, evidenceRefreshRequired: true },
      correlationId: input.feedbackId
    });
  });
  return queueSingleArticleOperation({
    taskId: input.taskId,
    idempotencyKey: `sample-revision:${input.feedbackId}`,
    actor: { ...input.actor, auditReason: "用户提交单一修改要求后生成样文修订版" }
  });
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : undefined;
}

function evidenceReadiness(definition: unknown) {
  const parsed = parseV5Json<Record<string, unknown>>(definition, {});
  return String(parsed.evidenceReadiness || "partial");
}

export async function readProductSampleArticles(productId: string) {
  const [strategyRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT sp.id, sp.strategy_version, sp.status
     FROM product_entity product
     JOIN product_strategy_packs sp ON sp.id = product.strategy_pack_id
     WHERE product.id = ? LIMIT 1`,
    [productId]
  );
  const strategy = strategyRows[0];
  if (!strategy) return undefined;
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT atv.article_type_version_id, atv.name AS article_type_name, atv.definition_json,
            task.id AS task_id, task.title AS task_title, task.status AS task_status,
            task.review_status, task.accepted_draft_version_id, task.updated_at,
            operation.id AS operation_id, operation.status AS operation_status,
            operation.progress_stage, operation.attempt_count, operation.error_code,
            operation.error_message, operation.next_action,
            draft.id AS draft_version_id, draft.version_number, draft.copy_allowed, draft.created_at
     FROM product_strategy_article_type_versions atv
     LEFT JOIN product_sample_article_task task
       ON task.product_strategy_pack_id = atv.strategy_pack_id
      AND task.article_type_version_id = atv.article_type_version_id
     LEFT JOIN single_article_operation operation ON operation.id = (
       SELECT candidate.id FROM single_article_operation candidate
       WHERE candidate.task_id = task.id ORDER BY candidate.created_at DESC LIMIT 1
     )
     LEFT JOIN draft_version draft ON draft.id = operation.draft_version_id AND draft.test_only = FALSE
     WHERE atv.product_id = ? AND atv.strategy_pack_id = ?
       AND atv.status IN ('active', 'frozen', 'evidence_pending')
     ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(atv.definition_json, '$.proposedMonthlyShare')) AS DECIMAL(8,6)) DESC,
              atv.portfolio_item_id`,
    [productId, String(strategy.id)]
  );
  const items = rows.map((row) => ({
    articleTypeVersionId: String(row.article_type_version_id),
    articleTypeName: String(row.article_type_name),
    evidenceReadiness: evidenceReadiness(row.definition_json),
    taskId: row.task_id ? String(row.task_id) : undefined,
    title: row.task_title ? String(row.task_title) : undefined,
    taskStatus: row.task_status ? String(row.task_status) : undefined,
    reviewStatus: row.review_status ? String(row.review_status) : row.task_id ? "pending_generation" : "evidence_pending",
    acceptedDraftVersionId: row.accepted_draft_version_id ? String(row.accepted_draft_version_id) : undefined,
    operation: row.operation_id ? {
      operationId: String(row.operation_id),
      status: String(row.operation_status),
      progressStage: row.progress_stage ? String(row.progress_stage) : undefined,
      attemptCount: Number(row.attempt_count || 0),
      error: row.error_code ? {
        code: String(row.error_code),
        message: String(row.error_message || "样文生成失败。"),
        nextAction: String(row.next_action || "处理前置条件后重试。")
      } : undefined
    } : undefined,
    draft: row.draft_version_id ? {
      draftVersionId: String(row.draft_version_id),
      versionNumber: Number(row.version_number || 1),
      copyAllowed: Boolean(row.copy_allowed),
      createdAt: iso(row.created_at)
    } : undefined,
    updatedAt: iso(row.updated_at)
  }));
  const required = items.filter((item) => item.evidenceReadiness === "ready");
  return {
    productId,
    strategyPackId: String(strategy.id),
    strategyVersion: Number(strategy.strategy_version || 1),
    strategyStatus: String(strategy.status),
    requiredCount: required.length,
    approvedCount: required.filter((item) => item.reviewStatus === "approved").length,
    items
  };
}

/** Compatibility view for the optional single-sample Graph shadow observer. */
export async function readLatestProductSampleArticle(productId: string) {
  const list = await readProductSampleArticles(productId);
  const item = list?.items.find((candidate) => candidate.reviewStatus === "approved" && candidate.draft?.draftVersionId)
    || list?.items.find((candidate) => candidate.draft?.draftVersionId);
  if (!list || !item?.taskId) return undefined;
  return {
    taskId: item.taskId,
    strategyPackId: list.strategyPackId,
    taskStatus: item.taskStatus || "generated",
    taskTitle: item.title || "",
    articleTypeVersionId: item.articleTypeVersionId,
    operationId: item.operation?.operationId,
    operationStatus: item.operation?.status,
    progressStage: item.operation?.progressStage,
    attemptCount: item.operation?.attemptCount || 0,
    error: item.operation?.error,
    draft: item.draft ? {
      draftVersionId: item.draft.draftVersionId,
      title: item.title || "",
      markdown: "",
      copyAllowed: item.draft.copyAllowed,
      hardRuleResult: {},
      createdAt: item.draft.createdAt || ""
    } : undefined
  };
}

function sanitizePrompt(value: unknown) {
  return String(value || "")
    .replace(/(?:evidence|claim|src-rev|source-revision)-[a-z0-9-]+/gi, "[内部证据标识]")
    .replace(/"(?:evidenceItemId|claimId|sourceRevisionId)":"[^"]+"/g, '"internalId":"[已隐藏]"');
}

export async function readProductSampleArticleDetail(productId: string, taskId: string) {
  const [taskRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT task.*, atv.name AS article_type_name, atv.definition_json,
            operation.id AS operation_id, operation.status AS operation_status,
            operation.progress_stage, operation.error_code, operation.error_message, operation.next_action
     FROM product_sample_article_task task
     JOIN product_strategy_article_type_versions atv
       ON atv.article_type_version_id = task.article_type_version_id
      AND atv.strategy_pack_id = task.product_strategy_pack_id
     LEFT JOIN single_article_operation operation ON operation.id = (
       SELECT candidate.id FROM single_article_operation candidate
       WHERE candidate.task_id = task.id ORDER BY candidate.created_at DESC LIMIT 1
     )
     WHERE task.id = ? AND task.product_id = ? LIMIT 1`,
    [taskId, productId]
  );
  const task = taskRows[0];
  if (!task) return undefined;
  const [versions] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT draft.id AS draft_version_id, draft.version_number, draft.title, draft.markdown,
            draft.copy_allowed, draft.hard_rule_result, draft.created_at,
            generation.id AS generation_run_id, generation.provider, generation.model,
            generation.system_prompt_snapshot, generation.user_prompt_snapshot,
            generation.brief_snapshot,
            feedback.decision, feedback.feedback_json, feedback.decided_at
     FROM draft_version draft
     JOIN generation_run generation ON generation.id = draft.generation_run_id
     LEFT JOIN sample_article_feedback feedback ON feedback.id = (
       SELECT candidate.id FROM sample_article_feedback candidate
       WHERE candidate.draft_version_id = draft.id ORDER BY candidate.decided_at DESC LIMIT 1
     )
     WHERE draft.task_id = ? AND draft.test_only = FALSE
     ORDER BY draft.version_number DESC`,
    [taskId]
  );
  const mappedVersions = versions.map((row) => ({
    draftVersionId: String(row.draft_version_id),
    versionNumber: Number(row.version_number),
    title: String(row.title),
    markdown: normalizeJotoAdpIdentityPhrasing(String(row.markdown)),
    copyAllowed: Boolean(row.copy_allowed),
    hardRuleResult: parseV5Json(row.hard_rule_result, {}),
    createdAt: iso(row.created_at),
    generationRunId: String(row.generation_run_id),
    provider: String(row.provider),
    model: row.model ? String(row.model) : undefined,
    brief: parseV5Json<Record<string, unknown> | undefined>(row.brief_snapshot, undefined),
    technicalPrompt: row.system_prompt_snapshot || row.user_prompt_snapshot ? {
      system: sanitizePrompt(row.system_prompt_snapshot),
      user: sanitizePrompt(row.user_prompt_snapshot)
    } : undefined,
    decision: row.decision ? String(row.decision) : undefined,
    feedback: row.feedback_json ? parseV5Json(row.feedback_json, {}) : undefined,
    decidedAt: iso(row.decided_at)
  }));
  return {
    productId,
    strategyPackId: String(task.product_strategy_pack_id),
    taskId: String(task.id),
    articleTypeVersionId: String(task.article_type_version_id),
    articleTypeName: String(task.article_type_name),
    evidenceReadiness: evidenceReadiness(task.definition_json),
    title: String(task.title),
    reviewStatus: String(task.review_status || "pending_generation"),
    acceptedDraftVersionId: task.accepted_draft_version_id ? String(task.accepted_draft_version_id) : undefined,
    operation: task.operation_id ? {
      operationId: String(task.operation_id),
      status: String(task.operation_status),
      progressStage: task.progress_stage ? String(task.progress_stage) : undefined,
      error: task.error_code ? {
        code: String(task.error_code),
        message: String(task.error_message || "样文生成失败。"),
        nextAction: String(task.next_action || "处理前置条件后重试。")
      } : undefined
    } : undefined,
    versions: mappedVersions,
    currentVersion: mappedVersions[0]
  };
}
