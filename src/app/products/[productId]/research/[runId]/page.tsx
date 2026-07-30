"use client";

import { ArrowLeftOutlined, ExportOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Progress, Space, Table, Tabs, Tag, Typography } from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GeoResearchRail } from "@/components/geo/GeoResearchRail";
import { GeoStructuredData } from "@/components/geo/GeoStructuredData";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import type {
  GeoResearchEvidence,
  GeoResearchFinding,
  GeoResearchFindingType,
  GeoResearchRunWorkspace,
  GeoResearchTask,
  GeoResearchTaskStatus,
  GeoResearchTaskType
} from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";

interface RunResponse {
  ok: true;
  product: ProductRegistryItem;
  runWorkspace: GeoResearchRunWorkspace;
}

const taskLabels: Record<GeoResearchTaskType, string> = {
  context_validation: "资料与边界校验",
  research_planning: "研究规划",
  live_question_discovery: "用户问题发现",
  live_competitor_discovery: "竞品内容研究",
  frontend_baseline: "AI 回答基线",
  evidence_alignment: "证据对齐",
  blueprint_synthesis: "蓝图综合"
};

const taskStatusLabels: Record<GeoResearchTaskStatus, string> = {
  blocked: "等待依赖",
  queued: "已排队",
  running: "执行中",
  pending_config: "等待配置",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

const findingLabels: Record<GeoResearchFindingType, string> = {
  question_opportunity: "问题机会",
  competitor_mention: "竞品提及",
  citation_pattern: "引用模式",
  content_gap: "内容缺口",
  evidence_gap: "证据缺口",
  relationship_error: "关系错误",
  capability_error: "能力错误",
  article_type_recommendation: "文章类型建议",
  channel_recommendation: "渠道建议",
  retest_requirement: "复测要求"
};

function statusColor(status: GeoResearchTaskStatus) {
  if (status === "completed") return "green";
  if (status === "running") return "processing";
  if (status === "pending_config") return "gold";
  if (status === "failed") return "red";
  return "default";
}

export default function GeoResearchRunPage() {
  const params = useParams<{ productId: string; runId: string }>();
  const { productId, runId } = params;
  const [data, setData] = useState<RunResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await callJsonApi<RunResponse>(
        `/api/v5/products/${encodeURIComponent(productId)}/research-runs/${encodeURIComponent(runId)}`,
        { cache: "no-store" }
      ));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "研究运行读取失败");
    } finally {
      setLoading(false);
    }
  }, [productId, runId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const workspace = data?.runWorkspace;
  const completedCount = workspace?.tasks.filter((task) => task.status === "completed").length || 0;
  const progress = workspace?.tasks.length ? Math.round(completedCount / workspace.tasks.length * 100) : 0;
  const publicSources = useMemo(
    () => workspace?.evidence.filter((item) => Boolean(item.sourceUrl)) || [],
    [workspace?.evidence]
  );

  return (
    <>
      <PageHeader
        title={data ? `${data.product.displayName} · 研究运行 v${workspace?.run.runVersion}` : "GEO 研究运行"}
        subtitle="这里展示本次运行真正执行了什么、引用了哪些公开网页、发现了哪些问题和竞品。"
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>
            <Link href={`/products/${encodeURIComponent(productId)}/research`}><Button icon={<ArrowLeftOutlined />}>返回产品调研</Button></Link>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading && !data} onRetry={refresh} />
      {workspace ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {workspace.run.status === "running" || workspace.run.status === "queued" ? (
            <Alert showIcon type="info" message="研究仍在执行" description="页面展示的是已持久化结果；刷新不会重复创建任务。" />
          ) : null}
          {workspace.tasks.some((task) => task.status === "pending_config") ? (
            <Alert
              showIcon
              type="warning"
              message="任务已安全暂停，等待联网研究配置"
              description="配置完成后重新运行 Worker，任务会从原节点继续，不会用模拟内容填充结果。"
            />
          ) : null}

          <Card bordered={false}>
            <div className="geo-run-summary">
              <div><span>链路进度</span><strong>{progress}%</strong><Progress percent={progress} showInfo={false} size="small" /></div>
              <div><span>可见公开来源</span><strong>{publicSources.length}</strong><small>网页 URL 可直接复核</small></div>
              <div><span>结构化发现</span><strong>{workspace.findings.length}</strong><small>问题、竞品、引用和缺口</small></div>
              <div><span>联网搜索门禁</span><strong>{workspace.run.liveSearchVerified ? "通过" : "待通过"}</strong><small>未通过不能生成蓝图</small></div>
            </div>
            <GeoResearchRail tasks={workspace.tasks} />
          </Card>

          <Card bordered={false}>
            <Tabs
              defaultActiveKey="findings"
              items={[
                {
                  key: "findings",
                  label: `研究发现 ${workspace.findings.length}`,
                  children: (
                    <Table<GeoResearchFinding>
                      rowKey="findingId"
                      size="small"
                      pagination={{ pageSize: 12 }}
                      dataSource={workspace.findings}
                      locale={{ emptyText: "尚未产生研究发现" }}
                      columns={[
                        { title: "类型", dataIndex: "findingType", width: 150, render: (value: GeoResearchFindingType) => <Tag>{findingLabels[value]}</Tag> },
                        { title: "发现", dataIndex: "title", render: (value: string, record) => <div className="v5-table-stack"><strong>{value}</strong><span>{record.summary}</span></div> },
                        { title: "置信度", dataIndex: "confidence", width: 110, render: (value: number) => `${Math.round(value * 100)}%` },
                        { title: "证据", dataIndex: "evidenceIds", width: 90, render: (value: string[]) => `${value.length} 条` },
                        { title: "审核", dataIndex: "reviewStatus", width: 100, render: (value: string) => <Tag color={value === "confirmed" ? "green" : value === "rejected" ? "red" : "gold"}>{value === "candidate" ? "候选" : value === "confirmed" ? "已确认" : "已拒绝"}</Tag> }
                      ]}
                    />
                  )
                },
                {
                  key: "evidence",
                  label: `公开来源 ${publicSources.length}`,
                  children: (
                    <Table<GeoResearchEvidence>
                      rowKey="evidenceId"
                      size="small"
                      pagination={{ pageSize: 12 }}
                      dataSource={publicSources}
                      locale={{ emptyText: "尚未记录公开来源" }}
                      columns={[
                        { title: "来源类型", dataIndex: "evidenceType", width: 140, render: (value: string) => <Tag>{value === "visible_citation" ? "AI 可见引用" : "搜索结果"}</Tag> },
                        {
                          title: "页面",
                          render: (_, record) => (
                            <div className="v5-table-stack">
                              <a href={record.sourceUrl} target="_blank" rel="noreferrer">
                                <strong>{record.sourceTitle || record.sourceUrl}</strong> <ExportOutlined />
                              </a>
                              <span>{record.publisher || new URL(record.sourceUrl as string).hostname}</span>
                            </div>
                          )
                        },
                        { title: "发现查询", dataIndex: "queryText", render: (value?: string) => value || "Provider 未返回查询文本" },
                        { title: "采集时间", dataIndex: "capturedAt", width: 170, render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) }
                      ]}
                    />
                  )
                },
                {
                  key: "tasks",
                  label: `任务记录 ${workspace.tasks.length}`,
                  children: (
                    <Table<GeoResearchTask>
                      rowKey="taskId"
                      size="small"
                      pagination={false}
                      dataSource={workspace.tasks}
                      columns={[
                        { title: "研究步骤", dataIndex: "taskType", render: (value: GeoResearchTaskType) => taskLabels[value] },
                        { title: "状态", dataIndex: "status", width: 120, render: (value: GeoResearchTaskStatus) => <Tag color={statusColor(value)}>{taskStatusLabels[value]}</Tag> },
                        { title: "执行方式", width: 190, render: (_, record) => record.provider ? `${record.provider} / ${record.providerModel || "-"}` : "等待调度" },
                        { title: "结果", render: (_, record) => record.failureMessage || (record.status === "completed" ? "结果已持久化" : "等待执行") }
                      ]}
                    />
                  )
                },
                ...(workspace.blueprint ? [{
                  key: "blueprint",
                  label: "蓝图草案",
                  children: (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Typography.Title level={5}>月度策略候选输入</Typography.Title>
                      <GeoStructuredData value={workspace.blueprint.monthlyStrategyInput} />
                      <Typography.Title level={5}>内容类型策略</Typography.Title>
                      <GeoStructuredData value={workspace.blueprint.contentTypeStrategy} />
                    </Space>
                  )
                }] : [])
              ]}
            />
          </Card>
        </Space>
      ) : null}
    </>
  );
}
