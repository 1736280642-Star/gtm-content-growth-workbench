import type {
  GeoMentionBaseline,
  GeoResearchEvidence,
  GeoResearchFinding,
  GeoResearchQuestionCatalog,
  GeoResearchReadiness,
  GeoResearchRetestBinding,
  GeoResearchRun,
  GeoResearchTask
} from "./geo-research-contracts";
import { getGeoResearchProviderReadiness } from "./geo-research-provider";
import { evaluateTargetChannelRuleCoverage, getActiveGeoChannelRulePack } from "./geo-channel-rule-pack";
import {
  approveGeoBlueprintRecord,
  cancelStaleGeoResearchRunRecord,
  confirmGeoResearchQuestionFindingsRecord,
  createGeoResearchProjectRecord,
  createGeoResearchRunRecord,
  readActiveGeoResearchGovernanceBinding,
  readGeoResearchRunWorkspace,
  readGeoResearchWorkspace,
  readGeoMentionBaselineByRunId,
  readLatestGeoSourceSnapshot,
  readPreviousGeoMentionBaseline,
  requestGeoBlueprintChangesRecord,
  updateGeoResearchProjectRecord
} from "./geo-research-repository";
import { getActiveProduct } from "./product-registry-service";
import type { ProductRegistryItem } from "./product-registry-contracts";
import { ingestV5QuestionSignals } from "./question-service";
import { hashV5GovernancePayload, type V5GovernanceActor } from "./knowledge-governance-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";
import { readProductKnowledgeProfile } from "./product-knowledge-profile";
import { readProductWebsiteCoverageProfile } from "./website-coverage-repository";
import { buildGeoResearchDownstreamCandidates } from "./geo-research-downstream";
import type { ProbeSetSnapshot } from "./geo-probe-contracts";
import { readLatestClosedProductGeoOptimizationSnapshot } from "./product-geo-optimization-repository";

function assertText(value: string | undefined, field: string, maxLength = 255) {
  if (!value?.trim()) {
    throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
  }
  if (value.trim().length > maxLength) {
    throw new V5GovernanceServiceError("invalid_contract", `${field} 不能超过 ${maxLength} 个字符。`, 400);
  }
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId", 128);
  assertText(actor.actorRole, "actorRole", 128);
  assertText(actor.actorType, "actorType", 32);
  assertText(actor.auditReason, "auditReason", 500);
}

function assertStringList(values: string[] | undefined, field: string, maxItems = 50) {
  if (!values) return;
  if (values.length > maxItems || values.some((item) => typeof item !== "string" || !item.trim())) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      `${field} 必须是至多 ${maxItems} 项的非空字符串数组。`,
      400
    );
  }
}

function targetChannelRuleBlockedReason(targetChannels: string[]) {
  try {
    return evaluateTargetChannelRuleCoverage({
      targetChannels,
      pack: getActiveGeoChannelRulePack()
    });
  } catch (packError) {
    return evaluateTargetChannelRuleCoverage({ targetChannels, pack: undefined, packError });
  }
}

async function resolveGeoRetestBinding(
  productId: string,
  workspace: Awaited<ReturnType<typeof readGeoResearchWorkspace>>
): Promise<GeoResearchRetestBinding> {
  const blueprint = workspace?.currentBlueprint;
  if (!blueprint || blueprint.status !== "approved" || !blueprint.approvedAt) {
    throw new V5GovernanceServiceError(
      "retest_blueprint_missing",
      "发布后复测必须绑定已批准的 GEO 蓝图。",
      409,
      "先完成正式调研并由人工批准蓝图。"
    );
  }
  const snapshot = await readLatestClosedProductGeoOptimizationSnapshot({
    productId,
    generatedAfter: blueprint.approvedAt,
    blueprintVersionId: blueprint.blueprintVersionId
  });
  if (!snapshot) {
    throw new V5GovernanceServiceError(
      "retest_published_batch_missing",
      "蓝图批准后尚无完成发布存活与 AI 采集的关闭批次，不能启动发布后复测。",
      409,
      "等待 Content Monitor 中对应产品批次关闭后重试。"
    );
  }
  return {
    blueprintVersionId: blueprint.blueprintVersionId,
    baselineRunId: blueprint.runId,
    blueprintApprovedAt: blueprint.approvedAt,
    optimizationSnapshotId: snapshot.id,
    batchKey: snapshot.batchKey,
    matrixVersionId: snapshot.matrixVersionId,
    strategyPackId: snapshot.strategyPackId,
    inputEvidenceHash: snapshot.inputEvidenceHash,
    batchClosedAt: snapshot.generatedAt
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, maxItems)
    : [];
}

function normalizedQuestion(value: string) {
  return value.toLowerCase().replace(/[\s，。！？、：；“”"'（）()\-—_]/g, "");
}

export function buildGeoResearchQuestionCatalog(input: {
  product: Pick<ProductRegistryItem, "productId" | "displayName" | "confirmedAt">;
  run: GeoResearchRun;
  tasks: GeoResearchTask[];
  evidence: GeoResearchEvidence[];
  findings: GeoResearchFinding[];
  latestSourceSnapshotHash?: string;
}): GeoResearchQuestionCatalog {
  const discoveryTask = input.tasks.find((task) => task.taskType === "live_question_discovery");
  const rawQuestions = Array.isArray(discoveryTask?.outputSummary.questions)
    ? discoveryTask.outputSummary.questions
    : [];
  const metadataByQuestion = new Map<string, Record<string, unknown>>();
  for (const raw of rawQuestions) {
    const item = asRecord(raw);
    if (typeof item.text === "string" && item.text.trim()) metadataByQuestion.set(normalizedQuestion(item.text), item);
  }
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  const items = input.findings
    .filter((finding) => finding.findingType === "question_opportunity")
    .map((finding) => {
      const metadata = metadataByQuestion.get(normalizedQuestion(finding.title)) || {};
      const sources = finding.evidenceIds.flatMap((evidenceId) => {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence?.sourceUrl || evidence.verificationStatus !== "verified") return [];
        return [{
          evidenceId,
          url: evidence.sourceUrl,
          title: evidence.sourceTitle,
          publisher: evidence.publisher,
          query: evidence.queryText
        }];
      });
      return {
        findingId: finding.findingId,
        question: finding.title,
        intent: typeof metadata.intent === "string" ? metadata.intent : finding.summary,
        audience: typeof metadata.audience === "string" ? metadata.audience : undefined,
        module: typeof metadata.module === "string" && metadata.module.trim() ? metadata.module.trim() : "uncategorized",
        priority: typeof metadata.priority === "number" ? Math.max(0, Math.min(1, metadata.priority)) : finding.confidence,
        confidence: finding.confidence,
        suggestedArticleTypes: strings(metadata.suggestedArticleTypes),
        keywords: strings(metadata.keywords),
        sourceEvidenceIds: sources.map((source) => source.evidenceId),
        sources,
        reviewStatus: finding.reviewStatus
      };
    })
    .sort((left, right) => right.priority - left.priority || left.question.localeCompare(right.question, "zh-CN"));
  const importedCount = items.filter((item) => item.reviewStatus === "confirmed").length;
  const liveSearchVerified = discoveryTask?.outputSummary.liveSearchVerified === true;
  const staleReasons = [
    !input.latestSourceSnapshotHash
      ? "当前产品还没有可用的最新资料快照"
      : input.run.inputSourceSnapshotHash !== input.latestSourceSnapshotHash
        ? "本次运行使用的资料快照已不是最新版本"
        : undefined,
    input.product.confirmedAt && Date.parse(input.product.confirmedAt) > Date.parse(input.run.createdAt)
      ? "产品实体关系在本次运行后重新确认过"
      : undefined
  ].filter((item): item is string => Boolean(item));
  const moduleCounts = new Map<string, number>();
  for (const item of items) moduleCounts.set(item.module, (moduleCounts.get(item.module) || 0) + 1);
  const status = importedCount === items.length && items.length > 0
    ? "imported" as const
    : importedCount > 0
      ? "partially_imported" as const
      : liveSearchVerified && discoveryTask?.status === "completed"
        ? "ready_for_review" as const
        : "collecting" as const;
  return {
    catalogId: `geo-question-catalog-${input.run.runId}`,
    runId: input.run.runId,
    productId: input.product.productId,
    productName: input.product.displayName,
    status,
    liveSearchVerified,
    confirmable: liveSearchVerified && staleReasons.length === 0,
    staleReasons,
    totalCount: items.length,
    verifiedCount: items.filter((item) => item.sources.length > 0).length,
    importedCount,
    modules: [...moduleCounts.entries()].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || a.module.localeCompare(b.module)),
    items
  };
}

function suggestedArticleTypesForQuestion(question: string) {
  if (/对比|区别|选择|选型|是否需要|哪个好/.test(question)) return ["选型与比较"];
  if (/如何|怎么|步骤|准备|部署|实施|迁移|接入|配置/.test(question)) return ["实施指南"];
  if (/报错|异常|排查|性能|接口|API|架构|技术/.test(question)) return ["技术实践"];
  if (/场景|适合|能否用于|可以用在/.test(question)) return ["场景解决方案"];
  return ["FAQ"];
}

export async function getGeoResearchWorkspace(productId: string) {
  assertText(productId, "productId", 64);
  const product = await getActiveProduct(productId);
  const [workspace, latestSourceSnapshot, productProfile, websiteCoverageProfile] = await Promise.all([
    readGeoResearchWorkspace(productId),
    readLatestGeoSourceSnapshot(productId),
    readProductKnowledgeProfile(productId, product.displayName),
    readProductWebsiteCoverageProfile(productId)
  ]);
  const provider = getGeoResearchProviderReadiness();
  const sourceSnapshotReady = latestSourceSnapshot?.quality.status === "ready";
  // M9 渠道规则包校验：targetChannels 中的第三方平台渠道必须有已激活的规则包且覆盖（fail-closed）；
  // 自有渠道（公众号/官网/AI 前台）不依赖平台收录规则包，不参与校验。
  const targetChannels = workspace?.project.targetChannels || [];
  let channelRuleBlockedReason: string | undefined;
  try {
    channelRuleBlockedReason = evaluateTargetChannelRuleCoverage({
      targetChannels,
      pack: getActiveGeoChannelRulePack()
    });
  } catch (packError) {
    channelRuleBlockedReason = evaluateTargetChannelRuleCoverage({ targetChannels, pack: undefined, packError });
  }
  const checks: GeoResearchReadiness["checks"] = [
    {
      key: "product_identity",
      label: "产品身份",
      status: product.confirmedAt ? "ready" : "blocked",
      detail: product.confirmedAt ? "产品实体已人工确认。" : "产品实体还没有人工确认记录。"
    },
    {
      key: "research_boundary",
      label: "研究边界",
      status: !workspace || channelRuleBlockedReason ? "blocked" : "ready",
      detail: !workspace
        ? "还没有创建 GEO 调研项目。"
        : channelRuleBlockedReason || "表达重点、市场、语言和渠道已保存。",
      actionLabel: workspace ? undefined : "补充研究边界",
      actionHref: workspace ? undefined : `/products/${encodeURIComponent(productId)}/research`
    },
    {
      key: "source_snapshot",
      label: "产品资料快照",
      status: sourceSnapshotReady ? "ready" : "blocked",
      detail: sourceSnapshotReady && latestSourceSnapshot
        ? `已冻结 ${latestSourceSnapshot.sourceCount} 个资料源、${latestSourceSnapshot.approvedClaimCount} 条已批准事实；其中 ${latestSourceSnapshot.quality.officialSourceCount} 个正式来源可公开追溯。`
        : latestSourceSnapshot
          ? `资料快照未达到正式调研标准：${latestSourceSnapshot.quality.issues.join("；")}`
        : "尚未形成可追溯的 SourceSnapshot，不能创建研究运行。",
      actionLabel: sourceSnapshotReady ? undefined : "补充正式产品资料",
      actionHref: sourceSnapshotReady ? undefined : `/products/${encodeURIComponent(productId)}?tab=materials`
    },
    {
      key: "website_coverage",
      label: "官网覆盖基线",
      status: websiteCoverageProfile && websiteCoverageProfile.publicGeoReadiness !== "pending_audit" ? "ready" : "blocked",
      detail: !websiteCoverageProfile
        ? "尚未从产品知识库中的正式官网 URL 形成覆盖画像。"
        : websiteCoverageProfile.publicGeoReadiness === "pending_audit"
          ? "正式官网 URL 已登记，正在等待自动基线审计完成。"
          : `官网知识准备度为 ${websiteCoverageProfile.knowledgeReadiness}，公开 GEO 准备度为 ${websiteCoverageProfile.publicGeoReadiness}；该结果将直接约束内容类型组合。`,
      actionLabel: websiteCoverageProfile ? undefined : "添加正式官网 URL",
      actionHref: websiteCoverageProfile ? undefined : `/products/${encodeURIComponent(productId)}?tab=materials`
    },
    {
      key: "live_search_provider",
      label: "联网研究 Provider",
      status: provider.status,
      detail: provider.status === "ready"
        ? "智谱、豆包、千问事实搜索已配置；智谱负责统一语义综合。"
        : "任务链可以先建立，但事实搜索会等待三家 Provider 配置完成。",
      actionLabel: provider.status === "ready" ? undefined : "查看待配置字段",
      actionHref: provider.status === "ready" ? undefined : "/settings?tab=models",
      missingConfig: provider.missingConfig
    }
  ];
  const hasBlockedCheck = checks.some((check) => check.status === "blocked");
  const readiness: GeoResearchReadiness = {
    status: hasBlockedCheck ? "blocked" : provider.status,
    canCreateRun: !hasBlockedCheck,
    canExecuteLiveResearch: !hasBlockedCheck && provider.status === "ready",
    latestSourceSnapshot,
    checks
  };
  return { product, productProfile, websiteCoverageProfile, workspace, readiness };
}

/** post_publish_retest 差值归因：对比复测基线与前次基线的提及率变化（确定性计算，不经 LLM）。 */
function buildMentionDeltaAttribution(current: GeoMentionBaseline, previous: GeoMentionBaseline) {
  const normalize = (value: string) => value.trim().replace(/[？?。.!！\s]+$/g, "").toLowerCase();
  const previousMentioned = new Set(previous.mentionedQuestions.map(normalize));
  const currentMentioned = new Set(current.mentionedQuestions.map(normalize));
  return {
    baselineMentionRate: previous.targetMentionRate,
    retestMentionRate: current.targetMentionRate,
    mentionRateDelta: Number((current.targetMentionRate - previous.targetMentionRate).toFixed(4)),
    newlyMentionedQuestions: current.mentionedQuestions.filter((question) => !previousMentioned.has(normalize(question))),
    lostMentionQuestions: previous.mentionedQuestions.filter((question) => !currentMentioned.has(normalize(question))),
    baselineCapturedAt: previous.capturedAt,
    retestCapturedAt: current.capturedAt
  };
}

export async function getGeoResearchRunDetails(input: { productId: string; runId: string }) {
  assertText(input.productId, "productId", 64);
  assertText(input.runId, "runId", 64);
  const product = await getActiveProduct(input.productId);
  const [runWorkspace, latestSourceSnapshot] = await Promise.all([
    readGeoResearchRunWorkspace(input),
    readLatestGeoSourceSnapshot(input.productId)
  ]);
  if (!runWorkspace) {
    throw new V5GovernanceServiceError("research_run_not_found", "GEO 调研运行不存在。", 404);
  }
  const probeSetSnapshot = runWorkspace.run.plan.probeSetSnapshot && typeof runWorkspace.run.plan.probeSetSnapshot === "object"
    ? runWorkspace.run.plan.probeSetSnapshot as ProbeSetSnapshot
    : undefined;
  // 下游候选扩展：问题板块映射（live_question_discovery）与蓝图内链集群/复测基线（blueprint_synthesis）
  const faqBoardByQuestion = new Map<string, string>();
  const discoveryTask = runWorkspace.tasks.find((task) => task.taskType === "live_question_discovery");
  if (Array.isArray(discoveryTask?.outputSummary.questions)) {
    for (const raw of discoveryTask.outputSummary.questions) {
      const item = asRecord(raw);
      if (typeof item.text !== "string" || !item.text.trim()) continue;
      if (typeof item.faqBoard !== "string" || !item.faqBoard.trim()) continue;
      faqBoardByQuestion.set(normalizedQuestion(item.text), item.faqBoard.trim());
    }
  }
  const blueprintTask = runWorkspace.tasks.find((task) => task.taskType === "blueprint_synthesis");
  const blueprintSummary = blueprintTask?.outputSummary || {};
  const retestBaseline = asRecord(blueprintSummary.retestBaseline);
  const downstreamCandidates = runWorkspace.resultPack && probeSetSnapshot
    ? buildGeoResearchDownstreamCandidates({
        snapshot: probeSetSnapshot,
        resultPack: runWorkspace.resultPack,
        findings: runWorkspace.findings,
        sourceArtifactId: runWorkspace.resultPackArtifactId,
        faqBoardByQuestion,
        contentClusterPlan: blueprintSummary.contentClusterPlan,
        retestBaselineQuestions: Array.isArray(retestBaseline.questions)
          ? retestBaseline.questions.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          : []
      })
    : undefined;
  // 提及率 KPI：普通 run 暴露基线；post_publish_retest run 额外暴露差值归因
  const mentionBaseline = runWorkspace.run.mentionBaseline;
  let mentionDelta: ReturnType<typeof buildMentionDeltaAttribution> | undefined;
  let previousBaselineRun: { runId: string; runVersion: number; capturedAt: string } | undefined;
  if (runWorkspace.run.triggerType === "post_publish_retest" && mentionBaseline) {
    const retestBinding = runWorkspace.run.plan.retestBinding && typeof runWorkspace.run.plan.retestBinding === "object"
      && !Array.isArray(runWorkspace.run.plan.retestBinding)
      ? runWorkspace.run.plan.retestBinding as Partial<GeoResearchRetestBinding>
      : undefined;
    const previous = typeof retestBinding?.baselineRunId === "string"
      ? await readGeoMentionBaselineByRunId({ productId: input.productId, runId: retestBinding.baselineRunId })
      : await readPreviousGeoMentionBaseline({
          productId: input.productId,
          beforeRunVersion: runWorkspace.run.runVersion
        });
    if (previous) {
      previousBaselineRun = {
        runId: previous.runId,
        runVersion: previous.runVersion,
        capturedAt: previous.baseline.capturedAt
      };
      mentionDelta = buildMentionDeltaAttribution(mentionBaseline, previous.baseline);
    }
  }
  const mentionKpi = mentionBaseline || mentionDelta
    ? {
        triggerType: runWorkspace.run.triggerType,
        mentionBaseline,
        mentionDelta,
        previousBaselineRun
      }
    : undefined;
  return {
    product,
    runWorkspace: {
      ...runWorkspace,
      questionCatalog: buildGeoResearchQuestionCatalog({
        product,
        ...runWorkspace,
        latestSourceSnapshotHash: latestSourceSnapshot?.snapshotHash
      }),
      downstreamCandidates
    },
    mentionKpi
  };
}

export async function importGeoResearchQuestionCatalog(input: {
  productId: string;
  runId: string;
  findingIds: string[];
  expectedQuestionPoolVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.runId, "runId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  assertStringList(input.findingIds, "findingIds", 100);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError("human_approval_required", "真实用户问题目录必须经人工确认后才能进入问题池。", 403);
  }
  if (!input.findingIds.length) {
    throw new V5GovernanceServiceError("invalid_contract", "至少选择一个真实用户问题。", 400);
  }
  if (!Number.isInteger(input.expectedQuestionPoolVersion) || input.expectedQuestionPoolVersion < 0) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedQuestionPoolVersion 必须是非负整数。", 400);
  }
  const product = await getActiveProduct(input.productId);
  const [runWorkspace, latestSourceSnapshot] = await Promise.all([
    readGeoResearchRunWorkspace({ productId: input.productId, runId: input.runId }),
    readLatestGeoSourceSnapshot(input.productId)
  ]);
  if (!runWorkspace) throw new V5GovernanceServiceError("research_run_not_found", "GEO 调研运行不存在。", 404);
  const catalog = buildGeoResearchQuestionCatalog({
    product,
    ...runWorkspace,
    latestSourceSnapshotHash: latestSourceSnapshot?.snapshotHash
  });
  if (!catalog.liveSearchVerified) {
    throw new V5GovernanceServiceError(
      "live_search_gate_failed",
      "本次问题目录没有通过联网搜索门禁，禁止写入正式问题池。",
      409,
      "等待联网问题发现任务完成，并确认每条问题都有公开来源。"
    );
  }
  if (catalog.staleReasons.length) {
    throw new V5GovernanceServiceError(
      "research_run_stale",
      `本次 GEO 调研结果已过期：${catalog.staleReasons.join("；")}。`,
      409,
      "返回 GEO 调研页，基于最新产品资料重新运行后再确认问题。"
    );
  }
  const selectedIds = new Set(input.findingIds);
  const selected = catalog.items.filter((item) => selectedIds.has(item.findingId));
  if (selected.length !== selectedIds.size) {
    throw new V5GovernanceServiceError("question_catalog_finding_mismatch", "选择的问题不属于当前产品目录。", 409, "刷新页面后重新选择。" );
  }
  if (selected.some((item) => item.reviewStatus === "rejected")) {
    throw new V5GovernanceServiceError("question_catalog_rejected_item", "已拒绝的问题不能收录到问题池。", 409, "刷新页面后重新选择。" );
  }
  const unverified = selected.filter((item) => item.sources.length === 0);
  if (unverified.length) {
    throw new V5GovernanceServiceError(
      "question_source_evidence_missing",
      "部分问题没有逐条对应的公开来源，不能进入问题池。",
      409,
      "仅选择带有可复核来源的问题。"
    );
  }
  const result = ingestV5QuestionSignals({
    idempotencyKey: `${input.idempotencyKey}:question-pool`,
    expectedVersion: input.expectedQuestionPoolVersion,
    actor: input.actor,
    signals: selected.map((item) => ({
      text: item.question,
      source: "geo_research" as const,
      sourceId: `${input.runId}:${item.findingId}`,
      sourceConfidence: item.confidence,
      product: product.displayName,
      entities: [...new Set([product.canonicalName, product.displayName, ...product.aliases].filter(Boolean))],
      relationship: `${catalog.catalogId}:${item.module}`,
      audience: item.audience,
      suggestedArticleTypes: item.suggestedArticleTypes.length ? item.suggestedArticleTypes : suggestedArticleTypesForQuestion(item.question),
      keywords: item.keywords,
      knowledgeReadiness: {},
      evidenceGap: true,
      geoMonitoringApproval: {
        source: "geo_research_human" as const,
        approvedBy: input.actor.actorId,
        researchRunId: input.runId,
        findingId: item.findingId
      }
    }))
  });
  const confirmation = await confirmGeoResearchQuestionFindingsRecord({
    productId: input.productId,
    runId: input.runId,
    findingIds: selected.map((item) => item.findingId),
    catalogId: catalog.catalogId,
    idempotencyKey: `${input.idempotencyKey}:research-findings`,
    actor: input.actor
  });
  return {
    catalogId: catalog.catalogId,
    importedCount: selected.length,
    questionIds: result.data.questionIds,
    questionPoolStateVersion: result.data.stateVersion,
    replayed: result.status === "replayed" && confirmation.replayed
  };
}

export async function createGeoResearchProjectForProduct(input: {
  productId: string;
  expressionFocus: string;
  forbiddenFocus?: string[];
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.expressionFocus, "expressionFocus", 4000);
  assertText(input.idempotencyKey, "idempotencyKey", 96);
  assertActor(input.actor);
  assertStringList(input.forbiddenFocus, "forbiddenFocus", 100);
  assertStringList(input.researchMarkets, "researchMarkets", 20);
  assertStringList(input.languages, "languages", 20);
  assertStringList(input.targetChannels, "targetChannels", 30);
  await getActiveProduct(input.productId);
  const write = await createGeoResearchProjectRecord({
    project: {
      productId: input.productId,
      expressionFocus: input.expressionFocus,
      forbiddenFocus: input.forbiddenFocus,
      researchMarkets: input.researchMarkets,
      languages: input.languages,
      targetChannels: input.targetChannels
    },
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目创建后读取失败。", 500);
  }
  return { ...write, workspace };
}

export async function updateGeoResearchProject(input: {
  productId: string;
  expectedProjectVersion: number;
  expressionFocus: string;
  forbiddenFocus?: string[];
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.expressionFocus, "expressionFocus", 4000);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  assertStringList(input.forbiddenFocus, "forbiddenFocus", 100);
  assertStringList(input.researchMarkets, "researchMarkets", 20);
  assertStringList(input.languages, "languages", 20);
  assertStringList(input.targetChannels, "targetChannels", 30);
  if (!Number.isInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedProjectVersion 必须是正整数。", 400);
  }
  await getActiveProduct(input.productId);
  const write = await updateGeoResearchProjectRecord({
    productId: input.productId,
    expectedVersion: input.expectedProjectVersion,
    expressionFocus: input.expressionFocus.trim(),
    forbiddenFocus: input.forbiddenFocus || [],
    researchMarkets: input.researchMarkets?.length ? input.researchMarkets : ["CN"],
    languages: input.languages?.length ? input.languages : ["zh-CN"],
    targetChannels: input.targetChannels?.length ? input.targetChannels : ["wechat", "official_website"],
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}

export async function startGeoResearchRun(input: {
  productId: string;
  triggerType?: GeoResearchRun["triggerType"];
  expectedProjectVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  const triggerType = input.triggerType || "product_onboarding";
  if (!["product_onboarding", "manual_refresh", "post_publish_retest"].includes(triggerType)) {
    throw new V5GovernanceServiceError("invalid_contract", `不支持的 GEO 调研触发类型：${String(triggerType)}。`, 400);
  }
  if (!Number.isInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      "expectedProjectVersion 必须是正整数。",
      400,
      "刷新产品调研页，读取最新版本后重试。"
    );
  }
  await getActiveProduct(input.productId);
  const currentWorkspace = await readGeoResearchWorkspace(input.productId);
  if (!currentWorkspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  }
  const channelRuleBlockedReason = targetChannelRuleBlockedReason(currentWorkspace.project.targetChannels);
  if (channelRuleBlockedReason) {
    throw new V5GovernanceServiceError(
      "geo_channel_rule_pack_not_ready",
      channelRuleBlockedReason,
      409,
      "激活覆盖全部目标第三方平台的渠道规则包，或从研究边界移除未治理渠道。"
    );
  }
  const websiteCoverageProfile = await readProductWebsiteCoverageProfile(input.productId);
  if (!websiteCoverageProfile || websiteCoverageProfile.publicGeoReadiness === "pending_audit") {
    throw new V5GovernanceServiceError(
      "website_coverage_baseline_pending",
      "产品正式官网尚未完成前置 GEO 基线审计，不能启动调研。",
      409,
      "在产品知识库添加正式官网 URL，并等待自动官网审计完成后重试。"
    );
  }
  const retestBinding = triggerType === "post_publish_retest"
    ? await resolveGeoRetestBinding(input.productId, currentWorkspace)
    : undefined;
  const write = await createGeoResearchRunRecord({
    productId: input.productId,
    triggerType,
    retestBinding,
    expectedProjectVersion: input.expectedProjectVersion,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  }
  return { ...write, workspace };
}

export async function approveGeoBlueprint(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.blueprintVersionId, "blueprintVersionId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError(
      "human_approval_required",
      "GEO 蓝图必须由人工批准，Agent 不能代替批准。",
      403
    );
  }
  const allowedRoles = new Set(["content_growth", "knowledge_manager", "workbench_operator", "developer_admin"]);
  if (!allowedRoles.has(input.actor.actorRole)) {
    throw new V5GovernanceServiceError(
      "forbidden",
      "当前角色无权批准 GEO 蓝图。",
      403,
      "切换到内容增长、知识管理、工作台运营或开发管理员角色。"
    );
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const write = await approveGeoBlueprintRecord(input);
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}

export async function runAutomaticGeoResearchOrchestration(input: { actor: V5GovernanceActor; productIds?: string[] }) {
  assertActor(input.actor);
  if (!["system", "scheduler"].includes(input.actor.actorType)) {
    throw new V5GovernanceServiceError("system_policy_actor_required", "自动 GEO 调研必须由系统策略执行器发起。", 403);
  }
  const { listProducts } = await import("./product-registry-service");
  const productFilter = new Set((input.productIds || []).map((item) => item.trim()).filter(Boolean));
  const products = (await listProducts()).filter((product) => !productFilter.size || productFilter.has(product.productId));
  const results: Array<{ productId: string; status: string; detail?: string }> = [];
  for (const product of products) {
    let state = await getGeoResearchWorkspace(product.productId);
    if (!state.workspace) {
      const projectRequest = {
        productId: product.productId,
        expressionFocus: `围绕 ${product.displayName} 的真实用户问题、适用场景、选型依据与可信产品事实建立 GEO 可见性。`,
        forbiddenFocus: ["不得编造产品能力、客户案例或未经资料支持的结论"],
        researchMarkets: ["CN"],
        languages: ["zh-CN"],
        targetChannels: ["wechat", "official_website", "ai_frontend"]
      };
      await createGeoResearchProjectForProduct({
        ...projectRequest,
        idempotencyKey: `auto-geo-project:${product.productId}:${hashV5GovernancePayload(projectRequest).slice(0, 16)}`,
        actor: input.actor
      });
      state = await getGeoResearchWorkspace(product.productId);
    }
    const blueprint = state.workspace?.currentBlueprint;
    const governanceBinding = await readActiveGeoResearchGovernanceBinding(product.productId);
    const runBinding = state.workspace?.latestRun?.plan.governanceBinding as {
      sourceSnapshotId?: string;
      rulePackageVersionId?: string;
      indexSnapshotId?: string;
    } | undefined;
    const bindingIsCurrent = Boolean(governanceBinding && runBinding
      && governanceBinding.sourceSnapshotId === runBinding.sourceSnapshotId
      && governanceBinding.rulePackageVersionId === runBinding.rulePackageVersionId
      && governanceBinding.indexSnapshotId === runBinding.indexSnapshotId);
    if (blueprint?.status === "pending_review" && bindingIsCurrent) {
      results.push({
        productId: product.productId,
        status: "research_synthesis_ready",
        detail: "GEO 调研综合稿已通过机器门禁，等待编译产品 GEO 策略包"
      });
      continue;
    }
    const openRun = state.workspace?.latestRun && !["completed", "failed", "cancelled"].includes(state.workspace.latestRun.status);
    const latestSnapshotHash = state.readiness.latestSourceSnapshot?.snapshotHash;
    if (openRun && (!bindingIsCurrent || (latestSnapshotHash
      && state.workspace!.latestRun!.inputSourceSnapshotHash !== latestSnapshotHash))) {
      await cancelStaleGeoResearchRunRecord({
        runId: state.workspace!.latestRun!.runId,
        productId: product.productId,
        replacementSourceSnapshotHash: governanceBinding?.sourceSnapshotHash || latestSnapshotHash || "governance_bundle_changed",
        replacementRulePackageVersionId: governanceBinding?.rulePackageVersionId,
        replacementIndexSnapshotId: governanceBinding?.indexSnapshotId,
        actor: input.actor
      });
      state = await getGeoResearchWorkspace(product.productId);
    } else if (openRun) {
      results.push({ productId: product.productId, status: "running" });
      continue;
    }
    if (!state.readiness.canCreateRun || !state.workspace) {
      results.push({ productId: product.productId, status: "waiting_for_sources", detail: "等待知识库形成正式来源快照" });
      continue;
    }
    const latestRun = state.workspace.latestRun;
    const recent = latestRun && Date.now() - Date.parse(latestRun.updatedAt) < 30 * 24 * 60 * 60 * 1000;
    const failedAgainstCurrentSnapshot = recent
      && latestRun.status === "failed"
      && latestRun.inputSourceSnapshotHash === state.readiness.latestSourceSnapshot?.snapshotHash;
    if (failedAgainstCurrentSnapshot) {
      results.push({
        productId: product.productId,
        status: "requires_attention",
        detail: "当前资料快照上的 GEO 调研已失败；等待人工检查或授权任务重试，不自动创建重复 run"
      });
      continue;
    }
    if (bindingIsCurrent && blueprint && ["pending_review", "approved"].includes(blueprint.status)) {
      // 已批准蓝图优先走“发布批次关闭 -> 复测 -> 根因判断”闭环，不能被固定 30 天刷新越过。
      if (blueprint.status === "approved" && latestRun) {
        const retestBaseline = blueprint.retestBaseline || {};
        const retestQuestions = Array.isArray(retestBaseline.questions)
          ? retestBaseline.questions.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          : [];
        const targetMentionRate = typeof retestBaseline.targetMentionRate === "number"
          && Number.isFinite(retestBaseline.targetMentionRate)
          ? retestBaseline.targetMentionRate
          : undefined;
        if (!retestQuestions.length || targetMentionRate === undefined) {
          results.push({
            productId: product.productId,
            status: "requires_attention",
            detail: "已批准蓝图缺少可执行的复测问题或目标提及率，不能进入自动复测"
          });
          continue;
        }
        const approvedAtMs = Date.parse(blueprint.approvedAt || latestRun.updatedAt);
        const configuredRetestDays = Number(process.env.GEO_RETEST_INTERVAL_DAYS || 7);
        const retestIntervalDays = Number.isFinite(configuredRetestDays) ? Math.max(1, configuredRetestDays) : 7;
        const retestIntervalMs = retestIntervalDays * 24 * 60 * 60 * 1000;
        const closedBatch = await readLatestClosedProductGeoOptimizationSnapshot({
          productId: product.productId,
          generatedAfter: blueprint.approvedAt,
          blueprintVersionId: blueprint.blueprintVersionId
        });
        if (!closedBatch) {
          results.push({
            productId: product.productId,
            status: "monitoring",
            detail: "等待蓝图批准后的内容完成发布、存活观察与 published_content_retest 批次闭环"
          });
          continue;
        }
        const latestRetestRun = state.workspace.runs.find((run) =>
          run.triggerType === "post_publish_retest"
          && run.status === "completed"
          && run.mentionBaseline
          && run.plan.retestBinding
          && typeof run.plan.retestBinding === "object"
          && !Array.isArray(run.plan.retestBinding)
          && (run.plan.retestBinding as Partial<GeoResearchRetestBinding>).blueprintVersionId === blueprint.blueprintVersionId
          && (run.plan.retestBinding as Partial<GeoResearchRetestBinding>).batchKey === closedBatch.batchKey);
        const retestClockStartedAt = Math.max(approvedAtMs, Date.parse(closedBatch.generatedAt));
        if (!latestRetestRun && retestQuestions.length && Date.now() - retestClockStartedAt >= retestIntervalMs) {
          await startGeoResearchRun({
            productId: product.productId,
            triggerType: "post_publish_retest",
            expectedProjectVersion: state.workspace.project.rowVersion,
            idempotencyKey: `auto-geo-retest:${product.productId}:${blueprint.blueprintVersionId}:${closedBatch.batchKey}`,
            actor: input.actor
          });
          results.push({
            productId: product.productId,
            status: "queued_retest",
            detail: `发布批次 ${closedBatch.batchKey} 已闭环并超过复测间隔，排队提及率复测`
          });
          continue;
        }
        if (latestRetestRun && targetMentionRate !== undefined) {
          const retestMentionRate = latestRetestRun.mentionBaseline?.targetMentionRate || 0;
          if (retestMentionRate < targetMentionRate) {
            const blockingAction = closedBatch.actions.find((item) => (
              item.priority === "P0"
              || ["fix_site", "collect_evidence", "continue_monitoring", "manual_review"].includes(item.action)
            ));
            if (blockingAction) {
              results.push({
                productId: product.productId,
                status: "requires_attention",
                detail: `复测未达标，但批次根因要求先执行「${blockingAction.title}」；不会用新一轮内容调研掩盖官网、证据或样本问题`
              });
              continue;
            }
            if (Date.now() - Date.parse(latestRetestRun.updatedAt) >= retestIntervalMs) {
              await startGeoResearchRun({
                productId: product.productId,
                triggerType: "manual_refresh",
                expectedProjectVersion: state.workspace.project.rowVersion,
                idempotencyKey: `auto-geo-refresh:${product.productId}:${latestRetestRun.runId}`,
                actor: input.actor
              });
              results.push({
                productId: product.productId,
                status: "queued",
                detail: `复测提及率 ${(retestMentionRate * 100).toFixed(1)}% 低于目标 ${(targetMentionRate * 100).toFixed(1)}%，触发新一轮调研`
              });
              continue;
            }
            results.push({
              productId: product.productId,
              status: "monitoring",
              detail: `复测提及率 ${(retestMentionRate * 100).toFixed(1)}% 未达标 ${(targetMentionRate * 100).toFixed(1)}%，等待复测间隔后触发下一轮`
            });
            continue;
          }
        }
      }
      results.push({ productId: product.productId, status: "monitoring", detail: "已批准蓝图处于发布与提及率监控闭环中" });
      continue;
    }
    await startGeoResearchRun({
      productId: product.productId,
      triggerType: latestRun ? "manual_refresh" : "product_onboarding",
      expectedProjectVersion: state.workspace.project.rowVersion,
      idempotencyKey: `auto-geo-run:${product.productId}:${hashV5GovernancePayload(governanceBinding || {}).slice(0, 32)}`,
      actor: input.actor
    });
    results.push({ productId: product.productId, status: "queued" });
  }
  return { products: results, queuedCount: results.filter((item) => item.status === "queued").length };
}

export async function requestGeoBlueprintChanges(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  reviewNote: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.blueprintVersionId, "blueprintVersionId", 64);
  assertText(input.reviewNote, "reviewNote", 2000);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError(
      "human_approval_required",
      "GEO 蓝图只能由人工退回修改。",
      403
    );
  }
  const allowedRoles = new Set(["content_growth", "knowledge_manager", "workbench_operator", "developer_admin"]);
  if (!allowedRoles.has(input.actor.actorRole)) {
    throw new V5GovernanceServiceError("forbidden", "当前角色无权评审 GEO 蓝图。", 403);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const write = await requestGeoBlueprintChangesRecord(input);
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}
