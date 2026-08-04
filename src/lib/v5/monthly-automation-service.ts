import { randomUUID } from "node:crypto";
import { channelLabels } from "@/lib/labels";
import { getWorkspaceSetting } from "@/lib/workbench-store";
import type { ChannelKey } from "@/lib/types";
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
import { getMonthlyWorkspaceReadModel } from "./monthly-workspace-read-model";
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
  const questions = workspace.targetQuestions.filter((item) => item.status === "monthly_ready").slice(0, 30);
  const issues: string[] = [];
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

function scheduledAtFor(month: string, index: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDay = currentMonth === month ? Math.min(days, now.getDate() + 1) : 1;
  const availableDays = Math.max(1, days - startDay + 1);
  const day = startDay + (Math.floor(index / 2) % availableDays);
  const hour = index % 2 === 0 ? "10:00:00" : "15:00:00";
  return `${month}-${String(day).padStart(2, "0")}T${hour}+08:00`;
}

export async function runAutomaticSchedule(month: string): Promise<MonthlyAutomationResult> {
  const workspace = await getMonthlyWorkspaceReadModel(month);
  const available = workspace.productionTasks.filter((item) => item.status === "available" && !item.scheduledAt);
  if (!available.length) {
    return { month, status: "already_ready", stage: "schedule", message: "当前没有等待排程的可用正文。", issues: [], scheduledCount: 0 };
  }
  const accounts = getWorkspaceSetting().publishAccountByChannel || {};
  const issues: string[] = [];
  let scheduledCount = 0;
  for (const task of available) {
    const channelKey = resolveChannelKey(task.channel);
    const platformAccount = channelKey ? accounts[channelKey]?.trim() : undefined;
    if (!platformAccount) {
      issues.push(`${task.title}：${task.channel} 未配置默认发布账号。`);
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
      scheduledAt: scheduledAtFor(month, scheduledCount),
      platformAccount,
      auditReason: "系统根据月度工作区、渠道账号和可用正文自动生成发布排程",
      mutationSource: "system_policy"
    });
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
