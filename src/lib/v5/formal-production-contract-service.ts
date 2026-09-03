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
import { ensureNarrativeSubjectTitle } from "./geo-article-title-policy";

export function resolveJotoOfficialFixedExpression(
  text: string,
  channels: string[],
  taskChannel: string
) {
  const normalizedText = text.trim();
  return {
    text: normalizedText,
    appliesToChannel: Boolean(normalizedText) && (!channels.length || channels.includes(taskChannel))
  };
}
import type { SingleArticleActor } from "./single-article-contracts";
import type { FormalGenerationContext } from "./single-article-production-repository";
import { assertGeoArticleMission, type GeoArticleMissionContract } from "./geo-article-mission-contracts";

const compilerVersion = "production-contract-compiler.v3" as const;

interface StrategyRow extends RowDataPacket {
  product_id: string;
  canonical_name: string;
  display_name: string;
  brand_name: string | null;
  official_entity: string | null;
  entity_relationship: string | null;
  aliases: unknown;
  strategy_pack_id: string | null;
  strategy_version: number | null;
  strategy_status: string | null;
  strategy_approved_at: string | Date | null;
  strategy_approved_by: string | null;
  content_plan_hash: string | null;
  content_plan_json: unknown;
  article_type_version_id: string | null;
  article_type_name: string | null;
  article_type_definition_hash: string | null;
  article_type_definition_json: unknown;
  calibration_version_id: string | null;
  calibration_directives: unknown;
  calibration_sample_markdown: string | null;
  sample_revision_feedback: unknown;
}

function relevanceUnits(value: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ");
  const ignored = new Set([
    "腾讯", "腾讯云", "joto", "adp", "产品", "企业", "平台", "能力", "服务", "提供",
    "文章", "问题", "如何", "什么", "哪些", "是否", "进行", "需要", "相关", "可以",
    "智能", "智能体", "开发", "解决", "方案", "使用", "支持", "落地"
  ]);
  const units = new Set<string>();
  for (const token of normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || []) {
    if (/^[a-z0-9]+$/.test(token)) {
      if (token.length >= 3 && !ignored.has(token)) units.add(token);
      continue;
    }
    for (const size of [4, 3, 2]) {
      for (let index = 0; index <= token.length - size; index += 1) {
        const unit = token.slice(index, index + size);
        if (!ignored.has(unit)) units.add(unit);
      }
    }
  }
  return units;
}

function missionEvidenceBonus(query: string, evidenceText: string) {
  // “成熟度/行业积累” cannot be supported well by a generic delivery claim.
  // Prefer governed facts that demonstrate breadth through explicit coverage
  // and concrete enumerations. Keep this independent of any product name.
  if (!/(?:行业.{0,8}(?:积累|成熟度)|(?:积累|成熟度).{0,8}行业|行业覆盖|覆盖.{0,6}行业)/.test(query)) return 0;
  const breadthSignal = /(?:重点)?覆盖.{0,18}行业|行业场景|典型场景/.test(evidenceText) ? 30 : 0;
  const enumerationCount = (evidenceText.match(/[、，；;]/g) || []).length;
  return breadthSignal + Math.min(30, enumerationCount * 3);
}

export function selectRequiredCoreClaimIds(pack: RagFinalEvidencePack, mission?: GeoArticleMissionContract) {
  const evidenceById = new Map(pack.evidenceItems.map((item) => [item.evidenceItemId, item]));
  const slotClaimIds = pack.claimPlan.slots
    .filter((slot) => slot.required && slot.status === "satisfied")
    .flatMap((slot) => slot.selectedEvidenceItemIds.slice(0, 1))
    .flatMap((evidenceItemId) => {
      const item = evidenceById.get(evidenceItemId);
      return item?.primaryClaimId ? [item.primaryClaimId] : [];
    });
  if (mission) {
    const query = [
      String((pack.taskSnapshot as Record<string, unknown>).title || ""),
      mission.primaryQuestion,
      ...mission.titlePromiseDimensions
    ].join(" ");
    const queryUnits = relevanceUnits(query);
    const slotClaims = new Set(slotClaimIds);
    const ranked = pack.evidenceItems.flatMap((item, index) => {
      // The identity Claim is frozen in EvidencePack for governance and exact
      // system assembly. It must not be selected as the model-authored core
      // article Claim, otherwise the writer and deterministic identity block
      // compete for the same sentence.
      if (item.documentType === "governed_entity_graph" || item.allowedUsage?.includes("entity_identity")) return [];
      if (item.evidenceUsage && item.evidenceUsage !== "product_fact") return [];
      if (item.subjectEntityIds?.length && !item.subjectEntityIds.includes(mission.primaryEntityId)) return [];
      if (!item.primaryClaimId) return [];
      const evidenceUnits = relevanceUnits(`${item.normalizedClaim || ""} ${item.summary} ${item.originalQuote}`);
      const matched = [...queryUnits].filter((unit) => evidenceUnits.has(unit));
      const evidenceText = `${item.normalizedClaim || ""} ${item.summary} ${item.originalQuote}`;
      const semanticScore = matched.reduce((sum, unit) => sum + (/^[a-z0-9]+$/.test(unit) ? 12 : unit.length), 0)
        + missionEvidenceBonus(query, evidenceText);
      return semanticScore > 0 ? [{ claimId: item.primaryClaimId, semanticScore, slotBonus: slotClaims.has(item.primaryClaimId) ? 1 : 0, index }] : [];
    }).sort((left, right) => right.semanticScore - left.semanticScore || right.slotBonus - left.slotBonus || left.index - right.index);
    // A required Claim must be relevant to this article mission. If the pack
    // contains no relevant product fact, return no Claim and let the A-layer
    // rubric block generation instead of forcing an unrelated fact into prose.
    return ranked.length ? [ranked[0].claimId] : [];
  }
  if (slotClaimIds.length) return Array.from(new Set(slotClaimIds));

  const availableClaimIds = new Set(pack.evidenceItems.flatMap((item) => item.claimIds));
  const plannedCoreClaim = pack.claimPlan.requiredClaimIds.find((claimId) => availableClaimIds.has(claimId));
  if (plannedCoreClaim) return [plannedCoreClaim];
  const firstEvidenceClaim = pack.evidenceItems.find((item) =>
    item.primaryClaimId && item.documentType !== "governed_entity_graph" && !item.allowedUsage?.includes("entity_identity")
  )?.primaryClaimId;
  return firstEvidenceClaim ? [firstEvidenceClaim] : [];
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

function explicitArtifacts(value: unknown): ProductionArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProductionArtifact => ["table", "list", "state_flow", "code_block"].includes(String(item)));
}

function expressionStrings(value: unknown) {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(expressionStrings);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return ["text", "description", "action", "pattern", "value", "label", "purpose", "guidance", "rules", "items", "requirements", "boundaries", "conditions", "limitations"]
    .flatMap((key) => expressionStrings(record[key]));
}

function prohibitedExpressionStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.length > 160) return [];
    if (/https?:\/\/|\.docx\b|\.pdf\b|^表\s*\d|^编号[：:]|^整理依据[：:]|^输出格式[：:]|资料类型|搜索词或问题/.test(text)) return [];
    return [text];
  }
  if (Array.isArray(value)) return value.flatMap(prohibitedExpressionStrings);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  // Governance labels, descriptions and reasons explain why a rule exists;
  // only the governed outward-facing text is eligible for literal blocking.
  return prohibitedExpressionStrings(record.text ?? record.pattern ?? record.value);
}

export function compileSampleRevisionDirectives(value: unknown) {
  const feedback = parseV5Json<Record<string, unknown>>(value, {});
  const directInstruction = typeof feedback.revisionInstruction === "string"
    ? feedback.revisionInstruction.trim()
    : "";
  const issues = Array.isArray(feedback.issues) ? feedback.issues : [];
  return Array.from(new Set([
    ...(directInstruction ? [`用户对上一版样文的修改要求：${directInstruction}`] : []),
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
      evidenceUsage: item.evidenceUsage,
      subjectEntityIds: item.subjectEntityIds,
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

function normalizeProductionTitle(value: string) {
  let title = value.trim().replace(/[。.]+/g, "").replace(/\s+([，。？！；：])/g, "$1");
  const questionCount = (title.match(/[？?]/g) || []).length;
  if (questionCount > 1) {
    let seen = 0;
    title = title.replace(/[？?]/g, () => (++seen < questionCount ? "，" : "？"));
  }
  return title.replace(/[，,；;：:、]+$/g, "");
}

function contentTypeRule(row: StrategyRow, context: FormalGenerationContext): ContentTypeRuleSnapshot {
  const definition = parseV5Json<Record<string, unknown>>(row.article_type_definition_json, {});
  const sampleStandard = definition.sampleStandard && typeof definition.sampleStandard === "object"
    ? definition.sampleStandard as Record<string, unknown>
    : {};
  const modules = Array.isArray(definition.structureModules) ? definition.structureModules : [];
  const requiredSections = modules.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    return value.required === false ? [] : [String(value.key || value.label || "").trim()].filter(Boolean);
  });
  const length = definition.lengthRange && typeof definition.lengthRange === "object"
    ? definition.lengthRange as Record<string, unknown>
    : definition.length && typeof definition.length === "object"
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
    ...expressionStrings(sampleStandard),
    context.systemPrompt,
    context.userPromptTemplate
  ].filter(Boolean);
  const articleTypeName = String(row.article_type_name || "");
  const governedArtifacts: ProductionArtifact[] = [
    ...(/(?:行业.*方案|AgentOps|全生命周期|服务商选型|实施伙伴|职责边界)/i.test(articleTypeName) ? ["table" as const] : []),
    ...(/(?:服务商选型|实施伙伴|职责边界)/i.test(articleTypeName) ? ["list" as const] : [])
  ];
  return {
    articleTypeProfileVersionId: String(row.article_type_version_id),
    promptConstraintSnapshotHash: String(row.article_type_definition_hash),
    ctaIntent: "contact_service",
    minLength: Number.isInteger(minLength) && minLength > 0 ? minLength : 800,
    maxLength: Number.isInteger(maxLength) && maxLength >= minLength ? maxLength : 3000,
    requiredSections,
    requiredArtifacts: Array.from(new Set([
      ...explicitArtifacts(sampleStandard.requiredArtifacts),
      ...artifactsFrom(directives),
      ...governedArtifacts
    ])),
    requiredEvidenceRoles: [],
    argumentOrder: expressionStrings(sampleStandard.argumentOrder),
    promptDirectives: directives
  };
}

async function readStrategyRow(taskId: string) {
  const [rows] = await getV5GovernancePool().query<StrategyRow[]>(
    `SELECT i.product_id, p.canonical_name, p.display_name, p.brand_name, p.official_entity,
       p.entity_relationship, p.aliases, p.strategy_pack_id, sp.strategy_version, sp.status AS strategy_status,
       sp.strategy_approved_at, sp.strategy_approved_by,
       sp.content_plan_hash, sp.content_plan_json,
       atv.article_type_version_id, atv.name AS article_type_name, atv.definition_hash AS article_type_definition_hash,
       atv.definition_json AS article_type_definition_json,
       ec.id AS calibration_version_id, ec.directives_json AS calibration_directives,
       calibration_draft.markdown AS calibration_sample_markdown,
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
       ON ec.product_id = i.product_id AND ec.product_strategy_pack_id = sp.id
      AND ec.article_type_version_id = atv.article_type_version_id AND ec.status = 'active'
     LEFT JOIN draft_version calibration_draft ON calibration_draft.id = ec.source_sample_draft_id
     LEFT JOIN sample_article_feedback sf ON sf.id = (
       SELECT sf2.id FROM sample_article_feedback sf2
       WHERE sf2.product_id = i.product_id AND sf2.product_strategy_pack_id = sp.id
         AND sf2.draft_version_id IN (SELECT d.id FROM draft_version d WHERE d.task_id = i.id)
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
  const rawGeoMission = task.geoMission;
  if (!rawGeoMission || typeof rawGeoMission !== "object" || Array.isArray(rawGeoMission)) {
    throw new V5GovernanceRepositoryError("geo_article_mission_missing", "EvidencePack 没有冻结 GEO 文章任务合同。", 409, "按当前产品策略重新检索并冻结 EvidencePack。");
  }
  const geoMission = rawGeoMission as GeoArticleMissionContract;
  try { assertGeoArticleMission(geoMission); } catch {
    throw new V5GovernanceRepositoryError("geo_article_mission_invalid", "EvidencePack 中的 GEO 文章任务合同无效。", 409, "重新生成文章任务并检索证据。");
  }
  const requiredFormat = expressionStrings(input.context.channelRequiredFormat);
  const prohibitedPatterns = prohibitedExpressionStrings(input.context.channelProhibitedPatterns);
  const calibrationDirectives = expressionStrings(row.calibration_directives);
  const acceptedSampleReference = input.mode === "batch" && row.calibration_sample_markdown
    ? [
        "以下正文是用户为当前文章类型确认的表达样本。只参考它的叙事节奏、段落密度、信息组织和语气，不照抄题目、句子或具体事实：",
        String(row.calibration_sample_markdown).slice(0, 8000)
      ]
    : [];
  const sampleRevisionDirectives = input.mode === "sample"
    ? compileSampleRevisionDirectives(row.sample_revision_feedback)
    : [];
  const plan = parseV5Json<Record<string, unknown>>(row.content_plan_json, {});
  const positioning = parseV5Json<Record<string, unknown>>(JSON.stringify(plan.productPositioning || {}), {});
  const coreExpressions = parseV5Json<Record<string, unknown>>(JSON.stringify(plan.coreExpressions || {}), {});
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
  const strategyIdentity = String(coreExpressions.fixedExpression || "").trim();
  const strategyCtaLabel = String(coreExpressions.ctaLabel || "").trim();
  const strategyCtaUrl = String(coreExpressions.ctaUrl || "").trim();
  const strategyCtaEnabled = Boolean(strategyCtaLabel && strategyCtaUrl);
  const strategyChannels = expressionStrings(coreExpressions.channels);
  const identityApplies = !strategyChannels.length || strategyChannels.includes(taskChannel);
  const promotionProfiles = strategyCtaEnabled ? [{
    promotionProfileVersionId: `strategy-cta-${String(row.content_plan_hash).slice(0, 32)}`,
    version: Number(row.strategy_version || 1),
    status: "active" as const,
    targetEntityIds: [geoMission.primaryEntityId],
    excludedEntityIds: [],
    applicableProductGroups: [],
    articleScope: "single_product" as const,
    promotionGoal: "",
    ctaIntent: "contact_service" as const,
    applicableContentTypes: [],
    applicableTitleCategories: [],
    allowMultiProduct: false,
    requiresPrimaryEntity: true,
    priority: 100,
    variants: [{
      ctaVariantId: `strategy-cta-variant-${String(row.content_plan_hash).slice(0, 24)}`,
      channel: "*" as const,
      label: strategyCtaLabel,
      publicUrl: strategyCtaUrl,
      identityClaimIds: [],
      serviceClaimIds: [],
      allowedRenderModes: ["markdown_link"],
      status: "active" as const
    }],
    approvedBy: String(row.strategy_approved_by || "human-strategy-approval"),
    approvedAt: row.strategy_approved_at ? new Date(row.strategy_approved_at).toISOString() : "1970-01-01T00:00:00.000Z"
  }] : [];
  const compiledContentTypeRule = {
    ...contentTypeRule(row, input.context),
    ctaIntent: strategyCtaEnabled ? "contact_service" as const : "none" as const
  };
  const sampleContentTypeRule = input.mode === "sample"
    ? {
        ...compiledContentTypeRule,
        requiredSections: [],
        promptDirectives: [
          ...compiledContentTypeRule.promptDirectives,
          "文章类型定义用于确定叙事方向，不要求按模块名称逐节填充。围绕读者问题形成一条自然主线。",
          "没有正式案例或效果数据证据时，不要用泛化案例、虚构指标或空洞管理建议补足篇幅。"
        ]
      }
    : compiledContentTypeRule;
  const governedTitle = normalizeProductionTitle(ensureNarrativeSubjectTitle({
    title: normalizeProductionTitle(String(task.title || "")),
    productName: String(row.display_name || row.canonical_name || ""),
    narrativeSubjectName: geoMission.narrativeSubjectName,
    narrativeSubjectRole: geoMission.narrativeSubjectRole
  }));
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
      productionMode: input.mode,
      geoIntentHash: geoMission.geoIntentHash,
      entityGraphHash: geoMission.entityGraph.graphHash
    },
    geoMission,
    task: {
      taskId: input.pack.taskId,
      taskVersion: input.pack.taskVersion,
      title: governedTitle,
      channel: taskChannel,
      contentType: String(task.contentType || "").trim(),
      targetAudience: String(task.targetAudience || "").trim(),
      coreProblem: geoMission.primaryQuestion,
      coreJudgment: geoMission.desiredAnswer || expressionStrings(positioning).join("；") || "只陈述证据支持的能力、条件与人工判断边界。",
      // Promotion targeting contains products only. Brand owners and service
      // providers remain in entityGraph, otherwise a single-product article is
      // incorrectly resolved as a multi-product CTA task.
      targetEntityIds: [geoMission.primaryEntityId],
      primaryEntityId: geoMission.primaryEntityId,
      promotionGoal: geoMission.promotionGoal,
      ctaIntent: strategyCtaEnabled ? "contact_service" : "none",
      promotionRequired: strategyCtaEnabled
    },
    evidencePack: evidenceSnapshot(input.pack),
    productRule: {
      rulePackageVersionId: input.context.rulePackageVersionId,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      allowedExpressions: expressionStrings(input.context.allowedExpressions),
      conditionalExpressions: expressionStrings(input.context.conditionalExpressions),
      blockedExpressions: prohibitedExpressionStrings(input.context.blockedExpressions),
      requiredEvidenceRoles: []
    },
    contentTypeRule: sampleContentTypeRule,
    channelRule: {
      channelRuleVersionId: input.context.channelRuleVersionId,
      channel: String(task.channel || "").trim(),
      requiredSections: [],
      requiredArtifacts: artifactsFrom(requiredFormat),
      prohibitedTerms: prohibitedPatterns,
      maxCtaCount: strategyCtaEnabled ? 1 : 0,
      ctaRenderMode: strategyCtaEnabled ? "markdown_link" : "none",
      allowedCtaRenderModes: strategyCtaEnabled ? ["markdown_link"] : ["none"],
      requireCtaAtEnd: strategyCtaEnabled,
      crossChannelSimilarityThreshold: 0.72,
      promptDirectives: [...requiredFormat, input.context.ctaBoundary, ...sampleRevisionDirectives]
    },
    expressionRule: {
      expressionProfileVersionId: String(task.platformExpressionProfileId || "platform-expression-snapshot"),
      prohibitedTerms: prohibitedPatterns,
      humanizerDirectives: expressionStrings(task.platformExpressionSnapshot),
      calibrationVersionId: row.calibration_version_id ? String(row.calibration_version_id) : undefined,
      calibrationDirectives: [...calibrationDirectives, ...acceptedSampleReference, ...sampleRevisionDirectives]
    },
    promotionProfiles,
    fixedExpressions: strategyIdentity && identityApplies
      ? [{ text: strategyIdentity, positions: ["opening"], channel: taskChannel }]
      : fixedExpression.text && fixedExpression.appliesToChannel
        ? [{ text: fixedExpression.text, positions: fixedExpressionPositions.length ? fixedExpressionPositions : ["opening"], channel: taskChannel }]
        : [],
    // Only the highest-priority governed Claim is mandatory. Additional facts
    // remain available to the writer, but cannot turn the article into a
    // mechanical evidence checklist.
    requiredCoreClaimIds: selectRequiredCoreClaimIds(input.pack, geoMission).slice(0, 1),
    entityIdentity: {
      productId: String(row.product_id),
      canonicalName: String(row.canonical_name),
      displayName: String(row.display_name),
      aliases: parseV5Json<string[]>(row.aliases, []),
      brandName: row.brand_name ? String(row.brand_name) : undefined,
      officialEntity: row.official_entity ? String(row.official_entity) : undefined,
      entityRelationship: row.entity_relationship ? String(row.entity_relationship) : undefined
    }
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
