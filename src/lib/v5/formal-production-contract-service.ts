import type { RowDataPacket } from "mysql2/promise";
import type { RagFinalEvidencePack } from "./rag/contracts";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import { compileProductionContract } from "./production-contract-compiler";
import type {
  ContentTypeRuleSnapshot,
  ProductionArtifact,
  ProductionContractSnapshot
} from "./content-production-contracts";

export const JOTO_OFFICIAL_POSITIONING = "JOTO 作为腾讯CSP授权合作伙伴";

export function resolveJotoOfficialFixedExpression(
  text: string,
  channels: string[],
  taskChannel: string
) {
  const normalizedText = text.trim();
  const isJotoOfficialPositioning = /JOTO/i.test(normalizedText)
    && /(?:CSP|伙伴|服务商|专项服务)/i.test(normalizedText);
  return {
    text: isJotoOfficialPositioning ? JOTO_OFFICIAL_POSITIONING : normalizedText,
    appliesToChannel: isJotoOfficialPositioning || channels.includes(taskChannel)
  };
}
import type { SingleArticleActor } from "./single-article-contracts";
import type { FormalGenerationContext } from "./single-article-production-repository";

const compilerVersion = "production-contract-compiler.v2" as const;

interface StrategyRow extends RowDataPacket {
  product_id: string;
  strategy_pack_id: string | null;
  strategy_version: number | null;
  strategy_status: string | null;
  content_plan_hash: string | null;
  content_plan_json: unknown;
  article_type_version_id: string | null;
  article_type_definition_hash: string | null;
  article_type_definition_json: unknown;
  calibration_version_id: string | null;
  calibration_directives: unknown;
  sample_revision_feedback: unknown;
}

function artifactsFrom(values: string[]): ProductionArtifact[] {
  const text = values.join(" ").toLocaleLowerCase();
  return [
    ...(text.includes("table") || text.includes("表格") ? ["table" as const] : []),
    ...(text.includes("list") || text.includes("列表") || text.includes("清单") ? ["list" as const] : []),
    ...(text.includes("flow") || text.includes("流程") ? ["state_flow" as const] : []),
    ...(text.includes("code") || text.includes("代码") ? ["code_block" as const] : [])
  ];
}

function expressionStrings(value: unknown) {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(expressionStrings);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return ["text", "description", "action", "pattern", "value", "label", "purpose", "guidance", "rules", "items", "requirements", "boundaries", "conditions", "limitations"]
    .flatMap((key) => expressionStrings(record[key]));
}

export function compileSampleRevisionDirectives(value: unknown) {
  const feedback = parseV5Json<Record<string, unknown>>(value, {});
  const issues = Array.isArray(feedback.issues) ? feedback.issues : [];
  return Array.from(new Set([
    ...expressionStrings(feedback.expressionDirectives),
    ...issues.flatMap((issue) => {
      if (!issue || typeof issue !== "object") return [];
      const record = issue as Record<string, unknown>;
      const instruction = expressionStrings(record.instruction)[0];
      if (!instruction) return [];
      const segment = expressionStrings(record.segment)[0];
      return [segment ? `修订位置：${segment}；要求：${instruction}` : instruction];
    })
  ])).slice(0, 30);
}

function evidenceSnapshot(pack: RagFinalEvidencePack): ProductionContractSnapshot["evidencePack"] {
  return {
    evidencePackId: pack.evidencePackId,
    snapshotHash: pack.snapshotHash,
    sourceSnapshotHash: pack.sourceSnapshotHash,
    decision: pack.decision,
    evidenceItems: pack.evidenceItems.map((item) => ({
      evidenceItemId: item.evidenceItemId,
      claimIds: item.claimIds,
      primaryClaimId: item.primaryClaimId,
      sourceRevisionId: item.sourceRevisionId,
      originalQuote: item.originalQuote,
      summary: item.normalizedClaim || item.summary,
      canonicalUrl: item.canonicalUrl,
      allowedUsage: item.allowedUsage,
      forbiddenUsage: item.forbiddenUsage,
      conditions: item.conditions,
      limitations: item.limitations,
      lifecycleStatus: item.validity.lifecycleStatus === "beta" || item.validity.lifecycleStatus === "expired"
        ? "unknown"
        : item.validity.lifecycleStatus,
      visibility: "public",
      status: item.status
    })),
    gaps: pack.gaps,
    conflicts: pack.conflicts,
    outdatedEvidence: pack.outdatedEvidence,
    unverifiedClaims: pack.unverifiedClaims
  };
}

function contentTypeRule(row: StrategyRow, context: FormalGenerationContext): ContentTypeRuleSnapshot {
  const definition = parseV5Json<Record<string, unknown>>(row.article_type_definition_json, {});
  const modules = Array.isArray(definition.structureModules) ? definition.structureModules : [];
  const requiredSections = modules.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    return value.required === false ? [] : [String(value.key || value.label || "").trim()].filter(Boolean);
  });
  const length = definition.length && typeof definition.length === "object"
    ? definition.length as Record<string, unknown>
    : {};
  const minLength = Number(length.min || definition.minLength || 800);
  const maxLength = Number(length.max || definition.maxLength || 3000);
  const directives = [
    ...expressionStrings(definition.definition),
    ...expressionStrings(definition.expressionFocus),
    ...expressionStrings(definition.style),
    ...expressionStrings(definition.evidencePreferences),
    ...modules.flatMap((item) => expressionStrings(item)),
    context.systemPrompt,
    context.userPromptTemplate
  ].filter(Boolean);
  return {
    articleTypeProfileVersionId: String(row.article_type_version_id),
    promptConstraintSnapshotHash: String(row.article_type_definition_hash),
    ctaIntent: "none",
    minLength: Number.isInteger(minLength) && minLength > 0 ? minLength : 800,
    maxLength: Number.isInteger(maxLength) && maxLength >= minLength ? maxLength : 3000,
    requiredSections,
    requiredArtifacts: artifactsFrom(directives),
    requiredEvidenceRoles: [],
    promptDirectives: directives
  };
}

async function readStrategyRow(taskId: string) {
  const [rows] = await getV5GovernancePool().query<StrategyRow[]>(
    `SELECT i.product_id, p.strategy_pack_id, sp.strategy_version, sp.status AS strategy_status,
       sp.content_plan_hash, sp.content_plan_json,
       atv.article_type_version_id, atv.definition_hash AS article_type_definition_hash,
       atv.definition_json AS article_type_definition_json,
       ec.id AS calibration_version_id, ec.directives_json AS calibration_directives,
       sf.feedback_json AS sample_revision_feedback
     FROM (
       SELECT id, product_id, content_type FROM content_matrix_item WHERE id = ?
       UNION ALL
       SELECT id, product_id, article_type_version_id AS content_type
       FROM product_sample_article_task WHERE id = ?
     ) i
     JOIN product_entity p ON p.id = i.product_id
     LEFT JOIN product_strategy_packs sp ON sp.id = p.strategy_pack_id
     LEFT JOIN product_strategy_article_type_versions atv
       ON atv.strategy_pack_id = sp.id AND atv.status IN ('active', 'frozen')
       AND (atv.article_type_version_id = i.content_type OR atv.article_type_id = i.content_type OR atv.name = i.content_type)
     LEFT JOIN expression_calibration_version ec
       ON ec.product_id = i.product_id AND ec.status = 'active'
     LEFT JOIN sample_article_feedback sf ON sf.id = (
       SELECT sf2.id FROM sample_article_feedback sf2
       WHERE sf2.product_id = i.product_id AND sf2.product_strategy_pack_id = sp.id
         AND sf2.decision = 'changes_requested'
       ORDER BY sf2.decided_at DESC LIMIT 1
     )
     WHERE i.id = ?
     ORDER BY ec.version_number DESC
     LIMIT 1`,
    [taskId, taskId, taskId]
  );
  const row = rows[0];
  if (!row) throw new V5GovernanceRepositoryError("formal_task_not_found", "正式内容任务不存在。", 404);
  if (!row.strategy_pack_id || !["strategy_approved", "pending_sample_review", "production_ready"].includes(String(row.strategy_status))) {
    throw new V5GovernanceRepositoryError("product_strategy_not_ready", "产品 GEO 策略尚未完成用户确认。", 409, "先在产品页确认策略包和文章类型，再生成样稿。");
  }
  if (!row.article_type_version_id || !row.article_type_definition_hash) {
    throw new V5GovernanceRepositoryError("strategy_article_type_mismatch", "任务没有绑定策略包中已确认的文章类型版本。", 409, "重新按当前策略展开内容任务，禁止回退到通用 Prompt。");
  }
  return row;
}

export async function compileFormalProductionContract(input: {
  taskId: string;
  pack: RagFinalEvidencePack;
  context: FormalGenerationContext;
  mode: "sample" | "batch" | "single";
}) {
  const row = await readStrategyRow(input.taskId);
  if (input.mode === "batch" && String(row.strategy_status) !== "production_ready") {
    throw new V5GovernanceRepositoryError(
      "sample_calibration_required",
      "批量生成前必须由用户验收示例正文，并将产品策略推进到 production_ready。",
      409,
      "先在正文预览页确认一篇示例正文；系统冻结表达校准版本后再启动批量生成。"
    );
  }
  if (input.mode === "batch" && !row.calibration_version_id) {
    throw new V5GovernanceRepositoryError(
      "active_calibration_required",
      "批量生成缺少已生效的样稿表达校准版本。",
      409,
      "重新确认示例正文或检查校准版本是否已激活。"
    );
  }
  const task = input.pack.taskSnapshot;
  const requiredFormat = expressionStrings(input.context.channelRequiredFormat);
  const prohibitedPatterns = expressionStrings(input.context.channelProhibitedPatterns);
  const calibrationDirectives = expressionStrings(row.calibration_directives);
  const sampleRevisionDirectives = input.mode === "sample"
    ? compileSampleRevisionDirectives(row.sample_revision_feedback)
    : [];
  const plan = parseV5Json<Record<string, unknown>>(row.content_plan_json, {});
  const positioning = parseV5Json<Record<string, unknown>>(JSON.stringify(plan.productPositioning || {}), {});
  const fixedExpressionConfig = parseV5Json<Record<string, unknown>>(JSON.stringify(plan.fixedExpression || {}), {});
  const fixedExpressionChannels = expressionStrings(fixedExpressionConfig.channels);
  const fixedExpressionPositions = expressionStrings(fixedExpressionConfig.positions)
    .filter((item): item is "opening" | "body" | "ending" => ["opening", "body", "ending"].includes(item));
  const taskChannel = String(task.channel || "").trim();
  const fixedExpression = resolveJotoOfficialFixedExpression(
    typeof fixedExpressionConfig.text === "string" ? fixedExpressionConfig.text : "",
    fixedExpressionChannels,
    taskChannel
  );
  return compileProductionContract({
    governance: {
      productId: String(row.product_id),
      productStrategyPackId: String(row.strategy_pack_id),
      productStrategyVersion: Number(row.strategy_version || 1),
      productStrategyHash: String(row.content_plan_hash),
      articleTypeVersionId: String(row.article_type_version_id),
      articleTypeDefinitionHash: String(row.article_type_definition_hash),
      expressionCalibrationVersionId: row.calibration_version_id ? String(row.calibration_version_id) : undefined,
      promptCompilerVersion: compilerVersion,
      productionMode: input.mode
    },
    task: {
      taskId: input.pack.taskId,
      taskVersion: input.pack.taskVersion,
      title: String(task.title || "").trim(),
      channel: taskChannel,
      contentType: String(task.contentType || "").trim(),
      targetAudience: String(task.targetAudience || "").trim(),
      coreProblem: String(task.sourceProblem || "").trim(),
      coreJudgment: expressionStrings(positioning).join("；") || "只陈述证据支持的能力、条件与人工判断边界。",
      targetEntityIds: [String(row.product_id)],
      primaryEntityId: String(row.product_id),
      promotionGoal: "geo_education",
      ctaIntent: "none",
      promotionRequired: false
    },
    evidencePack: evidenceSnapshot(input.pack),
    productRule: {
      rulePackageVersionId: input.context.rulePackageVersionId,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      allowedExpressions: expressionStrings(input.context.allowedExpressions),
      conditionalExpressions: expressionStrings(input.context.conditionalExpressions),
      blockedExpressions: expressionStrings(input.context.blockedExpressions),
      requiredEvidenceRoles: []
    },
    contentTypeRule: contentTypeRule(row, input.context),
    channelRule: {
      channelRuleVersionId: input.context.channelRuleVersionId,
      channel: String(task.channel || "").trim(),
      requiredSections: [],
      requiredArtifacts: artifactsFrom(requiredFormat),
      prohibitedTerms: prohibitedPatterns,
      maxCtaCount: 0,
      ctaRenderMode: "none",
      allowedCtaRenderModes: ["none"],
      requireCtaAtEnd: false,
      crossChannelSimilarityThreshold: 0.72,
      promptDirectives: [...requiredFormat, input.context.ctaBoundary, ...sampleRevisionDirectives]
    },
    expressionRule: {
      expressionProfileVersionId: String(task.platformExpressionProfileId || "platform-expression-snapshot"),
      prohibitedTerms: prohibitedPatterns,
      humanizerDirectives: expressionStrings(task.platformExpressionSnapshot),
      calibrationVersionId: row.calibration_version_id ? String(row.calibration_version_id) : undefined,
      calibrationDirectives: [...calibrationDirectives, ...sampleRevisionDirectives]
    },
    promotionProfiles: [],
    fixedExpressions: fixedExpression.text && fixedExpression.appliesToChannel
      ? [{ text: fixedExpression.text, positions: fixedExpressionPositions, channel: taskChannel }]
      : [],
    minTraceableFactCount: Math.min(8, input.pack.evidenceItems.length),
    requireHumanBoundary: true
  });
}

export async function persistProductionContractSnapshot(input: {
  contract: ProductionContractSnapshot;
  actor: SingleArticleActor;
}) {
  const id = `production-contract-${input.contract.contractHash.slice(0, 44)}`;
  await withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO production_contract_snapshot
       (id, contract_version, contract_hash, task_id, task_version, product_id, product_strategy_pack_id,
        article_type_version_id, expression_calibration_version_id, final_evidence_pack_id, production_mode,
        contract_json, created_by, immutable_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE id = id`,
      [id, input.contract.contractVersion, input.contract.contractHash, input.contract.task.taskId,
        input.contract.task.taskVersion, input.contract.governance.productId,
        input.contract.governance.productStrategyPackId, input.contract.governance.articleTypeVersionId,
        input.contract.governance.expressionCalibrationVersionId || null, input.contract.evidencePack.evidencePackId,
        input.contract.governance.productionMode, stringifyV5Json(input.contract), input.actor.actorId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "production_contract_frozen",
      objectType: "production_contract_snapshot",
      objectId: id,
      afterSummary: { contractHash: input.contract.contractHash, taskId: input.contract.task.taskId, mode: input.contract.governance.productionMode },
      correlationId: id
    });
  });
  return { productionContractId: id, contract: input.contract };
}
