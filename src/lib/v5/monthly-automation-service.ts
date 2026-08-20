import { randomUUID } from "node:crypto";
import { channelLabels } from "@/lib/labels";
import { getWorkspaceSetting } from "@/lib/workbench-store";
import type { ChannelKey, DirectPublishPlatformKey } from "@/lib/types";
import type { RowDataPacket } from "mysql2/promise";
import {
  confirmQuestionTypeMatch,
  getArticleTypeVersionsByIds,
  runQuestionTypeMatch
} from "./article-type-service";
import {
  approveV5Strategy,
  preflightV5Strategy,
  saveV5MonthlyPlan,
  scheduleV5ProductionTask
} from "./monthly-service";
import { readV5MonthlyPlanRecord } from "./monthly-plan-repository";
import { getV5GovernancePool, parseV5Json } from "./knowledge-governance-repository";
import {
  deriveProductStrategyMonthlyTypeQuotas,
  type ProductGeoStrategyContentPlanV2
} from "./product-strategy-pack-contracts";
import { getMonthlyWorkspaceReadModel } from "./monthly-workspace-read-model";
import { resolvePublishAccountCandidate } from "./product-rollout-readiness-service";
import type {
  ContentQuotaRule,
  KnowledgeBaseOption,
  RulePackageOption,
  TargetQuestionOption
} from "./monthly-workspace-contracts";

export type MonthlyAutomationStatus = "completed" | "already_ready" | "attention";

export interface MonthlyAutomationResult {
  month: string;
  status: MonthlyAutomationStatus;
  stage: "strategy" | "schedule";
  message: string;
  issues: string[];
  generatedCount?: number;
  scheduledCount?: number;
}

function normalizeIdentity(value?: string) {
  return (value || "").trim().toLocaleLowerCase("zh-CN").replace(/[\s_-]+/g, "");
}

function selectPackage(question: TargetQuestionOption, packages: RulePackageOption[]) {
  const questionProduct = normalizeIdentity(question.productId);
  return packages.find((item) => questionProduct && [item.productId, item.productName].some((value) => normalizeIdentity(value) === questionProduct))
    || (packages.length === 1 ? packages[0] : undefined);
}

function selectKnowledgeBase(rulePackage: RulePackageOption, knowledgeBases: KnowledgeBaseOption[]) {
  const allowedIds = new Set(rulePackage.knowledgeBaseIds || []);
  return knowledgeBases.find((item) => item.status === "ready"
    && item.sourceSnapshotHash === rulePackage.sourceSnapshotHash
    && (allowedIds.size === 0 || allowedIds.has(item.knowledgeBaseId))
    && (!item.productId || normalizeIdentity(item.productId) === normalizeIdentity(rulePackage.productId)))
    || knowledgeBases.find((item) => item.status === "ready"
      && item.sourceSnapshotHash === rulePackage.sourceSnapshotHash
      && (allowedIds.size === 0 || allowedIds.has(item.knowledgeBaseId)));
}

async function approveExistingDraft(month: string) {
  let workspace = await getMonthlyWorkspaceReadModel(month);
  const strategy = workspace.plan?.strategyPackage;
  if (!workspace.plan || !strategy) return undefined;
  if (["approved", "partially_approved"].includes(strategy.status) || workspace.plan.status === "confirmed") {
    return {
      month,
      status: "already_ready" as const,
      stage: "strategy" as const,
      message: "本月策略已经通过系统门禁，人工仍可在右侧抽屉中修改并生成新版本。",
      issues: [],
      generatedCount: strategy.quotaRules.length
    };
  }
  if (!strategy.quotaRules.length) return undefined;
  const productStrategyPlan = await buildProductStrategyMonthlyQuotas({
    month,
    rulePackages: workspace.rulePackages.filter((item) => item.status === "active" && item.monthlyProductionReady),
    knowledgeBases: workspace.knowledgeBases.filter((item) => item.status === "ready"),
    targetQuestions: workspace.targetQuestions
  });
  const managedPlanProducts = new Set(strategy.quotaRules.map((rule) => rule.productId).filter((value): value is string => Boolean(value))
    .filter((productId) => productStrategyPlan.managedProductIdentities.has(normalizeIdentity(productId))));
  const blockedManagedProducts = [...managedPlanProducts].filter((productId) => !productStrategyPlan.eligibleProductIds.has(productId));
  if (blockedManagedProducts.length) {
    return {
      month,
      status: "attention" as const,
      stage: "strategy" as const,
      message: "已有月度草稿包含尚未通过产品级内容与账号门禁的产品，系统不会自动批准。",
      issues: blockedManagedProducts.map((productId) => `${productId} 尚未完成策略确认、样稿验收和目标平台账号确认。`)
    };
  }
  if (strategy.status !== "preview_ready") {
    await preflightV5Strategy(month, {
      expectedVersion: workspace.plan.version,
      auditReason: "系统策略预检：校验知识库、证据、规则包与内容类型快照",
      mutationSource: "system_policy"
    });
    workspace = await getMonthlyWorkspaceReadModel(month);
  }
  const plan = workspace.plan;
  if (!plan?.strategyPackage || plan.strategyPackage.status !== "preview_ready") return undefined;
  const approved = await approveV5Strategy(month, {
    expectedVersion: plan.version,
    auditReason: "系统策略门禁通过：按当前月度上下文生成内容矩阵",
    mutationSource: "system_policy"
  });
  return {
    month,
    status: "completed" as const,
    stage: "strategy" as const,
    message: "系统已完成策略预检并生成月度内容矩阵。",
    issues: [],
      generatedCount: approved.matrixTasks?.length || 0
  };
}

export async function runAutomaticMonthlyPlan(month: string): Promise<MonthlyAutomationResult> {
  const existing = await approveExistingDraft(month);
  if (existing) return existing;

  const workspace = await getMonthlyWorkspaceReadModel(month);
  const packages = workspace.rulePackages.filter((item) => item.status === "active" && item.monthlyProductionReady && item.allowedChannels.length > 0 && item.sourceSnapshotHash);
  const knowledgeBases = workspace.knowledgeBases.filter((item) => item.status === "ready" && item.sourceSnapshotHash);
  const productStrategyPlan = await buildProductStrategyMonthlyQuotas({
    month,
    rulePackages: packages,
    knowledgeBases,
    targetQuestions: workspace.targetQuestions
  });
  if (productStrategyPlan.quotaRules.length) {
    return persistAutomaticQuotaPlan(month, workspace, productStrategyPlan.quotaRules, productStrategyPlan.issues);
  }
  const questions = workspace.targetQuestions
    .filter((item) => item.status === "monthly_ready" && (!item.productId || !productStrategyPlan.managedProductIdentities.has(normalizeIdentity(item.productId))))
    .slice(0, 30);
  const issues: string[] = [...productStrategyPlan.issues];
  if (!questions.length) issues.push("问题池中暂无可用于本月计划的问题，请等待联网调研完成或人工补充问题。");
  if (!packages.length) issues.push("没有达到生产准入的产品规则包，请先完成产品绑定与规则包治理。");
  if (!knowledgeBases.length) issues.push("没有带正式来源快照的就绪知识库，请等待资料治理完成。");
  if (workspace.source.governanceData === "pending_config") issues.push("正式治理数据库尚未配置，系统不会用演示数据生成正式策略。");
  if (issues.length) {
    return { month, status: "attention", stage: "strategy", message: "自动策略正在等待必要上下文。", issues };
  }

  const matchRun = await runQuestionTypeMatch(month, {
    expectedVersion: workspace.typeMatchRun?.revision || 0,
    questionVersionIds: questions.map((item) => item.questionVersionId),
    auditReason: "系统根据知识库产品、GEO 调研结果和问题池匹配内容类型",
    runMode: "system_policy"
  }, `auto-type-match:${month}:${workspace.typeMatchRun?.revision || 0}`);
  if (matchRun.status !== "draft" || !matchRun.suggestions.length) {
    return {
      month,
      status: "attention",
      stage: "strategy",
      message: "内容类型自动匹配尚未产生可用结果。",
      issues: [matchRun.status === "pending_config" ? "请在设置中配置可用模型连接。" : "请检查内容类型配置和模型运行日志。"]
    };
  }

  const selectedByQuestion = new Map<string, (typeof matchRun.suggestions)[number]>();
  for (const suggestion of [...matchRun.suggestions].sort((left, right) => right.semanticScore - left.semanticScore)) {
    if (suggestion.missingInformation.length || suggestion.conflictProfileVersionIds.length) continue;
    if (!selectedByQuestion.has(suggestion.questionVersionId)) selectedByQuestion.set(suggestion.questionVersionId, suggestion);
  }
  if (!selectedByQuestion.size) {
    return { month, status: "attention", stage: "strategy", message: "自动匹配结果均存在证据缺口或规则冲突。", issues: ["请在 GEO 内容中心中人工修正内容类型。"] };
  }
  const selectedKeys = new Set(Array.from(selectedByQuestion.values()).map((item) => `${item.questionVersionId}:${item.articleTypeProfileVersionId}`));
  const confirmedRun = await confirmQuestionTypeMatch(month, {
    expectedVersion: matchRun.revision,
    matchRunId: matchRun.matchRunId,
    confirmationMode: "system_policy",
    auditReason: "系统策略仅采纳无证据缺口、无冲突的最高匹配内容类型",
    selections: matchRun.suggestions.map((item) => ({
      questionVersionId: item.questionVersionId,
      articleTypeProfileVersionId: item.articleTypeProfileVersionId,
      selectionStatus: selectedKeys.has(`${item.questionVersionId}:${item.articleTypeProfileVersionId}`) ? "accepted" as const : "rejected" as const
    }))
  }, `auto-type-confirm:${matchRun.matchRunId}`);
  const selected = Array.from(selectedByQuestion.values());
  const versions = await getArticleTypeVersionsByIds(selected.map((item) => item.articleTypeProfileVersionId));
  const versionById = new Map(versions.map((item) => [item.profileVersionId, item]));
  const questionById = new Map(questions.map((item) => [item.questionVersionId, item]));
  const skipped: string[] = [];
  const quotaRules = selected.flatMap<ContentQuotaRule>((suggestion) => {
    const question = questionById.get(suggestion.questionVersionId);
    const articleType = versionById.get(suggestion.articleTypeProfileVersionId);
    if (!question || !articleType) return [];
    const rulePackage = selectPackage(question, packages);
    if (!rulePackage) {
      skipped.push(`${question.question}：无法确定对应产品规则包。`);
      return [];
    }
    const knowledgeBase = selectKnowledgeBase(rulePackage, knowledgeBases);
    if (!knowledgeBase || !rulePackage.sourceSnapshotHash) {
      skipped.push(`${question.question}：规则包与知识库来源快照不一致。`);
      return [];
    }
    const channel = rulePackage.allowedChannels[0];
    return [{
      quotaRuleId: `quota-${month}-${randomUUID()}`,
      questionVersionId: question.questionVersionId,
      question: question.question,
      contentType: articleType.name,
      articleTypeProfileVersionId: articleType.profileVersionId,
      articleTypeNameSnapshot: articleType.name,
      typeMatchRunId: confirmedRun.matchRunId,
      typeSelectionSource: suggestion.selectionSource,
      matchReasonSnapshot: suggestion.reason,
      articleTypePromptConstraintSnapshot: articleType.promptConstraintSnapshot,
      articleTypePromptConstraintSnapshotHash: articleType.promptConstraintSnapshotHash,
      sameQuotaForAllChannels: false,
      perChannelQuota: 1,
      channelQuotas: { [channel]: 1 },
      expandedDeliverableCount: 1,
      rulePackageVersionId: rulePackage.id,
      knowledgeBaseIds: [knowledgeBase.knowledgeBaseId],
      sourceSnapshotHash: rulePackage.sourceSnapshotHash,
      rulePackageSourceSnapshotHash: rulePackage.sourceSnapshotHash,
      knowledgeIndexSourceSnapshotHash: rulePackage.sourceSnapshotHash,
      evidencePackSourceSnapshotHash: rulePackage.sourceSnapshotHash
    }];
  });
  if (!quotaRules.length) {
    return { month, status: "attention", stage: "strategy", message: "系统未找到快照一致的可生产组合。", issues: skipped };
  }

  const saved = await saveV5MonthlyPlan(month, {
    expectedVersion: workspace.plan?.version || 0,
    mutationSource: "system_policy",
    config: {
      month,
      businessGoal: "围绕真实用户问题提升目标产品的 AI 可见性与可信引用覆盖",
      targetDeliverableCount: quotaRules.length,
      questionVersionIds: quotaRules.map((item) => item.questionVersionId),
      quotaRules,
      groups: []
    }
  }, `auto-monthly-plan:${month}:${workspace.plan?.version || 0}`);
  await preflightV5Strategy(month, {
    expectedVersion: saved.version,
    auditReason: "系统策略预检：校验知识库、证据、规则包与内容类型快照",
    mutationSource: "system_policy"
  });
  const preview = await getMonthlyWorkspaceReadModel(month);
  const approved = await approveV5Strategy(month, {
    expectedVersion: preview.plan!.version,
    auditReason: "系统策略门禁通过：生成本月内容矩阵",
    mutationSource: "system_policy"
  });
  return {
    month,
    status: "completed",
    stage: "strategy",
    message: "系统已生成策略包和内容矩阵；可在右侧抽屉中人工修改并生成新版本。",
    issues: skipped,
    generatedCount: approved.matrixTasks?.length || 0
  };
}

function resolveChannelKey(channel: string): ChannelKey | undefined {
  return (Object.keys(channelLabels) as ChannelKey[]).find((key) => key === channel || channelLabels[key] === channel);
}

interface PublishPolicy {
  dailyLimit: number;
  publishWindows: string[];
  minIntervalMinutes: number;
}

const publishPlatformByChannel: Record<ChannelKey, DirectPublishPlatformKey> = {
  wechat: "wechat",
  csdn: "csdn",
  juejin: "juejin",
  zhihu_toutiao_general: "zhihu"
};

async function buildProductStrategyMonthlyQuotas(input: {
  month: string;
  rulePackages: RulePackageOption[];
  knowledgeBases: KnowledgeBaseOption[];
  targetQuestions: TargetQuestionOption[];
}) {
  const [managedRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT DISTINCT p.id AS product_id, p.canonical_name, p.display_name, p.aliases
     FROM product_entity p
     JOIN product_strategy_packs sp ON sp.product_id = p.id
     WHERE sp.status IN ('pending_strategy_review', 'strategy_approved', 'pending_sample_review', 'production_ready', 'active')`
  );
  const managedProductIds = new Set(managedRows.map((row) => String(row.product_id)));
  const managedProductIdentities = new Set(managedRows.flatMap((row) => [
    String(row.product_id),
    String(row.canonical_name || ""),
    String(row.display_name || ""),
    ...parseV5Json<string[]>(row.aliases, [])
  ].map(normalizeIdentity).filter(Boolean)));
  const [typeRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT p.id AS product_id, p.canonical_name, p.display_name, p.aliases, sp.id AS strategy_pack_id, sp.content_plan_json,
            atv.portfolio_item_id, atv.article_type_version_id, atv.name, atv.definition_json, atv.definition_hash
     FROM product_entity p
     JOIN product_strategy_packs sp ON sp.id = p.strategy_pack_id AND sp.status = 'production_ready'
     JOIN expression_calibration_version ec ON ec.product_strategy_pack_id = sp.id AND ec.status = 'active'
     JOIN product_strategy_article_type_versions atv ON atv.strategy_pack_id = sp.id
       AND atv.status IN ('active', 'frozen')
       AND JSON_UNQUOTE(JSON_EXTRACT(atv.definition_json, '$.evidenceReadiness')) = 'ready'
     WHERE p.status = 'active'
     ORDER BY p.id, atv.portfolio_item_id`
  );
  const [bindingRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT product_id, channel, account_label FROM product_publish_account_binding WHERE status = 'confirmed'`
  );
  const configuredAccounts = getWorkspaceSetting().publishAccountByChannel || {};
  const boundChannelsByProduct = new Map<string, Set<string>>();
  for (const row of bindingRows) {
    const productId = String(row.product_id);
    const channel = String(row.channel) as ChannelKey;
    const configuredAccount = configuredAccounts[channel]?.trim()
      || resolvePublishAccountCandidate(publishPlatformByChannel[channel]);
    if (!configuredAccount || configuredAccount !== String(row.account_label)) continue;
    const channels = boundChannelsByProduct.get(productId) || new Set<string>();
    channels.add(channel);
    boundChannelsByProduct.set(productId, channels);
  }
  const rowsByPack = new Map<string, RowDataPacket[]>();
  for (const row of typeRows) {
    const packId = String(row.strategy_pack_id);
    const values = rowsByPack.get(packId) || [];
    values.push(row);
    rowsByPack.set(packId, values);
  }
  const quotaRules: ContentQuotaRule[] = [];
  const issues: string[] = [];
  const eligibleProductIds = new Set<string>();
  for (const [packId, rows] of rowsByPack) {
    const productId = String(rows[0].product_id);
    const productName = String(rows[0].display_name);
    const plan = parseV5Json<ProductGeoStrategyContentPlanV2 | null>(rows[0].content_plan_json, null);
    const productIdentities = new Set([
      productId,
      String(rows[0].canonical_name || ""),
      productName,
      ...parseV5Json<string[]>(rows[0].aliases, [])
    ].map(normalizeIdentity).filter(Boolean));
    const productQuestions = input.targetQuestions.filter((question) => question.status === "monthly_ready" && productIdentities.has(normalizeIdentity(question.productId)));
    const rulePackage = input.rulePackages.find((item) => item.productId === productId);
    const knowledgeBase = rulePackage ? selectKnowledgeBase(rulePackage, input.knowledgeBases) : undefined;
    const boundChannels = boundChannelsByProduct.get(productId) || new Set<string>();
    const channel = rulePackage?.allowedChannels.find((item) => boundChannels.has(item));
    if (!plan || !productQuestions.length || !rulePackage || !knowledgeBase || !channel || !rulePackage.sourceSnapshotHash) {
      const missing = [
        ...(!plan ? ["策略内容不可读"] : []),
        ...(!productQuestions.length ? ["没有 monthly_ready 问题"] : []),
        ...(!rulePackage ? ["没有生产就绪规则包"] : []),
        ...(!knowledgeBase ? ["没有同快照知识库"] : []),
        ...(!channel ? ["没有由用户确认的目标平台账号"] : [])
      ];
      issues.push(`${productName} 尚不能进入月度批量生产：${missing.join("、")}。`);
      continue;
    }
    const rowByPortfolioId = new Map(rows.map((row) => [String(row.portfolio_item_id), row]));
    const allocations = deriveProductStrategyMonthlyTypeQuotas(plan, Math.min(30, productQuestions.length));
    const clusterQuestions = new Map(plan.geoOpportunities.map((cluster) => [cluster.opportunityId, new Set(cluster.representativeQuestions.map((question) => normalizeIdentity(question)))]));
    const usedQuestionIds = new Set<string>();
    for (const allocation of allocations) {
      const article = plan.articleTypePortfolio.find((item) => item.portfolioItemId === allocation.portfolioItemId);
      const typeRow = rowByPortfolioId.get(allocation.portfolioItemId);
      if (!article || !typeRow) continue;
      const preferredQuestions = productQuestions.filter((question) => allocation.questionClusterIds.some((clusterId) => clusterQuestions.get(clusterId)?.has(normalizeIdentity(question.question))));
      const candidates = [...preferredQuestions, ...productQuestions.filter((question) => !preferredQuestions.includes(question))]
        .filter((question) => !usedQuestionIds.has(question.questionVersionId));
      for (const question of candidates.slice(0, allocation.count)) {
        usedQuestionIds.add(question.questionVersionId);
        const promptSnapshot = typeof typeRow.definition_json === "string" ? typeRow.definition_json : JSON.stringify(typeRow.definition_json);
        quotaRules.push({
          quotaRuleId: `quota-${input.month}-${packId}-${question.questionVersionId}-${allocation.portfolioItemId}`.slice(0, 190),
          productId,
          productNameSnapshot: productName,
          questionVersionId: question.questionVersionId,
          question: question.question,
          contentType: article.name,
          articleTypeProfileVersionId: allocation.articleTypeVersionId,
          articleTypeNameSnapshot: article.name,
          typeMatchRunId: `product-strategy:${packId}`,
          typeSelectionSource: "user_selected",
          matchReasonSnapshot: article.recommendationReason,
          articleTypePromptConstraintSnapshot: promptSnapshot,
          articleTypePromptConstraintSnapshotHash: String(typeRow.definition_hash),
          sameQuotaForAllChannels: false,
          perChannelQuota: 1,
          channelQuotas: { [channel]: 1 },
          expandedDeliverableCount: 1,
          rulePackageVersionId: rulePackage.id,
          knowledgeBaseIds: [knowledgeBase.knowledgeBaseId],
          sourceSnapshotHash: rulePackage.sourceSnapshotHash,
          rulePackageSourceSnapshotHash: rulePackage.sourceSnapshotHash,
          knowledgeIndexSourceSnapshotHash: rulePackage.sourceSnapshotHash,
          evidencePackSourceSnapshotHash: rulePackage.sourceSnapshotHash
        });
      }
    }
    if (quotaRules.some((rule) => rule.productId === productId)) eligibleProductIds.add(productId);
  }
  for (const productId of managedProductIds) {
    if (!eligibleProductIds.has(productId) && input.targetQuestions.some((question) => normalizeIdentity(question.productId) === normalizeIdentity(productId))) {
      issues.push(`${productId} 正在等待产品策略确认、样稿验收或目标平台账号确认，不会回退到通用文章类型流程。`);
    }
  }
  return { quotaRules, issues, managedProductIds, managedProductIdentities, eligibleProductIds };
}

async function persistAutomaticQuotaPlan(
  month: string,
  workspace: Awaited<ReturnType<typeof getMonthlyWorkspaceReadModel>>,
  quotaRules: ContentQuotaRule[],
  issues: string[]
): Promise<MonthlyAutomationResult> {
  const saved = await saveV5MonthlyPlan(month, {
    expectedVersion: workspace.plan?.version || 0,
    mutationSource: "system_policy",
    config: {
      month,
      businessGoal: "围绕已确认产品 GEO 策略中的真实用户问题，自动生成可追溯、可发布的月度内容",
      targetDeliverableCount: quotaRules.length,
      questionVersionIds: quotaRules.map((item) => item.questionVersionId),
      quotaRules,
      groups: []
    }
  }, `auto-product-strategy-plan:${month}:${workspace.plan?.version || 0}`);
  await preflightV5Strategy(month, {
    expectedVersion: saved.version,
    auditReason: "系统预检用户已确认的产品 GEO 策略、文章类型、知识快照和发布账号绑定",
    mutationSource: "system_policy"
  });
  const preview = await getMonthlyWorkspaceReadModel(month);
  const approved = await approveV5Strategy(month, {
    expectedVersion: preview.plan!.version,
    auditReason: "产品策略与样稿门禁通过后，系统生成月度内容矩阵",
    mutationSource: "system_policy"
  });
  return {
    month,
    status: issues.length ? "attention" : "completed",
    stage: "strategy",
    message: "系统已按用户确认的产品 GEO 策略生成月度内容矩阵。",
    issues,
    generatedCount: approved.matrixTasks?.length || 0
  };
}

function normalizedPublishPolicy(value?: Partial<PublishPolicy>): PublishPolicy {
  const publishWindows = (value?.publishWindows || ["10:00", "15:00"])
    .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item))
    .sort();
  return {
    dailyLimit: Math.max(1, Math.min(50, Number(value?.dailyLimit) || 2)),
    publishWindows: publishWindows.length ? publishWindows : ["10:00", "15:00"],
    minIntervalMinutes: Math.max(15, Math.min(1440, Number(value?.minIntervalMinutes) || 180))
  };
}

function nextAvailableSlot(month: string, occupied: string[], policy: PublishPolicy) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDay = currentMonth === month ? Math.min(days, now.getDate() + 1) : 1;
  const occupiedTimes = occupied.map((item) => Date.parse(item)).filter(Number.isFinite);
  for (let day = startDay; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const daily = occupied.filter((item) => item.slice(0, 10) === date);
    if (daily.length >= policy.dailyLimit) continue;
    for (const window of policy.publishWindows) {
      const candidate = `${date}T${window}:00+08:00`;
      const candidateTime = Date.parse(candidate);
      const intervalOk = occupiedTimes.every((time) => Math.abs(candidateTime - time) >= policy.minIntervalMinutes * 60_000);
      if (intervalOk) return candidate;
    }
  }
  return undefined;
}

export async function runAutomaticSchedule(month: string): Promise<MonthlyAutomationResult> {
  const workspace = await getMonthlyWorkspaceReadModel(month);
  const available = workspace.productionTasks.filter((item) => item.status === "available" && !item.scheduledAt);
  if (!available.length) {
    return { month, status: "already_ready", stage: "schedule", message: "当前没有等待排程的可用正文。", issues: [], scheduledCount: 0 };
  }
  const setting = getWorkspaceSetting();
  const accounts = setting.publishAccountByChannel || {};
  const policies = setting.publishPolicyByChannel || {};
  const [hostedRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT product_id, daily_caps_json FROM hosted_promotion_order
     WHERE status = 'running'`
  );
  const hostedDailyCaps = new Map<string, number>();
  for (const row of hostedRows) {
    const caps = parseV5Json<Record<string, number>>(row.daily_caps_json, {});
    for (const [channel, cap] of Object.entries(caps)) {
      if (Number.isInteger(cap) && cap > 0) hostedDailyCaps.set(`${String(row.product_id)}:${channel}`, cap);
    }
  }
  const occupiedByAccount = new Map<string, string[]>();
  for (const task of workspace.productionTasks) {
    if (!task.scheduledAt) continue;
    const key = `${task.channel}:${task.platformAccount || "default"}`;
    const values = occupiedByAccount.get(key) || [];
    values.push(task.scheduledAt);
    occupiedByAccount.set(key, values);
  }
  const issues: string[] = [];
  let scheduledCount = 0;
  for (const task of available) {
    const channelKey = resolveChannelKey(task.channel);
    const platformAccount = channelKey ? accounts[channelKey]?.trim() : undefined;
    if (!platformAccount) {
      issues.push(`${task.title}：${task.channel} 未配置默认发布账号。`);
      continue;
    }
    const policy = normalizedPublishPolicy(channelKey ? policies[channelKey] : undefined);
    const hostedChannel = channelKey === "zhihu_toutiao_general" ? "zhihu" : channelKey;
    const hostedCap = task.productId && hostedChannel ? hostedDailyCaps.get(`${task.productId}:${hostedChannel}`) : undefined;
    if (hostedCap) policy.dailyLimit = Math.min(policy.dailyLimit, hostedCap);
    const occupancyKey = `${task.channel}:${platformAccount}`;
    const occupied = occupiedByAccount.get(occupancyKey) || [];
    const scheduledAt = nextAvailableSlot(month, occupied, policy);
    if (!scheduledAt) {
      issues.push(`${task.title}：${task.channel} 在本月剩余时间内已无符合日上限、时间窗和最小间隔的档位，将保留为待迁移任务。`);
      continue;
    }
    const formalPlan = await readV5MonthlyPlanRecord(month);
    const localWorkspace = formalPlan ? undefined : await getMonthlyWorkspaceReadModel(month);
    const expectedVersion = formalPlan?.version || localWorkspace?.plan?.version;
    if (!expectedVersion) {
      issues.push(`${task.title}：无法读取当前月度计划版本。`);
      continue;
    }
    await scheduleV5ProductionTask(month, task.taskId, {
      expectedVersion,
      scheduledAt,
      platformAccount,
      auditReason: "系统根据月度工作区、渠道账号和可用正文自动生成发布排程",
      mutationSource: "system_policy"
    });
    occupied.push(scheduledAt);
    occupiedByAccount.set(occupancyKey, occupied);
    scheduledCount += 1;
  }
  return {
    month,
    status: issues.length ? "attention" : "completed",
    stage: "schedule",
    message: scheduledCount ? `已自动排程 ${scheduledCount} 篇可用正文。` : "自动排程正在等待渠道账号配置。",
    issues,
    scheduledCount
  };
}
