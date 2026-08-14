"use client";

import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Segmented, Space, Statistic, Table, Tag, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ProductGeoOverview } from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { MonthlyReview } from "@/lib/v5/monthly-review-contracts";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

type MonitorTab = "overview" | "content" | "ai" | "history";
interface AttentionItem { id: string; whatHappened: string; impact: string; nextAction: string; nextCheckAt: string; attemptCount: number; impactCount: number }

function currentMonth() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date()); }
function livenessLabel(value?: "pending" | "passed" | "failed") { return value === "passed" ? "通过" : value === "failed" ? "失败" : "待观察"; }

function GeoMonitorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab") || "overview";
  const tab = ({ publishing: "content", ledger: "content", site: "content", review: "content" }[requested] || requested) as MonitorTab;
  const month = currentMonth();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace(month);
  const [products, setProducts] = useState<ProductRegistryItem[]>([]);
  const [overviews, setOverviews] = useState<ProductGeoOverview[]>([]);
  const [review, setReview] = useState<MonthlyReview>();
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [selectedTask, setSelectedTask] = useState<ProductionMatrixTask>();

  const refreshResults = useCallback(async () => {
    const [productResponse, reviewResponse, attentionResponse] = await Promise.all([
      fetch("/api/v5/products", { cache: "no-store" }),
      fetch(`/api/v5/monthly-reviews/${month}`, { cache: "no-store" }),
      fetch(`/api/v5/tasks/attention?month=${month}`, { cache: "no-store" })
    ]);
    const productBody = await productResponse.json();
    const reviewBody = await reviewResponse.json();
    const attentionBody = await attentionResponse.json();
    if (productResponse.ok) { setProducts(productBody.products || []); setOverviews(productBody.overviews || []); }
    if (reviewResponse.ok) setReview(reviewBody.data);
    if (attentionResponse.ok) setAttention(attentionBody.data?.items || []);
  }, [month]);
  useEffect(() => { void refreshResults(); }, [refreshResults]);

  const tasks = useMemo(() => workspace?.productionTasks || [], [workspace?.productionTasks]);
  const monitoredQuestions = useMemo(() => review?.questions.filter((item) => item.geoMonitoringApproved) || [], [review?.questions]);
  const published = tasks.filter((item) => item.status === "published");
  const scheduled = tasks.filter((item) => Boolean(item.scheduledAt) && item.status !== "published");
  const selectedPublishedContent = selectedTask
    ? review?.questions.flatMap((item) => item.publishedContent).find((item) => item.contentId === selectedTask.taskId)
    : undefined;
  const productRows = overviews.filter((item) => item.isPromoting).map((overview) => ({
    ...overview,
    name: products.find((item) => item.productId === overview.productId)?.displayName || overview.productId,
    taskCount: tasks.filter((task) => workspace?.rulePackages.find((pack) => pack.id === task.rulePackageVersionId)?.productId === overview.productId).length
  }));
  const options = [{ label: "总览", value: "overview" }, { label: "内容表现", value: "content" }, { label: "AI 可见性", value: "ai" }, { label: "系统记录", value: "history" }];

  return <>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
      <div><Typography.Title level={2} style={{ margin: 0 }}>GEO 监控塔</Typography.Title><Typography.Text type="secondary">只展示结果、系统自愈和真正需要你处理的事项。</Typography.Text></div>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void Promise.all([refresh(month), refreshResults()])}>刷新</Button>
    </div>
    <Segmented block value={tab} options={options} onChange={(value) => router.push(`/geo-monitor?tab=${value}`)} style={{ marginBottom: 16 }} />
    {error ? <Alert showIcon type="error" message="监控数据读取失败" description={error} /> : null}

    {tab === "overview" ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert showIcon type={attention.length ? "warning" : "success"} message={attention.length ? `${attention.length} 项需要你处理，其余异常由系统自动恢复` : "系统正常运行，当前无需介入"} description={`${productRows.length} 个产品正在推广，已发布 ${published.length} 篇，${scheduled.length} 篇等待发布。`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <Card><Statistic title="推广产品" value={productRows.length} /></Card><Card><Statistic title="已发布" value={published.length} /></Card><Card><Statistic title="有效指标回传" value={review?.metrics.effectiveMetricReturns || 0} /></Card><Card><Statistic title="待确认缺口" value={review?.metrics.pendingGaps || 0} /></Card>
      </div>
      <Card title="产品表现"><Table rowKey="productId" pagination={false} dataSource={productRows} locale={{ emptyText: <Empty description="暂无推广产品" /> }} columns={[
        { title: "产品", dataIndex: "name" },
        { title: "GEO 状态", render: (_, row) => <Tag color={row.blueprintStatus === "approved" ? "green" : "gold"}>{row.blueprintStatus === "approved" ? "蓝图已批准" : "持续调研中"}</Tag> },
        { title: "问题覆盖", render: (_, row) => new Set(tasks.filter((task) => workspace?.rulePackages.find((pack) => pack.id === task.rulePackageVersionId)?.productId === row.productId).map((task) => task.questionVersionId)).size },
        { title: "内容投入", dataIndex: "taskCount" },
        { title: "自动优化", render: (_, row) => row.strategyPackId ? <Tag color="blue">策略已同步</Tag> : <Tag>等待策略</Tag> }
      ]} /></Card>
      <Card title="需你处理"><Table rowKey="id" pagination={false} dataSource={attention} locale={{ emptyText: <Empty description="当前无需介入" /> }} columns={[
        { title: "发生了什么", dataIndex: "whatHappened" }, { title: "影响", dataIndex: "impact" }, { title: "下一步", dataIndex: "nextAction" }, { title: "再次检查", dataIndex: "nextCheckAt" }
      ]} /></Card>
    </Space> : null}

    {tab === "content" ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <Card><Statistic title="正式发布" value={review?.metrics.publishedContent || 0} /></Card>
        <Card><Statistic title="有效指标回传" value={review?.metrics.effectiveMetricReturns || 0} /></Card>
        <Card><Statistic title="24h 存活" value={`${review?.metrics.survival24hPassed || 0}/${review?.metrics.survival24hEligible || 0}`} suffix="已到观察窗" /></Card>
        <Card><Statistic title="72h 存活" value={`${review?.metrics.survival72hPassed || 0}/${review?.metrics.survival72hEligible || 0}`} suffix="已到观察窗" /></Card>
      </div>
      <Card title="内容表现与发布结果" extra={<Tag>点击文章查看 URL 与存活状态</Tag>}><Table rowKey="taskId" dataSource={tasks} pagination={{ pageSize: 15 }} columns={[
        { title: "文章", dataIndex: "title", ellipsis: true }, { title: "渠道", dataIndex: "channel" },
        { title: "状态", render: (_, row) => <Tag color={row.status === "published" ? "green" : row.scheduledAt ? "blue" : "default"}>{row.status === "published" ? "已发布" : row.scheduledAt ? "已排程" : "生产中"}</Tag> },
        { title: "发布时间", dataIndex: "scheduledAt", render: (value?: string) => value ? new Date(value).toLocaleString("zh-CN") : "-" },
        { title: "", render: (_, row) => <Button type="link" icon={<EyeOutlined />} onClick={() => setSelectedTask(row)}>查看详情</Button> }
      ]} /></Card>
      <Card title="MonthlyReview 下月调整依据" extra={<Tag>重大策略变化仍需人工确认</Tag>}><Table rowKey="id" dataSource={review?.questions || []} pagination={false} locale={{ emptyText: <Empty description="真实发布与观察数据积累后生成建议" /> }} columns={[
        { title: "目标问题", dataIndex: "questionText" },
        { title: "正式发布", render: (_, row) => row.publishedContent.length },
        { title: "24h / 72h", render: (_, row) => row.publishedContent.length ? row.publishedContent.map((item) => `${livenessLabel(item.liveness24h)} / ${livenessLabel(item.liveness72h)}`).join("；") : "无数据" },
        { title: "下月建议", dataIndex: "recommendation" },
        { title: "证据状态", dataIndex: "dataStatus", render: (value) => <Tag color={value === "complete" ? "green" : "gold"}>{value}</Tag> }
      ]} /></Card>
    </Space> : null}

    {tab === "ai" ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}><Card><Statistic title="自动复测任务" value={monitoredQuestions.reduce((sum, item) => sum + item.captureTaskIds.length, 0)} /></Card><Card><Statistic title="待确认缺口" value={review?.metrics.pendingGaps || 0} /></Card></div>
      <Card title="AI 可见性与引用证据"><Table rowKey="id" dataSource={monitoredQuestions} pagination={false} locale={{ emptyText: <Empty description="请先在 GEO 调研结果中人工确认问题；内容发布后系统会自动复测" /> }} columns={[
        { title: "问题", dataIndex: "questionText" },
        { title: "最近复测时间", dataIndex: "lastRetestedAt", render: (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未复测" },
        { title: "AI 回答与引用", dataIndex: "captureSummary" }, { title: "已发布内容", render: (_, row) => row.publishedContent.length }, { title: "数据状态", dataIndex: "dataStatus", render: (value) => <Tag>{value}</Tag> }
      ]} /></Card>
    </Space> : null}

    {tab === "history" ? <Card title="系统自动化记录"><Table rowKey="taskId" dataSource={[...tasks].reverse()} pagination={{ pageSize: 15 }} columns={[
      { title: "对象", dataIndex: "title" }, { title: "动作", render: (_, row) => row.status === "published" ? "完成发布并进入复测" : row.scheduledAt ? "生成发布排程" : row.status === "available" ? "正文通过校验" : "系统持续处理" }, { title: "结果", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "归因", render: (_, row) => `问题 ${row.questionVersionId} → 内容 → ${row.channel}` }
    ]} /></Card> : null}

    <Drawer title="文章发布与证据明细" open={Boolean(selectedTask)} onClose={() => setSelectedTask(undefined)} width={720}>
      {selectedTask ? <Descriptions bordered column={1}>
        <Descriptions.Item label="文章">{selectedTask.title}</Descriptions.Item><Descriptions.Item label="渠道">{selectedTask.channel}</Descriptions.Item><Descriptions.Item label="生产状态">{selectedTask.status}</Descriptions.Item><Descriptions.Item label="排程">{selectedTask.scheduledAt ? new Date(selectedTask.scheduledAt).toLocaleString("zh-CN") : "尚未排程"}</Descriptions.Item><Descriptions.Item label="发布账号">{selectedTask.platformAccount || "系统等待账号配置"}</Descriptions.Item><Descriptions.Item label="公开 URL">{selectedPublishedContent?.publicUrl ? <Typography.Link href={selectedPublishedContent.publicUrl} target="_blank" rel="noreferrer">{selectedPublishedContent.publicUrl}</Typography.Link> : selectedTask.publicUrl || "等待正式发布回传"}</Descriptions.Item><Descriptions.Item label="24h / 72h 存活">{`${livenessLabel(selectedPublishedContent?.liveness24h)} / ${livenessLabel(selectedPublishedContent?.liveness72h)}`}</Descriptions.Item><Descriptions.Item label="资料快照">{selectedTask.sourceSnapshotHash || "-"}</Descriptions.Item><Descriptions.Item label="规则包">{selectedTask.rulePackageVersionId}</Descriptions.Item><Descriptions.Item label="Ledger">任务、正文、排程、公共 URL 和存活验证通过 taskId 与 publishScheduleId 保持关联。</Descriptions.Item>
      </Descriptions> : null}
    </Drawer>
  </>;
}

export default function GeoMonitorPage() { return <Suspense fallback={null}><GeoMonitorWorkspace /></Suspense>; }
