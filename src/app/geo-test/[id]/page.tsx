"use client";

import { Alert, Button, Card, Descriptions, List, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { GovernanceEntry } from "@/components/GovernanceEntry";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { confidenceColors, confidenceLabels } from "@/lib/labels";
import type { BlogArticle, DataConfidence, GeoTestResult } from "@/lib/types";

type GeoExecutionStatus = NonNullable<GeoTestResult["executionStatus"]>;
type GeoCitationLevel = NonNullable<GeoTestResult["citationLevel"]>;
type GeoAccuracyStatus = NonNullable<GeoTestResult["accuracyStatus"]>;
type GeoReviewStatus = NonNullable<GeoTestResult["reviewStatus"]>;
type GeoIssueLevel = "pending_config" | "failed" | "high" | "medium" | "healthy";
type GeoNextStep = "configure_models" | "inspect_failure" | "add_candidate" | "fix_citation" | "candidate_pool" | "planned" | "dismissed" | "observe";
type GeoCandidateStatusView = NonNullable<BlogArticle["candidateStatus"]>;

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

const citationLevelLabels: Record<GeoCitationLevel, string> = {
  official_site_direct: "官网被直接引用",
  official_content: "官网内容被引用",
  official_channel: "官方渠道被引用",
  non_official: "非官方来源",
  none: "未形成引用"
};

const citationLevelColors: Record<GeoCitationLevel, string> = {
  official_site_direct: "green",
  official_content: "cyan",
  official_channel: "blue",
  non_official: "orange",
  none: "red"
};

const accuracyStatusLabels: Record<GeoAccuracyStatus, string> = {
  accurate: "判断可信",
  needs_review: "需要复核",
  inaccurate: "判断不准"
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

const geoIssueLevelLabels: Record<GeoIssueLevel, string> = {
  pending_config: "待配置",
  failed: "失败",
  high: "高优先级",
  medium: "中优先级",
  healthy: "正常观察"
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
  add_candidate: "补内容缺口",
  fix_citation: "补官网证据",
  candidate_pool: "候选池处理",
  planned: "已进入计划",
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
  candidate: "已入候选池",
  planned: "已规划",
  dismissed: "暂不处理"
};

const geoCandidateStatusColors: Record<GeoCandidateStatusView, string> = {
  none: "default",
  candidate: "blue",
  planned: "green",
  dismissed: "default"
};

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

function getAccuracyStatus(result: GeoTestResult): GeoAccuracyStatus {
  return result.accuracyStatus || (result.mentionedJoto && result.citedOfficialUrl ? "accurate" : "needs_review");
}

function getReviewStatus(result: GeoTestResult): GeoReviewStatus {
  return result.reviewStatus || (result.manualOverride ? "manual_confirmed" : getAccuracyStatus(result) === "accurate" ? "auto_checked" : "manual_review_needed");
}

function getGeoCandidateStatus(article?: BlogArticle): GeoCandidateStatusView {
  return article?.candidateStatus || "none";
}

function getGeoIssueLevel(result: GeoTestResult): GeoIssueLevel {
  const executionStatus = getExecutionStatus(result);

  if (executionStatus === "pending_config") return "pending_config";
  if (executionStatus === "failed") return "failed";
  if (!result.mentionedJoto) return "high";
  if (!result.citedOfficialUrl) return "medium";
  return "healthy";
}

function getGeoNextStep(result: GeoTestResult, candidateArticle?: BlogArticle): GeoNextStep {
  const executionStatus = getExecutionStatus(result);
  const candidateStatus = getGeoCandidateStatus(candidateArticle);

  if (executionStatus === "pending_config") return "configure_models";
  if (executionStatus === "failed") return "inspect_failure";
  if (candidateStatus === "planned") return "planned";
  if (candidateStatus === "dismissed") return "dismissed";
  if (candidateStatus === "candidate") return "candidate_pool";
  if (!result.mentionedJoto) return "add_candidate";
  if (!result.citedOfficialUrl) return "fix_citation";
  return "observe";
}

function getGeoBusinessConclusion(result: GeoTestResult) {
  const executionStatus = getExecutionStatus(result);

  if (executionStatus === "pending_config") {
    return "当前测试缺少模型配置，先补齐模型接入设置后再判断 GEO 效果。";
  }

  if (executionStatus === "failed") {
    return result.errorMessage || "当前 GEO 测试执行失败，需要先排查失败原因。";
  }

  if (!result.mentionedJoto) {
    return "AI 回答没有提到 JOTO，说明这个问题下品牌认知入口不足。";
  }

  if (!result.citedOfficialUrl) {
    return "AI 已提到我们，但没有引用官网，需要补强官网事实链路。";
  }

  if (result.competitorAppeared) {
    return "品牌和官网链路已命中，但回答中仍有竞品占位，需要持续观察。";
  }

  return "品牌、产品和官网引用链路表现稳定，当前优先级较低。";
}

function getGeoActionText(result: GeoTestResult, candidateArticle?: BlogArticle) {
  const nextStep = getGeoNextStep(result, candidateArticle);

  if (nextStep === "configure_models") return "联系工作台运营补齐模型配置，再重新运行当前平台和问题组。";
  if (nextStep === "inspect_failure") return "先查看错误信息和回答快照，确认失败原因后再重跑。";
  if (nextStep === "add_candidate") return "把这个问题缺口转为内容补强任务，优先进入周计划草稿或博客候选池。";
  if (nextStep === "fix_citation") return "补充知识库或官网内容证据，让后续正文和官网引用更容易承接。";
  if (nextStep === "candidate_pool") return "主题已经进入候选池，下一步去候选池判断是否规划。";
  if (nextStep === "planned") return "补强主题已进入周计划，下一步跟踪发布和回传数据。";
  if (nextStep === "dismissed") return "当前已标记暂不处理，后续在周报或新一轮 GEO 测试里复看。";
  return "当前没有新的处置动作，继续观察下一轮测试结果。";
}

export default function GeoTestDetailPage({ params }: { params: { id: string } }) {
  const {
    state: { geoResults, blogArticles },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingKnowledgeBase, setCreatingKnowledgeBase] = useState(false);
  const [exporting, setExporting] = useState(false);
  const result = geoResults.find((item) => item.id === params.id);
  const candidateArticle = blogArticles.find((article) => article.url === `geo://result/${params.id}`);

  async function handleAddCandidate() {
    if (!result) return;

    setAddingCandidate(true);

    try {
      const apiResult = await callJsonApi(`/api/geo-test-results/${result.id}/candidate`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(apiResult, "GEO 结果已加入博客候选池"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加入博客候选池失败");
    } finally {
      setAddingCandidate(false);
    }
  }

  async function handleCreateTaskFromGeoGap() {
    if (!result) return;

    setCreatingTask(true);

    try {
      const apiResult = await callJsonApi(`/api/geo-test-results/${result.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "create_task" })
      });
      await refresh();
      messageApi.success(formatApiMessage(apiResult, "GEO 问题缺口已加入周计划草稿"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加入周计划草稿失败");
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleCreateKnowledgeBaseFromGeoGap() {
    if (!result) return;

    setCreatingKnowledgeBase(true);

    try {
      const apiResult = await callJsonApi(`/api/geo-test-results/${result.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "create_knowledge_base" })
      });
      await refresh();
      messageApi.success(formatApiMessage(apiResult, "GEO 问题缺口已转为知识库补充资料"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "转为知识库补充资料失败");
    } finally {
      setCreatingKnowledgeBase(false);
    }
  }

  async function handleExportGeoBusinessDetail() {
    if (!result) return;

    setExporting(true);

    try {
      const apiResult = await callJsonApi<{ message?: string; data?: { markdown?: string } }>(`/api/geo-test-results/${result.id}/export`, { method: "GET" });
      await navigator.clipboard.writeText(apiResult.data?.markdown || "");
      messageApi.success(formatApiMessage(apiResult, "GEO 业务详情已复制"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "GEO 业务详情导出失败");
    } finally {
      setExporting(false);
    }
  }

  if (!result && !loading) {
    return (
      <>
        <PageHeader
          title="GEO 详情"
          subtitle="未找到这条 GEO 测试记录。"
          actions={
            <Link href="/geo-test">
              <Button>返回 GEO 测试</Button>
            </Link>
          }
        />
        <ActionEmpty title="GEO 测试记录不存在" description="可能已经被清理，或当前本地状态尚未同步。" />
      </>
    );
  }

  const executionStatus = result ? getExecutionStatus(result) : "success";
  const citationLevel = result ? getCitationLevel(result) : "none";
  const accuracyStatus = result ? getAccuracyStatus(result) : "needs_review";
  const reviewStatus = result ? getReviewStatus(result) : "manual_review_needed";
  const issueLevel = result ? getGeoIssueLevel(result) : "healthy";
  const nextStep = result ? getGeoNextStep(result, candidateArticle) : "observe";
  const candidateStatus = getGeoCandidateStatus(candidateArticle);
  const dataConfidence = result ? getDataConfidence(result) : "pending";
  const citationRows = (result?.citedUrls || []).map((url, index) => ({ id: `${url}-${index}`, index: index + 1, url }));
  const canCreateContentAction = result && executionStatus === "success" && (nextStep === "add_candidate" || nextStep === "fix_citation");
  const rawRows = result
    ? [
        { label: "记录 ID", value: result.id },
        { label: "接入来源", value: result.providerKey || "-" },
        { label: "模型", value: result.modelName || "-" },
        { label: "测试时间", value: result.testedAt || "-" },
        { label: "数据来源", value: confidenceLabels[dataConfidence] },
        { label: "人工修正", value: result.manualOverride ? "是" : "否" },
        { label: "蒸馏词 ID", value: result.distilledTermIds?.join("、") || "-" },
        { label: "错误信息", value: result.errorMessage || "-" }
      ]
    : [];

  return (
    <>
      {contextHolder}
      <PageHeader
        title="GEO 详情"
        subtitle={result ? `${result.platform} / ${result.promptGroup} / ${result.prompt}` : "读取 GEO 测试记录中。"}
        actions={
          <Space>
            <Link href="/geo-test">
              <Button>返回 GEO 测试</Button>
            </Link>
            {result ? (
              <Button loading={exporting} onClick={handleExportGeoBusinessDetail}>
                复制业务详情
              </Button>
            ) : null}
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      {result ? (
        <>
          <div className="metric-grid metric-grid-five">
            <Card size="small">
              <span className="geo-detail-metric-label">AI 是否提到我们</span>
              <strong className="geo-detail-metric-value">{result.mentionedJoto ? "已提到" : "未提到"}</strong>
            </Card>
            <Card size="small">
              <span className="geo-detail-metric-label">产品是否被提到</span>
              <strong className="geo-detail-metric-value">{result.mentionedWeike ? "已提到" : "未提到"}</strong>
            </Card>
            <Card size="small">
              <span className="geo-detail-metric-label">官网引用</span>
              <strong className="geo-detail-metric-value">{result.citedOfficialUrl ? "有引用" : "无引用"}</strong>
            </Card>
            <Card size="small">
              <span className="geo-detail-metric-label">竞品提及</span>
              <strong className="geo-detail-metric-value">{result.competitorAppeared ? "出现" : "未出现"}</strong>
            </Card>
            <Card size="small">
              <span className="geo-detail-metric-label">下一步</span>
              <strong className="geo-detail-metric-value">{geoNextStepLabels[nextStep]}</strong>
            </Card>
          </div>

          <div className="geo-detail-grid">
            <div className="geo-detail-main">
              <Card title="AI 回答摘要">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag>{result.platform}</Tag>
                    <Tag>{`问题组：${result.promptGroup}`}</Tag>
                    <Tag color={executionStatusColors[executionStatus]}>{executionStatusLabels[executionStatus]}</Tag>
                    <Tag color={accuracyStatusColors[accuracyStatus]}>{accuracyStatusLabels[accuracyStatus]}</Tag>
                    <Tag color={reviewStatusColors[reviewStatus]}>{reviewStatusLabels[reviewStatus]}</Tag>
                  </Space>
                  <Typography.Paragraph className="geo-answer-snapshot">
                    {result.answerSnapshot || "暂无回答快照。"}
                  </Typography.Paragraph>
                  {result.errorMessage ? <Alert showIcon type="error" message={result.errorMessage} /> : null}
                </Space>
              </Card>

              <Card title="引用来源">
                <Alert
                  showIcon
                  type={citationLevel === "none" ? "warning" : "info"}
                  message={citationLevelLabels[citationLevel]}
                  description="这里展示回答侧可观察到的来源，不推断模型内部真实引用路径。"
                  style={{ marginBottom: 16 }}
                />
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={citationRows}
                  locale={{ emptyText: <ActionEmpty title="暂无可观察引用来源" description="当前回答没有返回官网、官方渠道或第三方引用 URL。" /> }}
                  columns={[
                    { title: "序号", dataIndex: "index", width: 80 },
                    {
                      title: "来源链接",
                      dataIndex: "url",
                      render: (url: string) => (
                        <Typography.Link href={url} target="_blank" rel="noreferrer">
                          {url}
                        </Typography.Link>
                      )
                    }
                  ]}
                />
              </Card>

              <Card title="原始数据">
                <Descriptions size="small" column={2}>
                  {rawRows.map((row) => (
                    <Descriptions.Item key={row.label} label={row.label}>
                      {row.value}
                    </Descriptions.Item>
                  ))}
                  <Descriptions.Item label="测试问题" span={2}>
                    {result.prompt}
                  </Descriptions.Item>
                </Descriptions>
                <Alert
                  showIcon
                  type="info"
                  style={{ marginTop: 16 }}
                  message="原始数据仅用于排查和追溯，不在主列表和周报业务视角直接展示。"
                />
              </Card>
            </div>

            <div className="geo-detail-aside">
              <Card title="业务判断">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color={geoIssueLevelColors[issueLevel]}>{geoIssueLevelLabels[issueLevel]}</Tag>
                    <Tag color={citationLevelColors[citationLevel]}>{citationLevelLabels[citationLevel]}</Tag>
                    <Tag color={confidenceColors[dataConfidence]}>{confidenceLabels[dataConfidence]}</Tag>
                  </Space>
                  <Typography.Paragraph>{getGeoBusinessConclusion(result)}</Typography.Paragraph>
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="问题类型">{result.issueType || "待判断"}</Descriptions.Item>
                    <Descriptions.Item label="建议动作">{result.suggestedAction || getGeoActionText(result, candidateArticle)}</Descriptions.Item>
                    <Descriptions.Item label="候选状态">
                      <Tag color={geoCandidateStatusColors[candidateStatus]}>{geoCandidateStatusLabels[candidateStatus]}</Tag>
                    </Descriptions.Item>
                  </Descriptions>
                </Space>
              </Card>

              <Card title="竞品提及">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Tag color={result.competitorAppeared ? "gold" : "green"}>
                    {result.competitorAppeared ? "回答中出现竞品" : "未发现明显竞品占位"}
                  </Tag>
                  <Typography.Paragraph className="muted">
                    竞品提及不一定等于负面结果；当它和“未提到我们”“未引用官网”同时出现时，才优先进入内容补强。
                  </Typography.Paragraph>
                </Space>
              </Card>

              <Card title="内容动作" data-testid="geo-detail-business-action-card">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Alert showIcon type={canCreateContentAction ? "warning" : "info"} message={geoNextStepLabels[nextStep]} description={getGeoActionText(result, candidateArticle)} />
                  <Space wrap>
                    {nextStep === "configure_models" ? (
                      <GovernanceEntry
                        label="去 AI 配置"
                        type="primary"
                        reason="GEO 测试配置需要工作台运营或开发管理员处理；业务人员只需要保留问题缺口和下一步动作。"
                      />
                    ) : null}
                    {canCreateContentAction ? (
                      <>
                        <Popconfirm
                          title="确认加入周计划草稿？"
                          description="会把这个 GEO 问题缺口转为本周计划中的补强任务。"
                          okText="加入"
                          cancelText="取消"
                          onConfirm={handleCreateTaskFromGeoGap}
                        >
                          <Button type="primary" loading={creatingTask} data-testid={`geo-detail-create-task-button-${result.id}`}>
                            转周计划
                          </Button>
                        </Popconfirm>
                        <Button
                          loading={creatingKnowledgeBase}
                          onClick={handleCreateKnowledgeBaseFromGeoGap}
                          data-testid={`geo-detail-create-knowledge-button-${result.id}`}
                        >
                          补知识库
                        </Button>
                        <Popconfirm
                          title="确认加入博客候选池？"
                          description="会把这个 GEO 未命中或官网链路不足的主题沉淀到博客候选池。"
                          okText="加入"
                          cancelText="取消"
                          onConfirm={handleAddCandidate}
                        >
                          <Button loading={addingCandidate} disabled={candidateStatus !== "none"}>
                            入候选池
                          </Button>
                        </Popconfirm>
                      </>
                    ) : null}
                    {nextStep === "candidate_pool" ? (
                      <Link href="/blog-candidates">
                        <Button type="primary">去候选池</Button>
                      </Link>
                    ) : null}
                    {nextStep === "planned" ? (
                      <Link href="/weekly-plan">
                        <Button type="primary">看周计划</Button>
                      </Link>
                    ) : null}
                  </Space>
                </Space>
              </Card>

              <Card title="字段说明">
                <List
                  size="small"
                  dataSource={[
                    "AI 回答摘要用于判断回答里是否出现品牌、产品、官网和竞品信号。",
                    "引用来源只记录可观察 URL，不展示模型内部调用轨迹。",
                    "原始数据服务于排查和追溯，默认不进入业务周报主视角。"
                  ]}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
