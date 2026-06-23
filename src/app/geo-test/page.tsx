"use client";

import { Alert, Button, Card, Checkbox, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
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

const promptGroupLabels: Record<GeoTestResult["promptGroup"], string> = {
  品牌认知: "品牌认知",
  产品场景: "产品场景",
  对比: "对比",
  FAQ: "FAQ"
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
    return "模型配置未就绪，先在 AI 配置页补齐 Provider 后再判断结果。";
  }

  if (executionStatus === "failed") {
    return result.errorMessage || "GEO 测试执行失败，先查看快照和错误信息。";
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
    return "先补齐模型配置，再重新运行当前平台和 Prompt 组的 GEO 测试。";
  }

  if (nextStep === "inspect_failure") {
    return "先查看回答快照和错误信息，确认失败原因后再重跑或人工修正。";
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

export default function GeoTestPage() {
  const {
    state: { geoResults, blogArticles, botVisits },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [running, setRunning] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [addingCandidateId, setAddingCandidateId] = useState<string>();
  const [platforms, setPlatforms] = useState<GeoTestResult["platform"][]>(["DeepSeek", "豆包", "通义千问"]);
  const [promptGroups, setPromptGroups] = useState<GeoTestResult["promptGroup"][]>(["品牌认知", "产品场景"]);
  const [snapshotResult, setSnapshotResult] = useState<GeoTestResult>();
  const [overrideResult, setOverrideResult] = useState<GeoTestResult>();
  const [platformFilter, setPlatformFilter] = useState<GeoTestResult["platform"][]>([]);
  const [promptGroupFilter, setPromptGroupFilter] = useState<GeoTestResult["promptGroup"][]>([]);
  const [executionStatusFilter, setExecutionStatusFilter] = useState<GeoExecutionStatus[]>([]);
  const [jotoMentionFilter, setJotoMentionFilter] = useState<BooleanFilter[]>([]);
  const [officialCitationFilter, setOfficialCitationFilter] = useState<BooleanFilter[]>([]);
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
  const matrixSize = platforms.length * promptGroups.length;
  const geoHitRate = geoResults.length ? Math.round((geoResults.filter((item) => item.mentionedJoto).length / geoResults.length) * 100) : 0;
  const officialCitationRate = geoResults.length ? Math.round((geoResults.filter((item) => item.citedOfficialUrl).length / geoResults.length) * 100) : 0;
  const reviewNeededTotal = geoResults.filter((item) => getReviewStatus(item) === "manual_review_needed").length;
  const competitorAppearedTotal = geoResults.filter((item) => item.competitorAppeared).length;
  const flowSteps = useMemo(
    () => [
      { title: "1. 选测试矩阵", detail: `${platforms.length} 个平台 × ${promptGroups.length} 个 Prompt 组，下一次会生成 ${matrixSize} 条测试。` },
      { title: "2. 读取回答侧信号", detail: "系统判断 JOTO、唯客、官网引用、竞品出现和引用 URL。" },
      { title: "3. 人工复核关键项", detail: "待复核结果保留回答快照，可人工修正判断字段。" },
      { title: "4. 沉淀补强动作", detail: "未命中或官网链路不足的主题进入博客候选池，再承接到周计划和周报。" }
    ],
    [matrixSize, platforms.length, promptGroups.length]
  );
  const hasActiveFilter = Boolean(
    platformFilter.length ||
      promptGroupFilter.length ||
      executionStatusFilter.length ||
      jotoMentionFilter.length ||
      officialCitationFilter.length ||
      dataConfidenceFilter.length
  );
  const filteredGeoResults = geoResults.filter((result) => {
    const platformMatched = !platformFilter.length || platformFilter.includes(result.platform);
    const promptGroupMatched = !promptGroupFilter.length || promptGroupFilter.includes(result.promptGroup);
    const executionStatusMatched = !executionStatusFilter.length || executionStatusFilter.includes(getExecutionStatus(result));
    const jotoMatched = !jotoMentionFilter.length || jotoMentionFilter.includes(result.mentionedJoto ? "yes" : "no");
    const officialCitationMatched = !officialCitationFilter.length || officialCitationFilter.includes(result.citedOfficialUrl ? "yes" : "no");
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
    setOfficialCitationFilter([]);
    setDataConfidenceFilter([]);
  }

  async function handleRunGeoTests() {
    setRunning(true);

    try {
      const result = await callJsonApi("/api/geo-tests/run", {
        method: "POST",
        body: JSON.stringify({
          platforms,
          promptGroups
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

  function renderGeoEntry(result: GeoTestResult) {
    const candidateArticle = candidateByGeoResultId.get(result.id);
    const nextStep = getGeoNextStep(result, candidateArticle);
    const candidateStatus = getGeoCandidateStatus(candidateArticle);
    const candidateLocked = candidateStatus === "candidate" || candidateStatus === "planned" || candidateStatus === "dismissed";
    const cannotAddCandidate = candidateLocked || getExecutionStatus(result) !== "success" || (result.mentionedJoto && result.citedOfficialUrl);

    if (nextStep === "configure_models") {
      return (
        <Link href="/ai-config">
          <Button size="small">看 AI 配置</Button>
        </Link>
      );
    }

    if (nextStep === "inspect_failure") {
      return (
        <Button size="small" onClick={() => setSnapshotResult(result)}>
          看失败快照
        </Button>
      );
    }

    if (nextStep === "add_candidate") {
      return (
        <Popconfirm
          title="确认加入博客候选池？"
          description="会把这个 GEO 未命中或官网链路不足的主题沉淀到博客候选池。"
          okText="加入"
          cancelText="取消"
          onConfirm={() => handleAddCandidate(result.id)}
        >
          <Button size="small" type="primary" loading={addingCandidateId === result.id} disabled={cannotAddCandidate}>
            入候选池
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "fix_citation" || nextStep === "candidate_pool") {
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
        <Button size="small" onClick={() => setSnapshotResult(record)}>
          查看快照
        </Button>
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
        subtitle="通过 DeepSeek、豆包、通义千问批量测试回答侧信号，判断品牌提及、官网引用、竞品占位和后续补强动作。"
        actions={
          <Popconfirm
            title="确认批量运行 GEO 测试？"
            description={`会根据当前平台和 Prompt 组创建 ${matrixSize} 条新的测试记录。`}
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
      <div className="metric-grid">
        <MetricCard title="GEO 命中率" value={geoHitRate} suffix="%" />
        <MetricCard title="官网引用率" value={officialCitationRate} suffix="%" />
        <MetricCard title="待人工复核" value={reviewNeededTotal} suffix="条" />
        <MetricCard title="竞品出现" value={competitorAppearedTotal} suffix="条" />
      </div>
      <div className="two-column" style={{ marginBottom: 16 }}>
        <Card title="流程结构">
          <Alert
            showIcon
            type={logSupportStatus === "missing" ? "info" : "success"}
            style={{ marginBottom: 16 }}
            message={
              logSupportStatus === "ready"
                ? `AI Bot 日志已就绪，当前共 ${botVisits.length} 条汇总，PV ${botPv}。`
                : logSupportStatus === "uploaded"
                  ? `已导入本地日志文件，当前共 ${botVisits.length} 条汇总，PV ${botPv}。`
                  : "当前没有远程日志证据。GEO 仍可继续跑，日志只影响 AI Bot 到访证明，不阻塞回答侧测试。"
            }
            description={
              logSupportStatus === "missing"
                ? "最短路径是先做回答侧 GEO 测试；后续如果你能从浏览器导出 CDN 日志，再去博客监控页上传补证据。"
                : "日志证据会增强可信度，但页面上的品牌提及、官网引用和补强动作仍以模型回答侧结果为主。"
            }
          />
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
        <Card title="测试配置">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert
              showIcon
              type={matrixSize ? "info" : "warning"}
              message={`当前测试矩阵：${platforms.length} 个平台 × ${promptGroups.length} 个 Prompt 组 = ${matrixSize} 条`}
              description="现在会按矩阵逐条执行，不再只跑第一个 Prompt 组。"
            />
            <Checkbox.Group options={geoPlatforms} value={platforms} onChange={(value) => setPlatforms(value as GeoTestResult["platform"][])} />
            <Checkbox.Group options={geoPromptGroups} value={promptGroups} onChange={(value) => setPromptGroups(value as GeoTestResult["promptGroup"][])} />
          </Space>
        </Card>
      </div>
      <Card title="测试结果">
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
            placeholder="按 Prompt 组筛选"
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
            placeholder="按官网引用筛选"
            value={officialCitationFilter}
            onChange={(value) => setOfficialCitationFilter(value)}
            options={Object.entries(booleanFilterLabels).map(([value, label]) => ({ value, label }))}
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
                description={hasActiveFilter ? "清空筛选或调整平台、状态、提及和引用条件后再查看。" : "选择平台和 Prompt 组后运行测试；缺少模型配置时会保留 pending_config，不生成假结果。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Popconfirm
                      title="确认批量运行 GEO 测试？"
                      description={`会根据当前平台和 Prompt 组创建 ${matrixSize} 条新的测试记录。`}
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
            { title: "Prompt 组", dataIndex: "promptGroup" },
            { title: "执行状态", render: (_, record) => <Tag color={executionStatusColors[getExecutionStatus(record)]}>{executionStatusLabels[getExecutionStatus(record)]}</Tag> },
            { title: "Prompt", dataIndex: "prompt" },
            {
              title: "问题级别",
              render: (_, record) => {
                const issueLevel = getGeoIssueLevel(record);

                return <Tag color={geoIssueLevelColors[issueLevel]}>{geoIssueLevelLabels[issueLevel]}</Tag>;
              }
            },
            { title: "提及 JOTO", dataIndex: "mentionedJoto", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "是" : "否"}</Tag> },
            { title: "提及唯客", dataIndex: "mentionedWeike", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "是" : "否"}</Tag> },
            { title: "引用官网", dataIndex: "citedOfficialUrl", render: (value) => <Tag color={value ? "green" : "gold"}>{value ? "是" : "否"}</Tag> },
            { title: "竞品出现", dataIndex: "competitorAppeared", render: (value) => <Tag color={value ? "gold" : "green"}>{value ? "是" : "否"}</Tag> },
            {
              title: "引用 URL",
              dataIndex: "citedUrls",
              render: (value?: string[]) => (value?.length ? <span className="mono">{value.join("、")}</span> : "-")
            },
            {
              title: "准确性",
              render: (_, record) => {
                const status = getAccuracyStatus(record);

                return <Tag color={accuracyStatusColors[status]}>{accuracyStatusLabels[status]}</Tag>;
              }
            },
            {
              title: "复核状态",
              render: (_, record) => {
                const status = getReviewStatus(record);

                return <Tag color={reviewStatusColors[status]}>{reviewStatusLabels[status]}</Tag>;
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
            { title: "判断来源", dataIndex: "manualOverride", render: (value) => <Tag color={value ? "blue" : "default"}>{value ? "人工修正" : "自动判断"}</Tag> },
            { title: "数据来源", render: (_, record) => <DataConfidenceTag value={getDataConfidence(record)} /> },
            {
              title: "维护",
              render: (_, record) => renderGeoMaintenance(record)
            }
          ]}
        />
      </Card>
      <Modal title="回答快照" open={Boolean(snapshotResult)} footer={null} onCancel={() => setSnapshotResult(undefined)}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Tag>{snapshotResult?.platform}</Tag>
          <Space wrap>
            <Tag>{snapshotResult?.promptGroup}</Tag>
            <Tag color={accuracyStatusColors[getAccuracyStatus(snapshotResult || ({} as GeoTestResult))]}>
              {accuracyStatusLabels[getAccuracyStatus(snapshotResult || ({} as GeoTestResult))]}
            </Tag>
            <Tag color={reviewStatusColors[getReviewStatus(snapshotResult || ({} as GeoTestResult))]}>
              {reviewStatusLabels[getReviewStatus(snapshotResult || ({} as GeoTestResult))]}
            </Tag>
          </Space>
          {snapshotResult?.citedUrls?.length ? <span className="mono">{snapshotResult.citedUrls.join("、")}</span> : null}
          <p className="mono" style={{ whiteSpace: "pre-wrap" }}>
            {snapshotResult?.answerSnapshot || "暂无回答快照"}
          </p>
          {snapshotResult?.errorMessage ? <Tag color="red">{snapshotResult.errorMessage}</Tag> : null}
        </Space>
      </Modal>
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
            description="修正会覆盖判断字段，但不会覆盖原始回答快照。"
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
    </>
  );
}
