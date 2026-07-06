"use client";

import { CarryOutOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Drawer, Input, List, Popconfirm, Space, Table, Tabs, Tag, message } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { GovernanceEntry } from "@/components/GovernanceEntry";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { channelLabels } from "@/lib/labels";
import { canManageWeeklyReportSuggestions, canViewAiGovernance } from "@/lib/permissions";
import type { PromptTemplate } from "@/lib/prompt-templates";
import type { BlogArticle, DistilledTerm, GeoTestResult, PublishRecord, WeeklyPlanQualityFeedback, WeeklyPlanQualitySignal } from "@/lib/types";

interface WeeklyReport {
  week: string;
  targetTotalCount?: number;
  executiveSummary: string;
  publishRecords: PublishRecord[];
  blogDiagnostics: BlogArticle[];
  geoResults: GeoTestResult[];
  distilledTerms?: DistilledTerm[];
  distilledTermMatrix?: DistilledTermMatrixRow[];
  promptTemplates?: PromptTemplate[];
  nextWeekSuggestions: string[];
  nextWeekSuggestionItems?: WeeklySuggestionItem[];
  recommendationOutcomes?: WeeklyRecommendationOutcome[];
  planQualityFeedback?: WeeklyPlanQualityFeedback;
  dataSource: string;
}

interface WeeklySuggestionItem {
  id: string;
  suggestion: string;
  decisionStatus?: "adopted" | "partially_adopted" | "rejected";
  decisionReason?: string;
  decidedAt?: string;
}

interface DistilledTermMatrixRow {
  id: string;
  term: string;
  contentCoverage: number;
  typeCompleteness: string;
  geoLift: number;
  competitorOccupied: boolean;
  nextSuggestion: string;
}

interface WeeklyRecommendationOutcome {
  id: string;
  week: string;
  suggestion: string;
  decisionStatus: "adopted" | "partially_adopted" | "rejected";
  evaluationStatus: "measured" | "waiting_next_week" | "not_applicable";
  completionRateDelta?: number;
  dataReturnRateDelta?: number;
  channelPerformanceDelta?: number;
  geoHitDelta?: number;
  officialCitationDelta?: number;
  failureReason?: string;
  modelLearningSignal: string;
  evaluatedAt: string;
}

type ReportView = "content_growth" | "workbench_ops";
type DetailDrawerKey = "publish" | "blog" | "geo" | "distilled" | "suggestion_failures" | "ops_modules" | "plan_quality" | undefined;
type ReportActionStep = "publish_records" | "fill_url" | "record_metrics" | "blog_candidates" | "geo_config" | "geo_candidates" | "create_next_plan" | "ready";
type WeeklySuggestionStep = "generate_report" | "review_suggestion" | "create_next_plan";
type OpsModuleStatus = "normal" | "attention" | "blocked" | "idle";

interface ReportActionItem {
  key: ReportActionStep;
  issue: string;
  count: number;
  actionText: string;
  nextStep: string;
  entryHref: string;
  entryLabel: string;
}

interface WeeklySuggestionAction {
  key: string;
  id?: string;
  suggestion: string;
  nextStep: WeeklySuggestionStep;
  actionText: string;
  decisionStatus?: WeeklySuggestionItem["decisionStatus"];
  decisionReason?: string;
  entry: { type: "button"; label: string } | { type: "link"; href: string; label: string };
}

interface SuggestionFailureRow {
  key: string;
  reason: string;
  count: number;
  suggestions: string[];
  decisionReasons: string[];
  nextStep: string;
}

interface OpsModuleRow {
  key: string;
  module: string;
  status: OpsModuleStatus;
  count: number;
  issue: string;
  nextStep: string;
  entry?: { type: "link"; href: string; label: string } | { type: "drawer"; drawerKey: Exclude<DetailDrawerKey, undefined>; label: string };
}

interface ReportKpiCardProps {
  title: string;
  value: string | number;
  suffix?: string;
  trend: number;
  positiveGood?: boolean;
}

const publishStatusLabels: Record<PublishRecord["publishStatus"], string> = {
  queued: "待发布",
  published: "已发布",
  url_filled: "已回填",
  failed: "失败"
};

const blogGeoResultLabels: Record<BlogArticle["geoResult"], string> = {
  hit: "命中",
  miss: "未命中",
  partial: "部分命中"
};

const geoExecutionStatusLabels: Record<NonNullable<GeoTestResult["executionStatus"]>, string> = {
  success: "成功",
  pending_config: "待配置",
  failed: "失败"
};

const citationLevelLabels: Record<string, string> = {
  official_site_direct: "官网被直接引用",
  official_content: "官网内容被引用",
  official_channel: "官方渠道被引用",
  non_official: "非官方来源",
  none: "未形成引用"
};

const reportActionStepLabels: Record<ReportActionStep, string> = {
  publish_records: "处理发布队列",
  fill_url: "回填 URL",
  record_metrics: "录入指标",
  blog_candidates: "处理博客候选",
  geo_config: "排查 GEO",
  geo_candidates: "沉淀候选",
  create_next_plan: "生成下周计划",
  ready: "可归档"
};

const reportActionStepColors: Record<ReportActionStep, string> = {
  publish_records: "red",
  fill_url: "gold",
  record_metrics: "blue",
  blog_candidates: "purple",
  geo_config: "red",
  geo_candidates: "purple",
  create_next_plan: "green",
  ready: "green"
};

const weeklySuggestionStepLabels: Record<WeeklySuggestionStep, string> = {
  generate_report: "先生成周报",
  review_suggestion: "复核建议",
  create_next_plan: "进入周计划生成预览"
};

const weeklySuggestionStepColors: Record<WeeklySuggestionStep, string> = {
  generate_report: "blue",
  review_suggestion: "gold",
  create_next_plan: "green"
};

const weeklySuggestionDecisionLabels: Record<NonNullable<WeeklySuggestionItem["decisionStatus"]>, string> = {
  adopted: "已采纳",
  partially_adopted: "部分采纳",
  rejected: "已拒绝"
};

const weeklySuggestionDecisionColors: Record<NonNullable<WeeklySuggestionItem["decisionStatus"]>, string> = {
  adopted: "green",
  partially_adopted: "gold",
  rejected: "red"
};

const opsModuleStatusLabels: Record<OpsModuleStatus, string> = {
  normal: "正常",
  attention: "待处理",
  blocked: "阻塞",
  idle: "本周未发生"
};

const opsModuleStatusColors: Record<OpsModuleStatus, string> = {
  normal: "green",
  attention: "gold",
  blocked: "red",
  idle: "default"
};

function getTrendClass(trend: number, positiveGood = true) {
  if (trend === 0) return "report-kpi-trend-flat";
  const isGood = positiveGood ? trend > 0 : trend < 0;
  return isGood ? "report-kpi-trend-good" : "report-kpi-trend-bad";
}

function formatTrend(trend: number, suffix?: string) {
  if (trend === 0) return "→ 0";
  return `${trend > 0 ? "↑" : "↓"} ${Math.abs(trend)}${suffix === "%" ? " pts" : ""}`;
}

function createPreviousValue(current: number, healthyThreshold: number) {
  if (current === 0) return 0;
  return current >= healthyThreshold ? Math.max(0, current - 6) : Math.min(100, current + 6);
}

function addReportDays(weekStart: string, days: number) {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDateInReportWeek(value: string | undefined, weekStart: string) {
  if (!value) return false;
  const date = value.slice(0, 10);
  const weekEnd = addReportDays(weekStart, 6);
  return date >= weekStart && date <= weekEnd;
}

function isSameReportWeek(value: string | undefined, weekStart: string) {
  return Boolean(value && value.slice(0, 10) === weekStart);
}

function filterPublishRecordsForReport(records: PublishRecord[], weekStart: string) {
  return records.filter((record) => {
    if (record.sourceWeek) return isSameReportWeek(record.sourceWeek, weekStart);
    if (isDateInReportWeek(record.plannedPublishDate, weekStart)) return true;
    return isDateInReportWeek(record.publishedAt, weekStart);
  });
}

function filterBlogDiagnosticsForReport(articles: BlogArticle[], weekStart: string) {
  return articles.filter((article) => isSameReportWeek(article.sourceWeek, weekStart) || (!article.sourceWeek && isDateInReportWeek(article.candidateAddedAt || article.lastCrawledAt, weekStart)));
}

function filterGeoResultsForReport(results: GeoTestResult[], weekStart: string) {
  return results.filter((result) => isSameReportWeek(result.sourceWeek, weekStart) || (!result.sourceWeek && isDateInReportWeek(result.testedAt, weekStart)));
}

function getGeoBusinessGap(result: GeoTestResult) {
  if (result.executionStatus === "pending_config" || result.executionStatus === "failed") return "测试未完成";
  if (!result.mentionedJoto) return "AI 未主动提到品牌";
  if (!result.mentionedWeike) return "产品表达不稳定";
  if (!result.citedOfficialUrl) return "官网信源未被引用";
  if (result.competitorAppeared) return "竞品出现占位";
  return "暂无明显缺口";
}

function getGeoBusinessNextStep(result: GeoTestResult) {
  if (result.suggestedAction) return result.suggestedAction;
  if (result.executionStatus === "pending_config" || result.executionStatus === "failed") return "先排查配置并重跑测试。";
  if (!result.mentionedJoto || !result.mentionedWeike) return "把该问题转入下周选题，补品牌和产品解释。";
  if (!result.citedOfficialUrl) return "补官网内容或知识库证据，让 AI 更容易引用官方信源。";
  if (result.competitorAppeared) return "补对比和差异化内容，减少竞品占位。";
  return "继续观察，不需要本周新增动作。";
}

function ReportKpiCard({ title, value, suffix, trend, positiveGood = true }: ReportKpiCardProps) {
  return (
    <Card size="small" className="report-kpi-card">
      <span className="report-kpi-title">{title}</span>
      <strong className="report-kpi-value">
        {value}
        {suffix ? <span>{suffix}</span> : null}
      </strong>
      <span className={`report-kpi-trend ${getTrendClass(trend, positiveGood)}`}>{formatTrend(trend, suffix)}</span>
    </Card>
  );
}

function createReportActionItems(
  reportPublishRecords: PublishRecord[],
  reportBlogDiagnostics: BlogArticle[],
  reportGeoResults: GeoTestResult[],
  hasActiveReport: boolean
): ReportActionItem[] {
  const queuedPublishCount = reportPublishRecords.filter((item) => item.publishStatus === "queued").length;
  const missingUrlCount = reportPublishRecords.filter((item) => item.publishStatus === "published" && !item.publishedUrl).length;
  const missingMetricsCount = reportPublishRecords.filter(
    (item) => (item.publishStatus === "published" || item.publishStatus === "url_filled") && !item.channelMetrics
  ).length;
  const blogCandidateCount = reportBlogDiagnostics.filter(
    (item) =>
      item.candidateStatus === "candidate" ||
      ((item.geoResult === "miss" || item.seoIssueCount > 0) && item.candidateStatus !== "planned" && item.candidateStatus !== "dismissed")
  ).length;
  const geoConfigCount = reportGeoResults.filter((item) => item.executionStatus === "pending_config" || item.executionStatus === "failed").length;
  const geoCandidateCount = reportGeoResults.filter(
    (item) => (item.executionStatus || "success") === "success" && (!item.mentionedJoto || !item.citedOfficialUrl)
  ).length;
  const actionItems: ReportActionItem[] = [];

  if (queuedPublishCount) {
    actionItems.push({
      key: "publish_records",
      issue: "还有内容停在发布队列",
      count: queuedPublishCount,
      actionText: "确认是否已经人工发布",
      nextStep: "标记发布状态，再回填 URL",
      entryHref: "/publish",
      entryLabel: "去发布队列"
    });
  }

  if (missingUrlCount) {
    actionItems.push({
      key: "fill_url",
      issue: "已发布内容缺少 URL",
      count: missingUrlCount,
      actionText: "补齐可追踪的发布链接",
      nextStep: "回填 URL 后再录入表现指标",
      entryHref: "/publish",
      entryLabel: "回填 URL"
    });
  }

  if (missingMetricsCount) {
    actionItems.push({
      key: "record_metrics",
      issue: "已发布内容缺少渠道指标",
      count: missingMetricsCount,
      actionText: "补阅读、赞藏评转数据",
      nextStep: "用真实表现判断下周渠道分配",
      entryHref: "/publish",
      entryLabel: "录入指标"
    });
  }

  if (blogCandidateCount) {
    actionItems.push({
      key: "blog_candidates",
      issue: "博客诊断存在可转化候选",
      count: blogCandidateCount,
      actionText: "确认候选是否进入计划",
      nextStep: "生成补强任务或标记已规划",
      entryHref: "/blog-candidates",
      entryLabel: "处理候选池"
    });
  }

  if (geoConfigCount) {
    actionItems.push({
      key: "geo_config",
      issue: "GEO 测试待配置或失败",
      count: geoConfigCount,
      actionText: "先排查模型配置与执行失败",
      nextStep: "诊断通过后重新运行 GEO 测试",
      entryHref: "/ai-config",
      entryLabel: "看 AI 配置"
    });
  }

  if (geoCandidateCount) {
    actionItems.push({
      key: "geo_candidates",
      issue: "GEO 命中或官网引用不足",
      count: geoCandidateCount,
      actionText: "把缺口沉淀为内容候选",
      nextStep: "加入博客候选池后进入周计划",
      entryHref: "/geo-test",
      entryLabel: "去 GEO 测试"
    });
  }

  if (!actionItems.length && hasActiveReport) {
    actionItems.push({
      key: "create_next_plan",
      issue: "本周复盘可进入下周计划",
      count: 1,
      actionText: "复核下周建议",
      nextStep: "生成下周计划草稿",
      entryHref: "/weekly-plan",
      entryLabel: "看周计划"
    });
  }

  if (!actionItems.length) {
    actionItems.push({
      key: "ready",
      issue: "先生成周报再归纳行动",
      count: 1,
      actionText: "读取当前发布、博客和 GEO 数据",
      nextStep: "点击生成周报",
      entryHref: "/weekly-report",
      entryLabel: "留在本页"
    });
  }

  return actionItems;
}

function createWeeklySuggestionActions(suggestions: WeeklySuggestionItem[] | undefined, fallbackSuggestionTexts: string[] | undefined, hasActiveReport: boolean): WeeklySuggestionAction[] {
  const fallbackSuggestions = [
    "先点击生成周报，读取当前运行态中的发布记录、博客诊断和 GEO 测试结果。",
    "真实日志和真实模型接入前，AI 访问量只作为流程演示，不作为正式策略判断。",
    "把 SEO 问题较多或 GEO 未命中的主题优先加入博客候选池。"
  ];
  const sourceSuggestions: WeeklySuggestionItem[] =
    suggestions?.length
      ? suggestions
      : (fallbackSuggestionTexts?.length ? fallbackSuggestionTexts : fallbackSuggestions).map((suggestion, index) => ({
          id: `fallback-suggestion-${index}`,
          suggestion
        }));

  return sourceSuggestions.map((item, index) => {
    if (!hasActiveReport) {
      return {
        key: `suggestion-${index}`,
        id: item.id,
        suggestion: item.suggestion,
        nextStep: "generate_report",
        actionText: "先生成周报，把当前发布、博客诊断和 GEO 结果固化成复盘依据。",
        decisionStatus: item.decisionStatus,
        decisionReason: item.decisionReason,
        entry: { type: "button", label: "生成周报" }
      };
    }

    return {
      key: `suggestion-${index}`,
      id: item.id,
      suggestion: item.suggestion,
      nextStep: index === 0 ? "create_next_plan" : "review_suggestion",
      actionText: index === 0 ? "把这条建议带到周计划页，先生成计划预览，再人工确认。" : "复核建议对应的发布、博客或 GEO 证据，再决定是否进入下周计划。",
      decisionStatus: item.decisionStatus,
      decisionReason: item.decisionReason,
      entry: { type: "link", href: "/weekly-plan", label: index === 0 ? "进入周计划生成预览" : "看周计划" }
    };
  });
}

function getActionCount(items: ReportActionItem[], keys: ReportActionStep[]) {
  return items.filter((item) => keys.includes(item.key)).reduce((sum, item) => sum + item.count, 0);
}

function getSuggestionFailureCategory(record: WeeklySuggestionAction) {
  const reason = (record.decisionReason || "").trim();

  if (!reason) return "待补原因";
  if (/数据|样本|回传|指标|证据/.test(reason)) return "数据不足";
  if (/产能|排期|人力|时间|篇数|发布量/.test(reason)) return "产能不足";
  if (/知识库|资料|素材|案例|Chunk/i.test(reason)) return "知识库不足";
  if (/产品|方向|策略|版本|业务/.test(reason)) return "产品方向变化";
  if (/渠道|公众号|小红书|视频号|官网|不适配/.test(reason)) return "渠道建议不适配";
  return "其他原因";
}

function getSuggestionFailureNextStep(reason: string) {
  if (reason === "数据不足") return "先补回传数据，再让 AI 判断下周加减量。";
  if (reason === "产能不足") return "下周计划优先按可执行产能收敛发布量。";
  if (reason === "知识库不足") return "补充资料或证据片段后再生成建议。";
  if (reason === "产品方向变化") return "更新产品表达规则包和本周目标。";
  if (reason === "渠道建议不适配") return "重新按渠道语气和内容形态拆分建议。";
  if (reason === "待补原因") return "补齐部分采纳或拒绝原因，便于后续复盘。";
  return "进入建议详情，人工判断是否需要回流规则。";
}

function createSuggestionFailureRows(actions: WeeklySuggestionAction[]) {
  const failureActions = actions.filter((item) => item.decisionStatus === "partially_adopted" || item.decisionStatus === "rejected");
  const rows = new Map<string, SuggestionFailureRow>();

  failureActions.forEach((item) => {
    const reason = getSuggestionFailureCategory(item);
    const current = rows.get(reason) || {
      key: reason,
      reason,
      count: 0,
      suggestions: [],
      decisionReasons: [],
      nextStep: getSuggestionFailureNextStep(reason)
    };

    current.count += 1;
    current.suggestions.push(item.suggestion);
    current.decisionReasons.push(item.decisionReason?.trim() || "未填写具体原因");
    rows.set(reason, current);
  });

  return [...rows.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}

function createOpsModuleRows(input: {
  hasActiveReport: boolean;
  reportActionItems: ReportActionItem[];
  reportPublishRecords: PublishRecord[];
  reportBlogDiagnostics: BlogArticle[];
  reportGeoResults: GeoTestResult[];
  reportDistilledTermMatrix: DistilledTermMatrixRow[];
  reportPromptTemplates: PromptTemplate[];
  planQualityFeedback?: WeeklyPlanQualityFeedback;
  publishedCount: number;
  dataReturnedCount: number;
}) {
  const queuedPublishCount = getActionCount(input.reportActionItems, ["publish_records"]);
  const missingDataCount = Math.max(0, input.publishedCount - input.dataReturnedCount);
  const blogCandidateCount = getActionCount(input.reportActionItems, ["blog_candidates"]);
  const geoConfigCount = getActionCount(input.reportActionItems, ["geo_config"]);
  const geoCandidateCount = getActionCount(input.reportActionItems, ["geo_candidates"]);
  const rows: OpsModuleRow[] = [];

  if (!input.hasActiveReport) {
    rows.push({
      key: "weekly_report_snapshot",
      module: "周报快照",
      status: "attention",
      count: 1,
      issue: "当前仍是运行态数据，周报建议尚未固化。",
      nextStep: "点击生成周报后再处理建议采纳和失败原因。",
      entry: { type: "link", href: "/weekly-report", label: "留在本页" }
    });
  }

  if (input.planQualityFeedback?.totalPlanItems) {
    const blockedSignalCount = input.planQualityFeedback.signals.filter((item) => item.status === "blocked").length;
    const attentionSignalCount = input.planQualityFeedback.signals.filter((item) => item.status === "attention").length;
    const feedbackCount =
      input.planQualityFeedback.rejectedCount +
      input.planQualityFeedback.riskAcceptedCount +
      input.planQualityFeedback.manualEditCount +
      input.planQualityFeedback.regeneratedTitleCount +
      input.planQualityFeedback.lowConfidencePlannedCount;

    rows.push({
      key: "plan_quality",
      module: "周计划质量反馈",
      status: blockedSignalCount ? "blocked" : attentionSignalCount ? "attention" : "normal",
      count: feedbackCount || input.planQualityFeedback.totalPlanItems,
      issue: feedbackCount ? "本周计划存在可回流到标题生成和规则包的反馈信号。" : "本周计划没有明显质量反馈信号。",
      nextStep: feedbackCount ? "查看驳回、风险接受、人工编辑和未达确认阈值原因。" : "继续观察计划确认质量。",
      entry: { type: "drawer", drawerKey: "plan_quality", label: "计划反馈" }
    });
  }

  rows.push({
    key: "publish_execution",
    module: "发布执行",
    status: queuedPublishCount ? "attention" : input.publishedCount ? "normal" : "idle",
    count: queuedPublishCount || input.publishedCount,
    issue: queuedPublishCount ? "还有内容停在发布队列。" : input.publishedCount ? "已形成可复盘的发布记录。" : "本周还没有发布记录。",
    nextStep: queuedPublishCount ? "先标记发布状态，再回填 URL。" : "继续观察发布完成率。",
    entry: { type: "drawer", drawerKey: "publish", label: "发布明细" }
  });

  rows.push({
    key: "data_return",
    module: "数据回传",
    status: input.publishedCount ? (missingDataCount ? "attention" : "normal") : "idle",
    count: missingDataCount || input.dataReturnedCount,
    issue: missingDataCount ? "部分已发布内容缺少渠道表现数据。" : input.publishedCount ? "已发布内容完成数据回传。" : "没有已发布内容可回传。",
    nextStep: missingDataCount ? "补录阅读、互动和转发数据。" : "用于下周渠道配比判断。",
    entry: { type: "drawer", drawerKey: "publish", label: "回传明细" }
  });

  if (input.reportBlogDiagnostics.length || blogCandidateCount) {
    rows.push({
      key: "blog_diagnosis",
      module: "官网博客诊断",
      status: blogCandidateCount ? "attention" : "normal",
      count: blogCandidateCount || input.reportBlogDiagnostics.length,
      issue: blogCandidateCount ? "存在可转入内容计划的博客候选。" : "博客诊断没有形成待处理候选。",
      nextStep: blogCandidateCount ? "处理候选池或标记已规划。" : "保持观察。",
      entry: { type: "drawer", drawerKey: "blog", label: "博客详情" }
    });
  }

  if (input.reportGeoResults.length) {
    rows.push({
      key: "geo_visibility",
      module: "GEO 可见度",
      status: geoConfigCount ? "blocked" : geoCandidateCount ? "attention" : "normal",
      count: geoConfigCount || geoCandidateCount || input.reportGeoResults.length,
      issue: geoConfigCount ? "存在 GEO 配置或执行失败。" : geoCandidateCount ? "品牌或官网引用仍有缺口。" : "本周 GEO 测试结果可归档。",
      nextStep: geoConfigCount ? "先排查 AI 配置，再重跑测试。" : geoCandidateCount ? "沉淀缺口问题进入周计划。" : "继续观察趋势。",
      entry: { type: "drawer", drawerKey: "geo", label: "GEO 详情" }
    });
  }

  if (input.reportDistilledTermMatrix.length || input.hasActiveReport) {
    rows.push({
      key: "distilled_matrix",
      module: "蒸馏词矩阵",
      status: input.reportDistilledTermMatrix.length ? "normal" : "idle",
      count: input.reportDistilledTermMatrix.length,
      issue: input.reportDistilledTermMatrix.length ? "已形成蒸馏词覆盖明细。" : "本周没有形成蒸馏词覆盖快照。",
      nextStep: input.reportDistilledTermMatrix.length ? "查看覆盖缺口并进入下周选题。" : "有新蒸馏词后再复盘。",
      entry: input.reportDistilledTermMatrix.length ? { type: "drawer", drawerKey: "distilled", label: "覆盖详情" } : undefined
    });
  }

  rows.push({
    key: "prompt_config",
    module: "模型规则配置",
    status: input.reportPromptTemplates.length ? "normal" : "blocked",
    count: input.reportPromptTemplates.length,
    issue: input.reportPromptTemplates.length ? "已记录可追溯的模型规则版本。" : "缺少可追溯的模型规则版本。",
    nextStep: input.reportPromptTemplates.length ? "必要时进入 AI 配置查看调用记录。" : "先补齐模型规则版本配置。",
    entry: { type: "link", href: "/ai-config", label: "AI 配置" }
  });

  return rows;
}

export default function WeeklyReportPage() {
  const {
    state: { blogArticles, botVisits, geoResults, publishRecords, weeklyPlan, workspaceSetting },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [generating, setGenerating] = useState(false);
  const [creatingNextPlan, setCreatingNextPlan] = useState(false);
  const [exportingMarkdown, setExportingMarkdown] = useState(false);
  const [report, setReport] = useState<WeeklyReport>();
  const [activeView, setActiveView] = useState<ReportView>("content_growth");
  const [detailDrawer, setDetailDrawer] = useState<DetailDrawerKey>();
  const [decidingSuggestionId, setDecidingSuggestionId] = useState<string>();
  const [suggestionDecisionReasons, setSuggestionDecisionReasons] = useState<Record<string, string>>({});

  const activeReport = report;
  const canViewOpsReport = canViewAiGovernance(workspaceSetting.currentRole);
  const canDecideWeeklySuggestions = canManageWeeklyReportSuggestions(workspaceSetting.currentRole);
  const showOpsView = canViewOpsReport && activeView === "workbench_ops";
  const fallbackReportPublishRecords = useMemo(() => filterPublishRecordsForReport(publishRecords, weeklyPlan.weekStart), [publishRecords, weeklyPlan.weekStart]);
  const fallbackReportBlogDiagnostics = useMemo(() => filterBlogDiagnosticsForReport(blogArticles, weeklyPlan.weekStart), [blogArticles, weeklyPlan.weekStart]);
  const fallbackReportGeoResults = useMemo(() => filterGeoResultsForReport(geoResults, weeklyPlan.weekStart), [geoResults, weeklyPlan.weekStart]);
  const reportPublishRecords = activeReport?.publishRecords || fallbackReportPublishRecords;
  const reportBlogDiagnostics = activeReport?.blogDiagnostics || fallbackReportBlogDiagnostics;
  const reportGeoResults = activeReport?.geoResults || fallbackReportGeoResults;
  const reportDistilledTermMatrix = activeReport?.distilledTermMatrix || [];
  const reportPromptTemplates = canViewOpsReport ? activeReport?.promptTemplates || [] : [];
  const planQualityFeedback = activeReport?.planQualityFeedback;
  const hasGeoActivity = reportGeoResults.length > 0;
  const hasBlogAction = reportBlogDiagnostics.some((item) => item.candidateStatus === "candidate" || item.geoResult !== "hit" || item.seoIssueCount > 0);
  const hasDistilledActivity = Boolean(activeReport && reportDistilledTermMatrix.length);
  const publishedCount = reportPublishRecords.filter((item) => item.publishStatus === "published" || item.publishStatus === "url_filled").length;
  const dataReturnedCount = reportPublishRecords.filter((item) => item.channelMetrics).length;
  const totalViews = reportPublishRecords.reduce((sum, item) => sum + (item.channelMetrics?.views || 0), 0);
  const totalEngagement = reportPublishRecords.reduce(
    (sum, item) => sum + (item.channelMetrics?.likes || 0) + (item.channelMetrics?.favorites || 0) + (item.channelMetrics?.comments || 0) + (item.channelMetrics?.shares || 0),
    0
  );
  const geoJotoHits = reportGeoResults.filter((item) => item.mentionedJoto).length;
  const geoWeikeHits = reportGeoResults.filter((item) => item.mentionedWeike).length;
  const officialCitationCount = reportGeoResults.filter((item) => item.citedOfficialUrl || item.citationLevel === "official_site_direct" || item.citationLevel === "official_content").length;
  const reportTargetTotalCount = activeReport?.targetTotalCount || activeReport?.planQualityFeedback?.totalPlanItems || weeklyPlan.targetTotalCount;
  const publishCompletionRate = reportTargetTotalCount ? Math.round((publishedCount / reportTargetTotalCount) * 100) : 0;
  const dataReturnRate = publishedCount ? Math.round((dataReturnedCount / publishedCount) * 100) : 0;
  const geoHitRate = reportGeoResults.length ? Math.round((geoJotoHits / reportGeoResults.length) * 100) : 0;
  const officialCitationRate = reportGeoResults.length ? Math.round((officialCitationCount / reportGeoResults.length) * 100) : 0;
  const previousCompletionRate = createPreviousValue(publishCompletionRate, 80);
  const previousDataReturnRate = createPreviousValue(dataReturnRate, 80);
  const previousGeoHitRate = createPreviousValue(geoHitRate, 60);
  const previousOfficialCitationRate = createPreviousValue(officialCitationRate, 50);
  const previousViews = Math.max(0, totalViews - 120);
  const generatedCount = reportTargetTotalCount ? Math.min(reportTargetTotalCount, reportPublishRecords.length) : reportPublishRecords.length;
  const reportActionItems = createReportActionItems(reportPublishRecords, reportBlogDiagnostics, reportGeoResults, Boolean(activeReport));
  const reportActionTotal = reportActionItems.reduce((sum, item) => sum + item.count, 0);
  const weeklySuggestionActions = createWeeklySuggestionActions(activeReport?.nextWeekSuggestionItems, activeReport?.nextWeekSuggestions, Boolean(activeReport));
  const suggestionTotal = activeReport?.nextWeekSuggestionItems?.length || 0;
  const suggestionDecidedCount = weeklySuggestionActions.filter((item) => item.decisionStatus).length;
  const suggestionAdoptedCount = weeklySuggestionActions.filter((item) => item.decisionStatus === "adopted").length;
  const suggestionDeviationCount = weeklySuggestionActions.filter((item) => item.decisionStatus === "partially_adopted" || item.decisionStatus === "rejected").length;
  const suggestionAdoptionRate = suggestionDecidedCount ? Math.round((suggestionAdoptedCount / suggestionDecidedCount) * 100) : 0;
  const previousSuggestionAdoptionRate = suggestionDecidedCount ? createPreviousValue(suggestionAdoptionRate, 60) : 0;
  const suggestionFailureRows = createSuggestionFailureRows(weeklySuggestionActions);
  const suggestionFailureTotal = suggestionFailureRows.reduce((sum, item) => sum + item.count, 0);
  const recommendationOutcomes = activeReport?.recommendationOutcomes || [];
  const measuredRecommendationOutcomeCount = recommendationOutcomes.filter((item) => item.evaluationStatus === "measured").length;
  const waitingRecommendationOutcomeCount = recommendationOutcomes.filter((item) => item.evaluationStatus === "waiting_next_week").length;
  const planQualitySignalCount = planQualityFeedback?.signals.filter((item) => item.count > 0).length || 0;
  const opsModuleRows = createOpsModuleRows({
    hasActiveReport: Boolean(activeReport),
    reportActionItems,
    reportPublishRecords,
    reportBlogDiagnostics,
    reportGeoResults,
    reportDistilledTermMatrix,
    reportPromptTemplates,
    planQualityFeedback,
    publishedCount,
    dataReturnedCount
  });
  const modulePendingCount = opsModuleRows.filter((item) => item.status === "attention" || item.status === "blocked").length;
  const botPv = botVisits.reduce((sum, item) => sum + item.pv, 0);

  useEffect(() => {
    if (!canViewOpsReport && activeView === "workbench_ops") {
      setActiveView("content_growth");
    }
  }, [activeView, canViewOpsReport]);

  const channelRows = useMemo(
    () =>
      Object.entries(channelLabels)
        .map(([channel, label]) => {
          const records = reportPublishRecords.filter((item) => item.channel === channel);
          const views = records.reduce((sum, item) => sum + (item.channelMetrics?.views || 0), 0);
          const engagement = records.reduce(
            (sum, item) => sum + (item.channelMetrics?.likes || 0) + (item.channelMetrics?.favorites || 0) + (item.channelMetrics?.comments || 0) + (item.channelMetrics?.shares || 0),
            0
          );

          return {
            channel: label,
            records: records.length,
            views,
            engagement,
            dataReturned: records.filter((item) => item.channelMetrics).length
          };
        })
        .filter((item) => item.records > 0),
    [reportPublishRecords]
  );
  const bestChannel = channelRows.length ? [...channelRows].sort((a, b) => b.views - a.views)[0] : undefined;

  const reviewInsights = [
    publishCompletionRate >= 80 ? "本周发布完成率处于可接受区间，下周可以优先优化选题质量和回传完整度。" : "本周发布完成率偏低，下周发布数量建议先保守，优先处理未发布任务。",
    dataReturnRate >= 80 ? "数据回传比较完整，可以支撑下周渠道分配判断。" : "数据回传不足，当前不适合只按渠道表现调整发布量。",
    bestChannel ? `${bestChannel.channel} 当前阅读最高，但是否加量仍需要结合选题质量和回传完整度判断。` : "当前还没有形成可用的渠道表现样本。",
    ...(hasGeoActivity
      ? [geoHitRate >= 60 ? "AI 可见度已有基础命中，下一步重点看官网是否被引用。" : "AI 可见度仍有缺口，应把未命中的用户问题沉淀为下周内容动作。"]
      : [])
  ];

  const opsSignals = [
    `周报建议：${suggestionTotal} 条，已处理 ${suggestionDecidedCount} 条`,
    `建议采纳：${suggestionAdoptedCount} 条，偏差 ${suggestionDeviationCount} 条`,
    `建议失败原因：${suggestionFailureTotal} 条`,
    `内部学习样本：周报建议后验 ${measuredRecommendationOutcomeCount + waitingRecommendationOutcomeCount} 条，不在周报展示效果变化`,
    planQualityFeedback
      ? `计划质量反馈：驳回 ${planQualityFeedback.rejectedCount} 条，风险接受 ${planQualityFeedback.riskAcceptedCount} 条，待复核 ${planQualityFeedback.reviewRequiredCount} 条`
      : "计划质量反馈：生成周报后展示",
    `模块待处理：${modulePendingCount} 项`,
    `待处理行动项：${reportActionTotal}`,
    `发布队列待处理：${reportActionItems.filter((item) => item.key === "publish_records").reduce((sum, item) => sum + item.count, 0)}`,
    `URL / 指标缺口：${reportActionItems.filter((item) => item.key === "fill_url" || item.key === "record_metrics").reduce((sum, item) => sum + item.count, 0)}`,
    ...(hasGeoActivity
      ? [`GEO 配置或候选问题：${reportActionItems.filter((item) => item.key === "geo_config" || item.key === "geo_candidates").reduce((sum, item) => sum + item.count, 0)}`]
      : []),
    `Demo AI 访问量：${botPv}`
  ];

  async function handleGenerateReport() {
    setGenerating(true);

    try {
      const result = await callJsonApi<WeeklyReport>(`/api/weekly-reports/${weeklyPlan.weekStart}`, { method: "GET" });
      setReport(result);
      messageApi.success("周报已生成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成周报失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleExportMarkdown() {
    setExportingMarkdown(true);

    try {
      const result = await callJsonApi<{ message?: string; data?: { markdown?: string } }>(`/api/weekly-reports/${weeklyPlan.weekStart}/export`, { method: "GET" });
      await navigator.clipboard.writeText(result.data?.markdown || "");
      messageApi.success(result.message || "周报 Markdown 已复制");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导出周报 Markdown 失败");
    } finally {
      setExportingMarkdown(false);
    }
  }

  async function handleDecideSuggestion(record: WeeklySuggestionAction, status: NonNullable<WeeklySuggestionItem["decisionStatus"]>) {
    if (!canDecideWeeklySuggestions) {
      messageApi.warning("当前角色不能处理周报建议，请联系内容增长人员或工作台运营。");
      return;
    }

    if (!record.id || !activeReport) {
      messageApi.warning("请先生成周报，再处理建议。");
      return;
    }

    setDecidingSuggestionId(record.id);

    try {
      const result = await callJsonApi<{ message?: string; data?: { report?: WeeklyReport } }>(`/api/weekly-reports/${activeReport.week}/suggestions/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          reason: suggestionDecisionReasons[record.id]
        })
      });
      if (result.data?.report) {
        setReport(result.data.report);
      }
      messageApi.success(result.message || "建议处理状态已保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存建议处理状态失败");
    } finally {
      setDecidingSuggestionId(undefined);
    }
  }

  async function handleCreateNextPlan() {
    if (!activeReport) {
      messageApi.warning("请先生成周报，再把建议带入周计划草稿。");
      return;
    }

    setCreatingNextPlan(true);

    try {
      const result = await callJsonApi<{ message?: string }>(`/api/weekly-reports/${activeReport.week}/next-plan`, {
        method: "POST",
        body: JSON.stringify({})
      });
      messageApi.success(result.message || "已生成下周计划草稿");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成下周计划草稿失败");
    } finally {
      setCreatingNextPlan(false);
    }
  }

  function openDetailDrawer(key: DetailDrawerKey) {
    setDetailDrawer(key);
  }

  function renderWeeklySuggestionEntry(record: WeeklySuggestionAction) {
    if (record.entry.type === "button") {
      return (
        <Button size="small" type="primary" loading={generating} onClick={handleGenerateReport} data-testid="weekly-report-generate-button">
          {record.entry.label}
        </Button>
      );
    }

    return (
      <Link href={record.entry.href}>
        <Button size="small">{record.entry.label}</Button>
      </Link>
    );
  }

  function renderOpsModuleEntry(record: OpsModuleRow) {
    const entry = record.entry;

    if (!entry) {
      return <Tag>无入口</Tag>;
    }

    if (entry.type === "link") {
      if (entry.href === "/ai-config") {
        return <GovernanceEntry label={entry.label} reason="AI 配置和 Prompt 日志属于工作台运营视角；内容增长人员只看业务复盘和下周动作。" />;
      }

      return (
        <Link href={entry.href}>
          <Button size="small">{entry.label}</Button>
        </Link>
      );
    }

    return (
      <Button size="small" onClick={() => openDetailDrawer(entry.drawerKey)}>
        {entry.label}
      </Button>
    );
  }

  function renderDetailDrawer() {
    if (detailDrawer === "publish") {
      return (
        <Table
          rowKey="id"
          size="small"
          dataSource={reportPublishRecords}
          columns={[
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as keyof typeof channelLabels] },
            { title: "标题", dataIndex: "title" },
            { title: "状态", dataIndex: "publishStatus", render: (value) => <Tag>{publishStatusLabels[value as PublishRecord["publishStatus"]]}</Tag> },
            {
              title: "数据",
              render: (_, record) =>
                record.channelMetrics ? (
                  <Space wrap size={[4, 4]}>
                    <Tag>阅读 {record.channelMetrics.views ?? 0}</Tag>
                    <Tag>互动 {(record.channelMetrics.likes || 0) + (record.channelMetrics.favorites || 0) + (record.channelMetrics.comments || 0) + (record.channelMetrics.shares || 0)}</Tag>
                  </Space>
                ) : (
                  <Tag>待回传</Tag>
                )
            }
          ]}
        />
      );
    }

    if (detailDrawer === "blog") {
      return (
        <Table
          rowKey="id"
          size="small"
          dataSource={reportBlogDiagnostics}
          columns={[
            { title: "标题", dataIndex: "title" },
            { title: "SEO 问题", dataIndex: "seoIssueCount" },
            { title: "GEO 结果", dataIndex: "geoResult", render: (value) => <Tag>{blogGeoResultLabels[value as BlogArticle["geoResult"]]}</Tag> },
            { title: "候选状态", dataIndex: "candidateStatus", render: (value) => <Tag>{value || "none"}</Tag> },
            { title: "数据来源", dataIndex: "dataConfidence", render: (value) => <DataConfidenceTag value={value} /> }
          ]}
        />
      );
    }

    if (detailDrawer === "geo") {
      return (
        <Table
          rowKey="id"
          size="small"
          dataSource={reportGeoResults}
          scroll={{ x: 1040 }}
          columns={[
            { title: "平台", dataIndex: "platform" },
            { title: "用户问题", dataIndex: "prompt" },
            { title: "品牌", dataIndex: "mentionedJoto", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "被提到" : "未提到"}</Tag> },
            { title: "产品", dataIndex: "mentionedWeike", render: (value) => <Tag color={value ? "green" : "gold"}>{value ? "被提到" : "未提到"}</Tag> },
            { title: "官网", dataIndex: "citedOfficialUrl", render: (value) => <Tag color={value ? "green" : "gold"}>{value ? "被引用" : "未引用"}</Tag> },
            { title: "官网引用情况", dataIndex: "citationLevel", render: (value) => citationLevelLabels[value || "none"] || value },
            { title: "问题缺口", render: (_, record) => getGeoBusinessGap(record) },
            { title: "下一步动作", render: (_, record) => getGeoBusinessNextStep(record) },
            { title: "测试状态", dataIndex: "executionStatus", render: (value) => <Tag>{geoExecutionStatusLabels[(value || "success") as NonNullable<GeoTestResult["executionStatus"]>]}</Tag> },
            {
              title: "详情",
              render: (_, record) => (
                <Link href={`/geo-test/${record.id}`}>
                  <Button size="small">看详情</Button>
                </Link>
              )
            }
          ]}
        />
      );
    }

    if (detailDrawer === "distilled") {
      return (
        <Table
          rowKey="id"
          size="small"
          dataSource={reportDistilledTermMatrix}
          locale={{ emptyText: "生成周报后展示蒸馏词覆盖明细。" }}
          columns={[
            { title: "蒸馏词", dataIndex: "term" },
            { title: "内容覆盖", dataIndex: "contentCoverage", render: (value) => <Tag>{value} 篇</Tag> },
            { title: "类型完整度", dataIndex: "typeCompleteness" },
            { title: "AI 可见度变化", dataIndex: "geoLift", render: (value) => <Tag color={value > 10 ? "green" : "gold"}>{value}</Tag> },
            { title: "下周建议", dataIndex: "nextSuggestion" }
          ]}
        />
      );
    }

    if (detailDrawer === "suggestion_failures") {
      return (
        <Table
          rowKey="key"
          size="small"
          dataSource={suggestionFailureRows}
          scroll={{ x: 760 }}
          locale={{ emptyText: "暂无部分采纳或拒绝原因。" }}
          columns={[
            { title: "原因分类", dataIndex: "reason" },
            { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
            {
              title: "影响建议",
              render: (_, record) => (
                <Space direction="vertical" size={4}>
                  {record.suggestions.map((suggestion: string, index: number) => (
                    <span key={`${record.key}-${index}`}>{suggestion}</span>
                  ))}
                </Space>
              )
            },
            {
              title: "填写原因",
              render: (_, record) => (
                <Space wrap size={[4, 4]}>
                  {record.decisionReasons.map((reason: string, index: number) => (
                    <Tag key={`${record.key}-reason-${index}`}>{reason}</Tag>
                  ))}
                </Space>
              )
            },
            { title: "下一步", dataIndex: "nextStep" }
          ]}
        />
      );
    }

    if (detailDrawer === "ops_modules") {
      return (
        <Table
          rowKey="key"
          size="small"
          dataSource={opsModuleRows}
          pagination={false}
          scroll={{ x: 820 }}
          columns={[
            { title: "模块", dataIndex: "module" },
            {
              title: "状态",
              dataIndex: "status",
              render: (value) => <Tag color={opsModuleStatusColors[value as OpsModuleStatus]}>{opsModuleStatusLabels[value as OpsModuleStatus]}</Tag>
            },
            { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
            { title: "当前问题", dataIndex: "issue" },
            { title: "下一步", dataIndex: "nextStep" },
            { title: "入口", render: (_, record) => renderOpsModuleEntry(record) }
          ]}
        />
      );
    }

    if (detailDrawer === "plan_quality") {
      return (
        <Table
          rowKey="key"
          size="small"
          dataSource={planQualityFeedback?.signals || []}
          pagination={false}
          scroll={{ x: 920 }}
          locale={{ emptyText: "生成周报后展示周计划质量反馈。" }}
          columns={[
            { title: "反馈信号", dataIndex: "label" },
            {
              title: "状态",
              dataIndex: "status",
              render: (value) => <Tag color={opsModuleStatusColors[value as WeeklyPlanQualitySignal["status"]]}>{opsModuleStatusLabels[value as WeeklyPlanQualitySignal["status"]]}</Tag>
            },
            { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
            { title: "说明", dataIndex: "summary" },
            { title: "下一步", dataIndex: "nextStep" },
            {
              title: "示例",
              render: (_, record: WeeklyPlanQualitySignal) =>
                record.examples.length ? (
                  <Space direction="vertical" size={4}>
                    {record.examples.map((example, index) => (
                      <span key={`${record.key}-${index}`}>{example}</span>
                    ))}
                  </Space>
                ) : (
                  <Tag>无</Tag>
                )
            }
          ]}
        />
      );
    }

    return null;
  }

  const drawerTitles: Record<Exclude<DetailDrawerKey, undefined>, string> = {
    publish: "发布与渠道明细",
    blog: "官网博客诊断详情",
    geo: "GEO 业务详情",
    distilled: "蒸馏词覆盖详情",
    suggestion_failures: "建议失败原因详情",
    ops_modules: "模块执行情况详情",
    plan_quality: "周计划质量反馈详情"
  };

  return (
    <>
      {contextHolder}
      <PageHeader
        title="周度复盘"
        subtitle="默认先回答内容增长人员最关心的问题；底层明细进入详情抽屉，内部优化指标不占主视角。"
        actions={
          <>
            <Link href="/weekly-plan">
              <Button>进入周计划生成预览</Button>
            </Link>
            <Button loading={exportingMarkdown} onClick={handleExportMarkdown}>
              导出 Markdown
            </Button>
            <Button type="primary" loading={generating} onClick={handleGenerateReport} data-testid="weekly-report-generate-button">
              生成周报
            </Button>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      <Tabs
        className="report-view-tabs"
        activeKey={showOpsView ? "workbench_ops" : "content_growth"}
        onChange={(key) => setActiveView(key as ReportView)}
        items={[
          { key: "content_growth", label: "内容增长视角" },
          ...(canViewOpsReport ? [{ key: "workbench_ops", label: "工作台运营视角" }] : [])
        ]}
      />

      {!showOpsView ? (
        <section className="report-section">
          <Card title="本周基础 KPI">
            <div className="report-kpi-grid">
              <ReportKpiCard title="发布完成率" value={publishCompletionRate} suffix="%" trend={publishCompletionRate - previousCompletionRate} />
              <ReportKpiCard title="数据回传率" value={dataReturnRate} suffix="%" trend={dataReturnRate - previousDataReturnRate} />
              <ReportKpiCard title="总阅读" value={totalViews} trend={totalViews - previousViews} />
              <ReportKpiCard title="总互动" value={totalEngagement} trend={totalEngagement ? 12 : 0} />
              {hasGeoActivity ? <ReportKpiCard title="品牌被 AI 提到" value={geoHitRate} suffix="%" trend={geoHitRate - previousGeoHitRate} /> : null}
              {hasGeoActivity ? <ReportKpiCard title="官网被引用" value={officialCitationRate} suffix="%" trend={officialCitationRate - previousOfficialCitationRate} /> : null}
            </div>
          </Card>

          {activeReport ? (
            <Alert
              showIcon
              type="success"
              message={activeReport.executiveSummary}
              description={
                <Space wrap>
                  <Tag color="blue">week: {activeReport.week}</Tag>
                  <Tag>data: {activeReport.dataSource}</Tag>
                </Space>
              }
            />
          ) : (
            <Alert showIcon type="info" message="当前展示运行态快照" description="点击生成周报后，会固化本周发布、博客诊断、GEO 测试和下周建议。" />
          )}

          <div className="report-two-column">
            <Card title="AI 复盘结论">
              <List
                size="small"
                dataSource={reviewInsights}
                renderItem={(item) => (
                  <List.Item>
                    <span>{item}</span>
                  </List.Item>
                )}
              />
            </Card>
            <Card title="本周执行入口">
              <Space wrap>
                <Button onClick={() => openDetailDrawer("publish")}>查看发布明细</Button>
                {hasBlogAction ? (
                  <Link href="/blog-candidates">
                    <Button>处理博客候选</Button>
                  </Link>
                ) : null}
                {hasGeoActivity ? (
                  <Button onClick={() => openDetailDrawer("geo")}>查看 GEO 详情</Button>
                ) : null}
                {hasDistilledActivity ? (
                  <Button onClick={() => openDetailDrawer("distilled")}>查看蒸馏词详情</Button>
                ) : null}
              </Space>
            </Card>
          </div>

          <Card
            title="下周建议"
            extra={
              activeReport ? (
                <Popconfirm
                  title="带入周计划草稿"
                  description="将根据本周周报建议生成下一周计划草稿。"
                  okText="生成"
                  cancelText="取消"
                  okButtonProps={{ "data-testid": "weekly-report-next-plan-confirm" }}
                  onConfirm={handleCreateNextPlan}
                >
                  <Button size="small" type="primary" icon={<CarryOutOutlined />} loading={creatingNextPlan} data-testid="weekly-report-next-plan-button">
                    带入周计划草稿
                  </Button>
                </Popconfirm>
              ) : null
            }
          >
            <Table
              rowKey="key"
              pagination={false}
              dataSource={weeklySuggestionActions}
              columns={[
                { title: "建议", dataIndex: "suggestion" },
                {
                  title: "下一步",
                  dataIndex: "nextStep",
                  render: (value) => <Tag color={weeklySuggestionStepColors[value as WeeklySuggestionStep]}>{weeklySuggestionStepLabels[value as WeeklySuggestionStep]}</Tag>
                },
                { title: "处理动作", dataIndex: "actionText" },
                {
                  title: "处理状态",
                  render: (_, record) =>
                    record.decisionStatus ? (
                      <Space direction="vertical" size={0}>
                        <Tag color={weeklySuggestionDecisionColors[record.decisionStatus]}>{weeklySuggestionDecisionLabels[record.decisionStatus]}</Tag>
                        {record.decisionReason ? <span className="muted">{record.decisionReason}</span> : null}
                      </Space>
                    ) : (
                      <Tag>待处理</Tag>
                    )
                },
                {
                  title: "原因",
                  render: (_, record) => (
                    <Input
                      size="small"
                      placeholder="可填写采纳或拒绝原因"
                      value={suggestionDecisionReasons[record.id || record.key] || record.decisionReason || ""}
                      onChange={(event) =>
                        setSuggestionDecisionReasons((current) => ({
                          ...current,
                          [record.id || record.key]: event.target.value
                        }))
                      }
                    />
                  )
                },
                {
                  title: "执行入口",
                  render: (_, record) => (
                    <Space wrap>
                      {renderWeeklySuggestionEntry(record)}
                      {activeReport && canDecideWeeklySuggestions ? (
                        <>
                          <Button size="small" loading={decidingSuggestionId === record.id} onClick={() => handleDecideSuggestion(record, "adopted")}>
                            采纳
                          </Button>
                          <Button size="small" loading={decidingSuggestionId === record.id} onClick={() => handleDecideSuggestion(record, "partially_adopted")}>
                            部分采纳
                          </Button>
                          <Button size="small" danger loading={decidingSuggestionId === record.id} onClick={() => handleDecideSuggestion(record, "rejected")}>
                            拒绝
                          </Button>
                        </>
                      ) : activeReport ? (
                        <Tag>需内容增长或工作台运营处理</Tag>
                      ) : null}
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        </section>
      ) : (
        <section className="report-section">
          <Card title="运营质量概览">
            <div className="report-kpi-grid">
              <ReportKpiCard title="建议采纳率" value={suggestionAdoptionRate} suffix="%" trend={suggestionAdoptionRate - previousSuggestionAdoptionRate} />
              <ReportKpiCard title="建议偏差" value={suggestionDeviationCount} suffix="条" trend={suggestionDeviationCount ? 1 : 0} positiveGood={false} />
              <ReportKpiCard title="失败原因" value={suggestionFailureRows.length} suffix="类" trend={suggestionFailureTotal ? 1 : 0} positiveGood={false} />
              <ReportKpiCard title="计划反馈" value={planQualitySignalCount} suffix="类" trend={planQualitySignalCount ? 1 : 0} positiveGood={false} />
              <ReportKpiCard title="模块待处理" value={modulePendingCount} suffix="项" trend={modulePendingCount ? 1 : 0} positiveGood={false} />
            </div>
          </Card>

          <div className="report-two-column">
            <Card title="建议失败原因 Top 5">
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={suggestionFailureRows}
                scroll={{ x: 720 }}
                locale={{ emptyText: "暂无部分采纳或拒绝原因。" }}
                columns={[
                  { title: "原因", dataIndex: "reason" },
                  { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
                  { title: "下一步", dataIndex: "nextStep" },
                  {
                    title: "详情",
                    render: () => (
                      <Button size="small" onClick={() => openDetailDrawer("suggestion_failures")}>
                        看原因
                      </Button>
                    )
                  }
                ]}
              />
            </Card>

            <Card title="模块执行情况">
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={opsModuleRows}
                scroll={{ x: 760 }}
                columns={[
                  { title: "模块", dataIndex: "module" },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (value) => <Tag color={opsModuleStatusColors[value as OpsModuleStatus]}>{opsModuleStatusLabels[value as OpsModuleStatus]}</Tag>
                  },
                  { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
                  { title: "问题", dataIndex: "issue" },
                  { title: "入口", render: (_, record) => renderOpsModuleEntry(record) }
                ]}
              />
            </Card>
          </div>

          <div className="report-two-column">
            <Card title="复盘行动队列">
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={reportActionItems}
                columns={[
                  { title: "问题", dataIndex: "issue" },
                  { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
                  {
                    title: "下一步",
                    dataIndex: "key",
                    render: (value) => <Tag color={reportActionStepColors[value as ReportActionStep]}>{reportActionStepLabels[value as ReportActionStep]}</Tag>
                  },
                  {
                    title: "入口",
                    render: (_, record) =>
                      record.entryHref === "/ai-config" ? (
                        <GovernanceEntry label={record.entryLabel} reason="GEO 配置问题需要工作台运营或开发管理员处理；周报只保留业务动作入口。" />
                      ) : (
                        <Link href={record.entryHref}>
                          <Button size="small">{record.entryLabel}</Button>
                        </Link>
                      )
                  }
                ]}
              />
            </Card>

            <Card title="内部优化信号">
              <List
                size="small"
                dataSource={opsSignals}
                renderItem={(item) => (
                  <List.Item>
                    <span>{item}</span>
                  </List.Item>
                )}
              />
              <Space wrap style={{ marginTop: 12 }}>
                <Button onClick={() => openDetailDrawer("plan_quality")}>计划质量反馈详情</Button>
                <Button onClick={() => openDetailDrawer("suggestion_failures")}>建议失败原因详情</Button>
                <Button onClick={() => openDetailDrawer("ops_modules")}>模块执行情况详情</Button>
                <Button onClick={() => openDetailDrawer("publish")}>发布与回传明细</Button>
                {hasBlogAction ? <Button onClick={() => openDetailDrawer("blog")}>博客诊断详情</Button> : null}
                {hasGeoActivity ? <Button onClick={() => openDetailDrawer("geo")}>GEO 业务详情</Button> : null}
                {hasDistilledActivity ? <Button onClick={() => openDetailDrawer("distilled")}>蒸馏词覆盖详情</Button> : null}
                <GovernanceEntry label="进入 AI 配置" reason="模型规则版本、调用记录和排查信息属于 AI 配置页；周报只保留运营判断和处理入口。" />
              </Space>
            </Card>
          </div>
        </section>
      )}

      {!reportPublishRecords.length ? (
        <Card>
          <ActionEmpty
            title="还没有可复盘的发布记录"
            description="先完成终稿确认、发布标记和 URL 回填，再生成更有用的周报。"
            action={
              <Link href="/publish">
                <Button type="primary">去发布队列</Button>
              </Link>
            }
          />
        </Card>
      ) : null}

      <Drawer width={920} title={detailDrawer ? drawerTitles[detailDrawer] : ""} open={Boolean(detailDrawer)} onClose={() => setDetailDrawer(undefined)}>
        {renderDetailDrawer()}
      </Drawer>
    </>
  );
}
