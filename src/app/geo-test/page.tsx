"use client";

import { Alert, Button, Card, Checkbox, Drawer, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { GovernanceEntry } from "@/components/GovernanceEntry";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { confidenceLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { BlogArticle, DataConfidence, GeoTestResult } from "@/lib/types";
import { useMemo, useState } from "react";

type BooleanFilter = "yes" | "no";
type GeoExecutionStatus = NonNullable<GeoTestResult["executionStatus"]>;
type GeoIssueLevel = "pending_config" | "failed" | "high" | "medium" | "healthy";
type GeoNextStep = "configure_models" | "inspect_failure" | "add_candidate" | "fix_citation" | "candidate_pool" | "planned" | "dismissed" | "observe";
type GeoCandidateStatusView = NonNullable<BlogArticle["candidateStatus"]>;
type GeoAccuracyStatus = NonNullable<GeoTestResult["accuracyStatus"]>;
type GeoReviewStatus = NonNullable<GeoTestResult["reviewStatus"]>;
type GeoLogSupportStatus = "ready" | "uploaded" | "missing";
type GeoCitationLevel = NonNullable<GeoTestResult["citationLevel"]>;
type GeoTestCategory = NonNullable<GeoTestResult["testCategory"]>;
type GeoFrequencySuggestion = {
  label: string;
  days: number;
  reason: string;
};

const distilledTermOptions = [
  { id: "term-dify-enterprise", label: "Dify 企业版服务商" },
  { id: "term-dify-provider", label: "Dify 服务商" },
  { id: "term-ai-guardrails", label: "AI 护栏" },
  { id: "term-enterprise-ai-safety", label: "企业大模型安全" },
  { id: "term-joto-delivery", label: "企业级交付" }
];

const promptGroupLabels: Record<GeoTestResult["promptGroup"], string> = {
  品牌认知: "品牌认知",
  产品场景: "产品场景",
  对比: "对比",
  FAQ: "FAQ"
};

const promptGroupDescriptions: Record<GeoTestResult["promptGroup"], { prompts: string[]; recommendedTerms: string[]; enabled: boolean }> = {
  品牌认知: {
    prompts: ["推荐几家国内 Dify 企业版服务商", "企业做 Dify 私有化应该找什么类型服务商"],
    recommendedTerms: ["Dify 企业版服务商", "Dify 服务商"],
    enabled: true
  },
  产品场景: {
    prompts: ["企业接入大模型后如何做输出安全治理", "Dify 应用需要 AI 护栏吗"],
    recommendedTerms: ["AI 护栏", "企业大模型安全"],
    enabled: true
  },
  对比: {
    prompts: ["JOTO 和其他 AI 应用服务商分别适合什么场景", "只靠提示词和专业护栏有什么差别"],
    recommendedTerms: ["企业级交付", "AI 护栏"],
    enabled: true
  },
  FAQ: {
    prompts: ["Dify 应用上线前要检查哪些风险", "企业如何判断 AI 服务商是否可靠"],
    recommendedTerms: ["Dify 服务商", "企业级交付"],
    enabled: true
  }
};

const citationLevelLabels: Record<GeoCitationLevel, string> = {
  official_site_direct: "官网直引",
  official_content: "官方内容引用",
  official_channel: "官方渠道引用",
  non_official: "非官方引用",
  none: "无引用"
};

const citationLevelColors: Record<GeoCitationLevel, string> = {
  official_site_direct: "green",
  official_content: "cyan",
  official_channel: "blue",
  non_official: "orange",
  none: "red"
};

const executionStatusLabels: Record<GeoExecutionStatus, string> = {
  success: "已完成",
  pending_config: "待配置",
  failed: "失败"
};

const executionStatusColors: Record<GeoExecutionStatus, string> = {
  success: "green",
  pending_config: "gold",
  failed: "red"
};

const geoIssueLevelLabels: Record<GeoIssueLevel, string> = {
  pending_config: "待配置",
  failed: "失败",
  high: "高",
  medium: "中",
  healthy: "正常"
};

const geoIssueLevelColors: Record<GeoIssueLevel, string> = {
  pending_config: "gold",
  failed: "red",
  high: "red",
  medium: "gold",
  healthy: "green"
};

const geoNextStepLabels: Record<GeoNextStep, string> = {
  configure_models: "配置模型",
  inspect_failure: "排查失败",
  add_candidate: "建议入候选池",
  fix_citation: "补官网引用",
  candidate_pool: "候选池处理",
  planned: "已规划",
  dismissed: "暂不处理",
  observe: "继续观察"
};

const geoNextStepColors: Record<GeoNextStep, string> = {
  configure_models: "gold",
  inspect_failure: "red",
  add_candidate: "purple",
  fix_citation: "blue",
  candidate_pool: "blue",
  planned: "green",
  dismissed: "default",
  observe: "green"
};

const geoCandidateStatusLabels: Record<GeoCandidateStatusView, string> = {
  none: "未入池",
  candidate: "已入池",
  planned: "已规划",
  dismissed: "暂不处理"
};

const geoCandidateStatusColors: Record<GeoCandidateStatusView, string> = {
  none: "default",
  candidate: "blue",
  planned: "green",
  dismissed: "default"
};

const booleanFilterLabels: Record<BooleanFilter, string> = {
  yes: "是",
  no: "否"
};

const geoPlatforms: GeoTestResult["platform"][] = ["DeepSeek", "豆包", "通义千问"];
const geoPromptGroups: GeoTestResult["promptGroup"][] = ["品牌认知", "产品场景", "对比", "FAQ"];
const baselinePromptGroups: GeoTestResult["promptGroup"][] = ["品牌认知", "产品场景"];
const dynamicPromptGroups: GeoTestResult["promptGroup"][] = ["对比", "FAQ"];
const geoTestCategoryLabels: Record<GeoTestCategory, string> = {
  baseline_fixed: "基线固定问题组",
  dynamic_exploration: "动态蒸馏词探索"
};
const geoTestCategoryDescriptions: Record<GeoTestCategory, string> = {
  baseline_fixed: "占测试预算 20%，只跑固定问题组，用来做跨周可比基线。",
  dynamic_exploration: "占测试预算 80%，围绕蒸馏词和内容缺口做探索。"
};
const accuracyStatusLabels: Record<GeoAccuracyStatus, string> = {
  accurate: "可信",
  needs_review: "待复核",
  inaccurate: "不准确"
};
const accuracyStatusColors: Record<GeoAccuracyStatus, string> = {
  accurate: "green",
  needs_review: "gold",
  inaccurate: "red"
};
const reviewStatusLabels: Record<GeoReviewStatus, string> = {
  auto_checked: "自动通过",
  manual_review_needed: "待人工复核",
  manual_confirmed: "人工确认"
};
const reviewStatusColors: Record<GeoReviewStatus, string> = {
  auto_checked: "green",
  manual_review_needed: "gold",
  manual_confirmed: "blue"
};

function getAccuracyStatus(result: GeoTestResult): GeoAccuracyStatus {
  return result.accuracyStatus || (result.mentionedJoto && result.citedOfficialUrl ? "accurate" : "needs_review");
}

function getReviewStatus(result: GeoTestResult): GeoReviewStatus {
  return result.reviewStatus || (result.manualOverride ? "manual_confirmed" : getAccuracyStatus(result) === "accurate" ? "auto_checked" : "manual_review_needed");
}

function getLogSupportStatus(botVisitCount: number, logConfidence: DataConfidence): GeoLogSupportStatus {
  if (botVisitCount > 0 && (logConfidence === "real" || logConfidence === "imported")) {
    return logConfidence === "real" ? "ready" : "uploaded";
  }

  return "missing";
}

function getExecutionStatus(result: GeoTestResult): GeoExecutionStatus {
  return result.executionStatus || "success";
}

function getDataConfidence(result: GeoTestResult): DataConfidence {
  return result.dataConfidence || "demo";
}

function getCitationLevel(result: GeoTestResult): GeoCitationLevel {
  if (result.citationLevel) {
    return result.citationLevel;
  }

  if (result.citedUrls?.some((url) => /jotoai\.com\/(blog|articles|news|docs|case|cases)/i.test(url))) {
    return "official_content";
  }

  if (result.citedOfficialUrl || result.citedUrls?.some((url) => /jotoai\.com/i.test(url))) {
    return "official_site_direct";
  }

  if (result.citedUrls?.some((url) => /(mp\.weixin\.qq\.com|zhihu\.com|juejin\.cn|csdn\.net)/i.test(url))) {
    return "official_channel";
  }

  if (result.citedUrls?.length) {
    return "non_official";
  }

  return "none";
}

function getGeoCandidateStatus(article?: BlogArticle): GeoCandidateStatusView {
  return article?.candidateStatus || "none";
}

function getGeoIssueLevel(result: GeoTestResult): GeoIssueLevel {
  const executionStatus = getExecutionStatus(result);

  if (executionStatus === "pending_config") {
    return "pending_config";
  }

  if (executionStatus === "failed") {
    return "failed";
  }

  if (!result.mentionedJoto) {
    return "high";
  }

  if (!result.citedOfficialUrl) {
    return "medium";
  }

  return "healthy";
}

function getGeoNextStep(result: GeoTestResult, candidateArticle?: BlogArticle): GeoNextStep {
  const executionStatus = getExecutionStatus(result);
  const candidateStatus = getGeoCandidateStatus(candidateArticle);

  if (executionStatus === "pending_config") {
    return "configure_models";
  }

  if (executionStatus === "failed") {
    return "inspect_failure";
  }

  if (candidateStatus === "planned") {
    return "planned";
  }

  if (candidateStatus === "dismissed") {
    return "dismissed";
  }

  if (candidateStatus === "candidate") {
    return "candidate_pool";
  }

  if (!result.mentionedJoto) {
    return "add_candidate";
  }

  if (!result.citedOfficialUrl) {
    return "fix_citation";
  }

  return "observe";
}

function getGeoSuggestionReason(result: GeoTestResult, candidateArticle?: BlogArticle): string {
  const executionStatus = getExecutionStatus(result);

  if (executionStatus === "pending_config") {
    return "模型配置未就绪，先在 AI 配置页补齐模型接入设置后再判断结果。";
  }

  if (executionStatus === "failed") {
    return result.errorMessage || "GEO 测试执行失败，先进入详情页查看错误信息。";
  }

  if (candidateArticle?.candidateReason) {
    return candidateArticle.candidateReason;
  }

  if (!result.mentionedJoto) {
    return "AI 回答未提及 JOTO，建议沉淀为博客或渠道补强主题。";
  }

  if (!result.citedOfficialUrl) {
    return "已提及 JOTO 但缺少官网引用，建议补强官网事实链路。";
  }

  if (!result.mentionedWeike) {
    return "品牌和官网链路已命中，唯客提及可在产品场景继续观察。";
  }

  return "品牌、产品和官网链路均已命中，继续观察后续波动。";
}

function getGeoActionText(result: GeoTestResult, candidateArticle?: BlogArticle): string {
  const nextStep = getGeoNextStep(result, candidateArticle);

  if (nextStep === "configure_models") {
    return "先补齐模型配置，再重新运行当前平台和问题组的 GEO 测试。";
  }

  if (nextStep === "inspect_failure") {
    return "先进入详情页查看错误信息，确认失败原因后再重跑或人工修正。";
  }

  if (nextStep === "add_candidate") {
    return "当前结果已说明内容缺口，优先加入博客候选池，后续进入补强流程。";
  }

  if (nextStep === "fix_citation") {
    return "品牌已命中但官网引用不足，建议回博客监控或候选池补强官网事实链路。";
  }

  if (nextStep === "candidate_pool") {
    return "主题已经进入候选池，下一步去候选池判断生成任务、标记规划还是继续观察。";
  }

  if (nextStep === "planned") {
    return "补强主题已进入规划，去周计划或候选池查看承接结果。";
  }

  if (nextStep === "dismissed") {
    return "当前结果已标记暂不处理，后续在周报或新一轮 GEO 测试中复看。";
  }

  return "当前没有新的处置动作，继续观察品牌、产品和官网链路是否保持稳定。";
}

function getBrandVisibilityLabel(result: GeoTestResult) {
  return result.mentionedJoto ? "AI 提到了 JOTO" : "AI 没提到 JOTO";
}

function getProductVisibilityLabel(result: GeoTestResult) {
  if (result.promptGroup !== "产品场景" && !result.mentionedWeike) {
    return "产品未触发";
  }

  return result.mentionedWeike ? "产品被正确提到" : "产品未被提到";
}

function getOfficialSourceLabel(result: GeoTestResult) {
  const level = getCitationLevel(result);

  if (level === "official_site_direct") return "引用官网";
  if (level === "official_content" || level === "official_channel") return "引用官方内容";
  if (level === "non_official") return "引用非官方来源";
  return "未引用官网";
}

function hasGeoContentGap(result: GeoTestResult) {
  const nextStep = getGeoNextStep(result);
  return nextStep === "add_candidate" || nextStep === "fix_citation";
}

function getFrequencySuggestion(weeklyPublishCount: number): GeoFrequencySuggestion {
  if (weeklyPublishCount <= 5) {
    return {
      label: "每月 1 次完整 GEO 测试",
      days: 30,
      reason: "当前发布量较低，月度复盘即可发现长期认知变化。"
    };
  }

  if (weeklyPublishCount <= 15) {
    return {
      label: "每两周 1 次完整 GEO 测试",
      days: 14,
      reason: "当前发布量适中，双周测试可以兼顾成本和问题发现速度。"
    };
  }

  return {
    label: "每周 1 次完整 GEO 测试",
    days: 7,
    reason: "当前发布量较高，GEO 失真需要更快暴露并进入候选池。"
  };
}

function addDaysToDateTime(dateText: string | undefined, days: number) {
  if (!dateText) {
    return "-";
  }

  const timestamp = Date.parse(dateText);

  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);

  return date.toISOString().slice(0, 10);
}

export default function GeoTestPage() {
  const {
    state: { geoResults, blogArticles, botVisits, tasks, weeklyPlan },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [running, setRunning] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [addingCandidateId, setAddingCandidateId] = useState<string>();
  const [creatingTaskId, setCreatingTaskId] = useState<string>();
  const [creatingKnowledgeBaseId, setCreatingKnowledgeBaseId] = useState<string>();
  const [testCategory, setTestCategory] = useState<GeoTestCategory>("baseline_fixed");
  const [platforms, setPlatforms] = useState<GeoTestResult["platform"][]>(["DeepSeek", "豆包", "通义千问"]);
  const [promptGroups, setPromptGroups] = useState<GeoTestResult["promptGroup"][]>(["品牌认知", "产品场景"]);
  const [selectedDistilledTermIds, setSelectedDistilledTermIds] = useState<string[]>([]);
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [overrideResult, setOverrideResult] = useState<GeoTestResult>();
  const [platformFilter, setPlatformFilter] = useState<GeoTestResult["platform"][]>([]);
  const [promptGroupFilter, setPromptGroupFilter] = useState<GeoTestResult["promptGroup"][]>([]);
  const [executionStatusFilter, setExecutionStatusFilter] = useState<GeoExecutionStatus[]>([]);
  const [jotoMentionFilter, setJotoMentionFilter] = useState<BooleanFilter[]>([]);
  const [citationLevelFilter, setCitationLevelFilter] = useState<GeoCitationLevel[]>([]);
  const [dataConfidenceFilter, setDataConfidenceFilter] = useState<DataConfidence[]>([]);
  const [overrideValues, setOverrideValues] = useState({
    mentionedJoto: false,
    mentionedWeike: false,
    citedOfficialUrl: false,
    competitorAppeared: false
  });
  const botConfidence: DataConfidence = botVisits.some((item) => item.dataConfidence === "real")
    ? "real"
    : botVisits.some((item) => item.dataConfidence === "imported")
      ? "imported"
      : botVisits.some((item) => item.dataConfidence === "demo")
        ? "demo"
        : "pending";
  const botPv = botVisits.reduce((sum, item) => sum + item.pv, 0);
  const logSupportStatus = getLogSupportStatus(botVisits.length, botConfidence);
  const activeDistilledTermIds = testCategory === "baseline_fixed" ? [] : selectedDistilledTermIds;
  const matrixSize = platforms.length * promptGroups.length * Math.max(activeDistilledTermIds.length, 1);
  const geoHitRate = geoResults.length ? Math.round((geoResults.filter((item) => item.mentionedJoto).length / geoResults.length) * 100) : 0;
  const officialDirectRate = geoResults.length ? Math.round((geoResults.filter((item) => getCitationLevel(item) === "official_site_direct").length / geoResults.length) * 100) : 0;
  const reviewNeededTotal = geoResults.filter((item) => getReviewStatus(item) === "manual_review_needed").length;
  const competitorAppearedTotal = geoResults.filter((item) => item.competitorAppeared).length;
  const productMentionRate = geoResults.length ? Math.round((geoResults.filter((item) => item.mentionedWeike).length / geoResults.length) * 100) : 0;
  const contentGapCount = geoResults.filter(hasGeoContentGap).length;
  const weeklyPublishCount = tasks.filter((item) => item.weeklyPlanId === weeklyPlan.id).length || weeklyPlan.targetTotalCount;
  const frequencySuggestion = getFrequencySuggestion(weeklyPublishCount);
  const latestTestedAt = [...geoResults]
    .map((item) => item.testedAt)
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const citationLevelCounts = geoResults.reduce<Record<GeoCitationLevel, number>>(
    (counts, item) => {
      const level = getCitationLevel(item);
      counts[level] += 1;
      return counts;
    },
    {
      official_site_direct: 0,
      official_content: 0,
      official_channel: 0,
      non_official: 0,
      none: 0
    }
  );
  const highPriorityIssues = geoResults
    .filter((item) => getGeoIssueLevel(item) === "high" || getGeoIssueLevel(item) === "failed" || getGeoIssueLevel(item) === "pending_config")
    .slice(0, 4);
  const mediumPriorityIssues = geoResults.filter((item) => getGeoIssueLevel(item) === "medium").slice(0, 3);
  const flowSteps = useMemo(
    () => [
      {
        title: "1. 选测试类型",
        detail: `${geoTestCategoryLabels[testCategory]}：${geoTestCategoryDescriptions[testCategory]}`
      },
      {
        title: "2. 选测试矩阵",
        detail:
          testCategory === "baseline_fixed"
            ? `${platforms.length} 个平台 × ${promptGroups.length} 个固定问题组，下一次会覆盖 ${matrixSize} 个观察点。`
            : `${platforms.length} 个平台 × ${promptGroups.length} 个问题组 × ${activeDistilledTermIds.length} 个蒸馏词，下一次会覆盖 ${matrixSize} 个观察点。`
      },
      { title: "3. 读取回答侧信号", detail: "系统判断 JOTO、唯客、官网引用、竞品出现和引用 URL。" },
      { title: "4. 人工复核关键项", detail: "待复核结果进入详情页保留追溯记录，可人工修正判断字段。" },
      { title: "5. 沉淀补强动作", detail: "未命中或官网链路不足的主题进入博客候选池，再承接到周计划和周报。" }
    ],
    [activeDistilledTermIds.length, matrixSize, platforms.length, promptGroups.length, testCategory]
  );

  function handleChangeTestCategory(nextCategory: GeoTestCategory) {
    setTestCategory(nextCategory);

    if (nextCategory === "baseline_fixed") {
      setPromptGroups(baselinePromptGroups);
      setSelectedDistilledTermIds([]);
      return;
    }

    setPromptGroups(dynamicPromptGroups);
    setSelectedDistilledTermIds(distilledTermOptions.map((item) => item.id));
  }
  const hasActiveFilter = Boolean(
    platformFilter.length ||
      promptGroupFilter.length ||
      executionStatusFilter.length ||
      jotoMentionFilter.length ||
      citationLevelFilter.length ||
      dataConfidenceFilter.length
  );
  const filteredGeoResults = geoResults.filter((result) => {
    const platformMatched = !platformFilter.length || platformFilter.includes(result.platform);
    const promptGroupMatched = !promptGroupFilter.length || promptGroupFilter.includes(result.promptGroup);
    const executionStatusMatched = !executionStatusFilter.length || executionStatusFilter.includes(getExecutionStatus(result));
    const jotoMatched = !jotoMentionFilter.length || jotoMentionFilter.includes(result.mentionedJoto ? "yes" : "no");
    const officialCitationMatched = !citationLevelFilter.length || citationLevelFilter.includes(getCitationLevel(result));
    const dataConfidenceMatched = !dataConfidenceFilter.length || dataConfidenceFilter.includes(getDataConfidence(result));

    return platformMatched && promptGroupMatched && executionStatusMatched && jotoMatched && officialCitationMatched && dataConfidenceMatched;
  });
  const candidateByGeoResultId = new Map(
    blogArticles
      .filter((article) => article.url.startsWith("geo://result/"))
      .map((article) => [article.url.replace("geo://result/", ""), article])
  );
  const visibleConfigOrFailureCount = filteredGeoResults.filter((result) => {
    const nextStep = getGeoNextStep(result, candidateByGeoResultId.get(result.id));

    return nextStep === "configure_models" || nextStep === "inspect_failure";
  }).length;
  const visibleCandidateNeededCount = filteredGeoResults.filter((result) => {
    const nextStep = getGeoNextStep(result, candidateByGeoResultId.get(result.id));

    return nextStep === "add_candidate" || nextStep === "fix_citation";
  }).length;
  const visibleCandidatePoolCount = filteredGeoResults.filter((result) => {
    const nextStep = getGeoNextStep(result, candidateByGeoResultId.get(result.id));

    return nextStep === "candidate_pool" || nextStep === "planned";
  }).length;
  const visibleObserveCount = filteredGeoResults.filter((result) => getGeoNextStep(result, candidateByGeoResultId.get(result.id)) === "observe").length;

  function clearFilters() {
    setPlatformFilter([]);
    setPromptGroupFilter([]);
    setExecutionStatusFilter([]);
    setJotoMentionFilter([]);
    setCitationLevelFilter([]);
    setDataConfidenceFilter([]);
  }

  async function handleRunGeoTests() {
    setRunning(true);

    try {
      const result = await callJsonApi("/api/geo-tests/run", {
        method: "POST",
        body: JSON.stringify({
          platforms,
          promptGroups,
          distilledTermIds: activeDistilledTermIds,
          testCategory
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "GEO 测试已运行"));
    } catch (error) {
      messageApi.warning(error instanceof Error ? error.message : "GEO 测试缺少配置");
    } finally {
      setRunning(false);
    }
  }

  function openOverride(result: GeoTestResult) {
    setOverrideResult(result);
    setOverrideValues({
      mentionedJoto: result.mentionedJoto,
      mentionedWeike: result.mentionedWeike,
      citedOfficialUrl: result.citedOfficialUrl,
      competitorAppeared: Boolean(result.competitorAppeared)
    });
  }

  async function handleSaveOverride() {
    if (!overrideResult) {
      return;
    }

    setSavingOverride(true);

    try {
      const result = await callJsonApi(`/api/geo-test-results/${overrideResult.id}/override`, {
        method: "PATCH",
        body: JSON.stringify(overrideValues)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "GEO 判断已修正"));
      setOverrideResult(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "人工修正失败");
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleAddCandidate(resultId: string) {
    setAddingCandidateId(resultId);

    try {
      const result = await callJsonApi(`/api/geo-test-results/${resultId}/candidate`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "GEO 结果已加入博客候选池"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加入博客候选池失败");
    } finally {
      setAddingCandidateId(undefined);
    }
  }

  async function handleCreateTaskFromGeoGap(resultId: string) {
    setCreatingTaskId(resultId);

    try {
      const result = await callJsonApi(`/api/geo-test-results/${resultId}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "create_task" })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "GEO 问题缺口已加入周计划草稿"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加入周计划草稿失败");
    } finally {
      setCreatingTaskId(undefined);
    }
  }

  async function handleCreateKnowledgeBaseFromGeoGap(resultId: string) {
    setCreatingKnowledgeBaseId(resultId);

    try {
      const result = await callJsonApi(`/api/geo-test-results/${resultId}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "create_knowledge_base" })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "GEO 问题缺口已转为知识库补充资料"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "转为知识库补充资料失败");
    } finally {
      setCreatingKnowledgeBaseId(undefined);
    }
  }

  function renderGeoEntry(result: GeoTestResult) {
    const candidateArticle = candidateByGeoResultId.get(result.id);
    const nextStep = getGeoNextStep(result, candidateArticle);
    const candidateStatus = getGeoCandidateStatus(candidateArticle);
    const candidateLocked = candidateStatus === "candidate" || candidateStatus === "planned" || candidateStatus === "dismissed";
    const cannotAddCandidate = candidateLocked || getExecutionStatus(result) !== "success" || (result.mentionedJoto && result.citedOfficialUrl);

    if (nextStep === "configure_models") {
      return (
        <GovernanceEntry
          label="看 AI 配置"
          reason="GEO 模型配置属于工作台运营权限；内容增长人员只需要知道当前测试待配置。"
        />
      );
    }

    if (nextStep === "inspect_failure") {
      return (
        <Link href={`/geo-test/${result.id}`}>
          <Button size="small">看失败详情</Button>
        </Link>
      );
    }

    if (nextStep === "add_candidate") {
      return (
        <Space>
          <Popconfirm
            title="确认加入周计划草稿？"
            description="会把这个 GEO 问题缺口转为本周计划中的补强任务。"
            okText="加入"
            cancelText="取消"
            onConfirm={() => handleCreateTaskFromGeoGap(result.id)}
          >
            <Button size="small" type="primary" loading={creatingTaskId === result.id}>
              转周计划
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认加入博客候选池？"
            description="会把这个 GEO 未命中或官网链路不足的主题沉淀到博客候选池。"
            okText="加入"
            cancelText="取消"
            onConfirm={() => handleAddCandidate(result.id)}
          >
            <Button size="small" loading={addingCandidateId === result.id} disabled={cannotAddCandidate}>
              入候选池
            </Button>
          </Popconfirm>
          <Button size="small" loading={creatingKnowledgeBaseId === result.id} onClick={() => handleCreateKnowledgeBaseFromGeoGap(result.id)}>
            补知识库
          </Button>
        </Space>
      );
    }

    if (nextStep === "fix_citation") {
      return (
        <Space>
          <Button size="small" type="primary" loading={creatingKnowledgeBaseId === result.id} onClick={() => handleCreateKnowledgeBaseFromGeoGap(result.id)}>
            补知识库
          </Button>
          <Popconfirm
            title="确认加入周计划草稿？"
            description="会把官网引用不足的问题转为内容补强任务。"
            okText="加入"
            cancelText="取消"
            onConfirm={() => handleCreateTaskFromGeoGap(result.id)}
          >
            <Button size="small" loading={creatingTaskId === result.id}>
              转周计划
            </Button>
          </Popconfirm>
        </Space>
      );
    }

    if (nextStep === "candidate_pool") {
      return (
        <Link href="/blog-candidates">
          <Button size="small">去候选池</Button>
        </Link>
      );
    }

    if (nextStep === "planned") {
      return (
        <Link href="/weekly-plan">
          <Button size="small">看周计划</Button>
        </Link>
      );
    }

    return (
      <Link href="/weekly-report">
        <Button size="small">{nextStep === "dismissed" ? "去周报复盘" : "继续观察"}</Button>
      </Link>
    );
  }

  function renderGeoMaintenance(record: GeoTestResult) {
    return (
      <Space>
        <Link href={`/geo-test/${record.id}`}>
          <Button size="small">看详情</Button>
        </Link>
        <Button size="small" onClick={() => openOverride(record)}>
          人工修正
        </Button>
      </Space>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="GEO 测试"
        subtitle="把 AI 回答里的品牌提及、产品提及、官网引用和竞品占位翻译成内容补强动作。"
        actions={
          <Popconfirm
            title="确认批量运行 GEO 测试？"
            description={`会根据当前平台、问题组和蒸馏词创建 ${matrixSize} 条新的测试记录。`}
            okText="运行"
            cancelText="取消"
            onConfirm={handleRunGeoTests}
          >
            <Button type="primary" loading={running}>
              批量运行测试
            </Button>
          </Popconfirm>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="AI 提到我们" value={geoHitRate} suffix="%" />
        <MetricCard title="产品被正确提到" value={productMentionRate} suffix="%" />
        <MetricCard title="官网被直接引用" value={officialDirectRate} suffix="%" />
        <MetricCard title="问题缺口" value={contentGapCount} suffix="条" />
        <MetricCard title="竞品占位" value={competitorAppearedTotal} suffix="条" />
      </div>
      <div className="two-column" style={{ marginBottom: 16 }}>
        <Card title="测试范围">
          <Alert
            showIcon
            type={matrixSize ? "info" : "warning"}
            style={{ marginBottom: 16 }}
            message={
              testCategory === "baseline_fixed"
                ? `当前测试矩阵：${platforms.length} 个平台 × ${promptGroups.length} 个固定问题组 = ${matrixSize} 个观察点`
                : `当前测试矩阵：${platforms.length} 个平台 × ${promptGroups.length} 个问题组 × ${activeDistilledTermIds.length} 个蒸馏词 = ${matrixSize} 个观察点`
            }
            description={geoTestCategoryDescriptions[testCategory]}
          />
          <Space direction="vertical" style={{ width: "100%" }}>
            <div>
              <p className="panel-title">测试类型</p>
              <Segmented
                value={testCategory}
                onChange={(value) => handleChangeTestCategory(value as GeoTestCategory)}
                options={[
                  { label: "基线固定问题组 20%", value: "baseline_fixed" },
                  { label: "动态蒸馏词探索 80%", value: "dynamic_exploration" }
                ]}
              />
            </div>
            <Alert
              showIcon
              type="info"
              message="GEO 测试拆成 2:8 两类"
              description="基线固定问题组负责稳定对比；动态蒸馏词探索负责发现新缺口。真实运行时优先少量多次提交，避免一次性大矩阵超时。"
            />
            <div>
              <p className="panel-title">平台</p>
              <Checkbox.Group options={geoPlatforms} value={platforms} onChange={(value) => setPlatforms(value as GeoTestResult["platform"][])} />
            </div>
            <div>
              <p className="panel-title">问题组</p>
              <Space wrap>
                <Checkbox.Group options={geoPromptGroups} value={promptGroups} onChange={(value) => setPromptGroups(value as GeoTestResult["promptGroup"][])} />
                <Button onClick={() => setPromptDrawerOpen(true)}>查看问题组</Button>
              </Space>
            </div>
            <div>
              <p className="panel-title">{testCategory === "baseline_fixed" ? "蒸馏词探索关闭" : "蒸馏词默认全选"}</p>
              <Checkbox.Group
                options={distilledTermOptions.map((item) => ({ label: item.label, value: item.id }))}
                value={activeDistilledTermIds}
                disabled={testCategory === "baseline_fixed"}
                onChange={(value) => setSelectedDistilledTermIds(value.map(String))}
              />
            </div>
          </Space>
        </Card>
        <Card title="测试频率与自动化">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert
              showIcon
              type="info"
              message={`系统建议频率：${frequencySuggestion.label}`}
              description={frequencySuggestion.reason}
            />
            <Checkbox checked={automationEnabled} onChange={(event) => setAutomationEnabled(event.target.checked)}>
              启用本地定时提醒
            </Checkbox>
            <Table
              rowKey="label"
              size="small"
              pagination={false}
              dataSource={[
                { label: "本周发布量", value: `${weeklyPublishCount} 篇` },
                { label: "上次测试", value: latestTestedAt || "-" },
                { label: "建议下次测试", value: addDaysToDateTime(latestTestedAt, frequencySuggestion.days) },
                { label: "额外触发", value: "官网上新、产品页改版、新蒸馏词矩阵、重要活动周" }
              ]}
              columns={[
                { title: "项目", dataIndex: "label" },
                { title: "当前值", dataIndex: "value" }
              ]}
            />
            <Alert
              showIcon
              type={logSupportStatus === "missing" ? "info" : "success"}
              message={
                logSupportStatus === "ready"
                  ? `AI Bot 日志已就绪，当前 PV ${botPv}。`
                  : logSupportStatus === "uploaded"
                    ? `已导入本地日志文件，当前 PV ${botPv}。`
                    : "当前没有远程日志证据。GEO 先按回答侧测试推进。"
              }
            />
          </Space>
        </Card>
      </div>
      <Card title="诊断摘要" style={{ marginBottom: 16 }}>
        <Alert
          showIcon
          type={highPriorityIssues.length ? "warning" : mediumPriorityIssues.length ? "info" : "success"}
          message={`高优先级问题 ${highPriorityIssues.length} 条，中优先级问题 ${mediumPriorityIssues.length} 条，待人工复核 ${reviewNeededTotal} 条`}
          description={`引用层级分布：官网直引 ${citationLevelCounts.official_site_direct}，官方内容 ${citationLevelCounts.official_content}，官方渠道 ${citationLevelCounts.official_channel}，非官方 ${citationLevelCounts.non_official}，无引用 ${citationLevelCounts.none}。`}
          style={{ marginBottom: 16 }}
        />
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={[...highPriorityIssues, ...mediumPriorityIssues]}
          locale={{
            emptyText: "当前没有高风险 GEO 问题，继续观察官网直引率和竞品占位。"
          }}
          columns={[
            { title: "级别", render: (_, record) => {
              const issueLevel = getGeoIssueLevel(record);

              return <Tag color={geoIssueLevelColors[issueLevel]}>{geoIssueLevelLabels[issueLevel]}</Tag>;
            } },
            { title: "平台", dataIndex: "platform" },
            { title: "问题组", dataIndex: "promptGroup" },
            { title: "问题类型", render: (_, record) => record.issueType || "待判断" },
            { title: "建议动作", render: (_, record) => record.suggestedAction || getGeoActionText(record, candidateByGeoResultId.get(record.id)) },
            {
              title: "入口",
              render: (_, record) => renderGeoEntry(record)
            }
          ]}
        />
      </Card>
      <div className="two-column" style={{ marginBottom: 16 }}>
        <Card title="执行流程">
          <Table
            rowKey="title"
            size="small"
            pagination={false}
            dataSource={flowSteps}
            columns={[
              { title: "步骤", dataIndex: "title" },
              { title: "当前说明", dataIndex: "detail" }
            ]}
          />
        </Card>
        <Card title="引用层级说明">
          <Space wrap>
            {Object.entries(citationLevelLabels).map(([value, label]) => (
              <Tag key={value} color={citationLevelColors[value as GeoCitationLevel]}>
                {label} {citationLevelCounts[value as GeoCitationLevel]}
              </Tag>
            ))}
          </Space>
          <p className="muted" style={{ marginTop: 12 }}>
            GEO 只记录回答侧可观察引用结果，不假装知道模型内部真实引用路径。
          </p>
        </Card>
      </div>
      <Card title="GEO / AI 可见度结果">
        <Alert
          showIcon
          type={visibleConfigOrFailureCount || visibleCandidateNeededCount ? "info" : "success"}
          message={`GEO 结果共 ${filteredGeoResults.length} 条，待配置/排查 ${visibleConfigOrFailureCount} 条，建议入候选池 ${visibleCandidateNeededCount} 条`}
          description={`已沉淀候选 ${visibleCandidatePoolCount} 条，可继续观察 ${visibleObserveCount} 条。`}
          style={{ marginBottom: 16 }}
        />
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按平台筛选"
            value={platformFilter}
            onChange={(value) => setPlatformFilter(value)}
            options={geoPlatforms.map((value) => ({ value, label: value }))}
            style={{ minWidth: 180 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按问题组筛选"
            value={promptGroupFilter}
            onChange={(value) => setPromptGroupFilter(value)}
            options={Object.entries(promptGroupLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按执行状态筛选"
            value={executionStatusFilter}
            onChange={(value) => setExecutionStatusFilter(value)}
            options={Object.entries(executionStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按 JOTO 提及筛选"
            value={jotoMentionFilter}
            onChange={(value) => setJotoMentionFilter(value)}
            options={Object.entries(booleanFilterLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按引用层级筛选"
            value={citationLevelFilter}
            onChange={(value) => setCitationLevelFilter(value)}
            options={Object.entries(citationLevelLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按数据来源筛选"
            value={dataConfidenceFilter}
            onChange={(value) => setDataConfidenceFilter(value)}
            options={Object.entries(confidenceLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredGeoResults}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有 GEO 测试结果" : "还没有 GEO 测试结果"}
                description={hasActiveFilter ? "清空筛选或调整平台、状态、提及和引用条件后再查看。" : "选择平台和问题组后运行测试；缺少模型配置时会保留待配置状态，不生成假结果。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Popconfirm
                      title="确认批量运行 GEO 测试？"
                      description={`会根据当前平台、问题组和蒸馏词创建 ${matrixSize} 条新的测试记录。`}
                      okText="运行"
                      cancelText="取消"
                      onConfirm={handleRunGeoTests}
                    >
                      <Button type="primary" loading={running}>
                        批量运行测试
                      </Button>
                    </Popconfirm>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "平台", dataIndex: "platform" },
            { title: "问题组", dataIndex: "promptGroup" },
            {
              title: "蒸馏词",
              render: (_, record) => {
                const termLabels = (record.distilledTermIds?.length ? record.distilledTermIds : selectedDistilledTermIds)
                  .map((id) => distilledTermOptions.find((item) => item.id === id)?.label)
                  .filter(Boolean);

                return termLabels.length ? (
                  <Space wrap size={[4, 4]}>
                    {termLabels.map((label) => (
                      <Tag key={label}>{label}</Tag>
                    ))}
                  </Space>
                ) : (
                  "-"
                );
              }
            },
            { title: "执行状态", render: (_, record) => <Tag color={executionStatusColors[getExecutionStatus(record)]}>{executionStatusLabels[getExecutionStatus(record)]}</Tag> },
            {
              title: "AI 是否提到我们",
              render: (_, record) => <Tag color={record.mentionedJoto ? "green" : "red"}>{getBrandVisibilityLabel(record)}</Tag>
            },
            {
              title: "产品是否正确提到",
              render: (_, record) => <Tag color={record.mentionedWeike ? "green" : record.promptGroup === "产品场景" ? "red" : "default"}>{getProductVisibilityLabel(record)}</Tag>
            },
            {
              title: "官网是否被引用",
              render: (_, record) => {
                const level = getCitationLevel(record);

                return <Tag color={citationLevelColors[level]}>{getOfficialSourceLabel(record)}</Tag>;
              }
            },
            { title: "竞品是否占位", dataIndex: "competitorAppeared", render: (value) => <Tag color={value ? "gold" : "green"}>{value ? "竞品出现" : "未明显占位"}</Tag> },
            {
              title: "问题缺口",
              render: (_, record) => {
                const issueLevel = getGeoIssueLevel(record);

                return <Tag color={geoIssueLevelColors[issueLevel]}>{geoIssueLevelLabels[issueLevel]}</Tag>;
              }
            },
            {
              title: "候选状态",
              render: (_, record) => {
                const candidateStatus = getGeoCandidateStatus(candidateByGeoResultId.get(record.id));

                return <Tag color={geoCandidateStatusColors[candidateStatus]}>{geoCandidateStatusLabels[candidateStatus]}</Tag>;
              }
            },
            {
              title: "建议原因",
              render: (_, record) => getGeoSuggestionReason(record, candidateByGeoResultId.get(record.id))
            },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getGeoNextStep(record, candidateByGeoResultId.get(record.id));

                return <Tag color={geoNextStepColors[nextStep]}>{geoNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "处理动作",
              render: (_, record) => getGeoActionText(record, candidateByGeoResultId.get(record.id))
            },
            {
              title: "可执行入口",
              render: (_, record) => renderGeoEntry(record)
            },
            {
              title: "详情",
              render: (_, record) => renderGeoMaintenance(record)
            }
          ]}
        />
      </Card>
      <Modal
        title="人工修正 GEO 判断"
        open={Boolean(overrideResult)}
        confirmLoading={savingOverride}
        onOk={undefined}
        onCancel={() => setOverrideResult(undefined)}
        footer={[
          <Button key="cancel" onClick={() => setOverrideResult(undefined)}>
            取消
          </Button>,
          <Popconfirm
            key="confirm"
            title="确认保存人工修正？"
            description="修正会覆盖判断字段，但不会覆盖详情页中的原始记录。"
            okText="保存"
            cancelText="返回"
            onConfirm={handleSaveOverride}
          >
            <Button type="primary" loading={savingOverride}>
              保存修正
            </Button>
          </Popconfirm>
        ]}
      >
        <Space direction="vertical">
          <Checkbox
            checked={overrideValues.mentionedJoto}
            onChange={(event) => setOverrideValues((value) => ({ ...value, mentionedJoto: event.target.checked }))}
          >
            提及 JOTO
          </Checkbox>
          <Checkbox
            checked={overrideValues.mentionedWeike}
            onChange={(event) => setOverrideValues((value) => ({ ...value, mentionedWeike: event.target.checked }))}
          >
            提及唯客
          </Checkbox>
          <Checkbox
            checked={overrideValues.citedOfficialUrl}
            onChange={(event) => setOverrideValues((value) => ({ ...value, citedOfficialUrl: event.target.checked }))}
          >
            引用官网链接
          </Checkbox>
          <Checkbox
            checked={overrideValues.competitorAppeared}
            onChange={(event) => setOverrideValues((value) => ({ ...value, competitorAppeared: event.target.checked }))}
          >
            回答中出现竞品
          </Checkbox>
        </Space>
      </Modal>
      <Drawer title="问题组" open={promptDrawerOpen} width={560} onClose={() => setPromptDrawerOpen(false)}>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            showIcon
            type="info"
            message="问题组决定测试问题方向，蒸馏词决定测哪个认知节点。"
            description="在这里查看问题方向并调整本次测试内容。"
          />
          {geoPromptGroups.map((group) => {
            const config = promptGroupDescriptions[group];

            return (
              <Card key={group} size="small" title={group} extra={<Tag color={config.enabled ? "green" : "default"}>{config.enabled ? "启用" : "停用"}</Tag>}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <div>
                    <p className="panel-title">问题列表</p>
                    {config.prompts.map((prompt) => (
                      <Input key={prompt} defaultValue={prompt} style={{ marginBottom: 8 }} />
                    ))}
                  </div>
                  <div>
                    <p className="panel-title">推荐蒸馏词</p>
                    <Space wrap>
                      {config.recommendedTerms.map((term) => (
                        <Tag key={term}>{term}</Tag>
                      ))}
                    </Space>
                  </div>
                  <Space>
                    <Button size="small">保存修改</Button>
                    <Button size="small">{config.enabled ? "停用" : "启用"}</Button>
                  </Space>
                </Space>
              </Card>
            );
          })}
        </Space>
      </Drawer>
    </>
  );
}
