"use client";

import { RocketOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Table, message } from "antd";
import { useMemo, useState } from "react";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import { PageHeader } from "@/components/PageHeader";
import { PublishStatusTag } from "@/components/PublishStatusTag";
import { V5StatusRail } from "@/components/V5StatusRail";
import type { BatchQueueItem, DailyExecutionItem, ProductionMatrixTask, PublishStatus } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";
import styles from "./daily-execution.module.css";

type DateKey = DailyExecutionItem["dateKey"];

interface PreviewEvidenceReference {
  sourceId: string;
  title: string;
  excerpt: string;
  limitation?: string;
}

type PreviewTask = ProductionMatrixTask & {
  productNameSnapshot?: string;
  publication?: {
    nextAction?: string;
    preflightMessage?: string;
  };
  frozenCta?: {
    copy: string;
    label: string;
    publicUrl: string;
    ctaVariantVersionId?: string;
  };
  lastUsableDraft?: ProductionMatrixTask["lastUsableDraft"] & { evidenceReferences?: PreviewEvidenceReference[] };
  currentDraft?: ProductionMatrixTask["currentDraft"] & { evidenceReferences?: PreviewEvidenceReference[] };
};

const dateOptions = [
  { label: "昨日", value: "yesterday" },
  { label: "今日", value: "today" },
  { label: "明日", value: "tomorrow" }
];

const dateLabels: Record<DateKey, string> = {
  yesterday: "昨日",
  today: "今日",
  tomorrow: "明日"
};

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function executionDates() {
  const today = new Date();
  const yesterday = new Date(today);
  const tomorrow = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  tomorrow.setDate(today.getDate() + 1);
  return { yesterday: formatLocalDate(yesterday), today: formatLocalDate(today), tomorrow: formatLocalDate(tomorrow) };
}

function toPublishStatus(item: BatchQueueItem): PublishStatus {
  if (item.displayStatus === "published") return "published";
  if (item.displayStatus === "publish_failed") return "failed";
  if (item.scheduleStatus === "pending_config") return "manual_takeover";
  if (item.generationStatus === "generating") return "publishing";
  if (item.scheduleStatus === "active") return "scheduled";
  return "waiting";
}

function toProductionPublishStatus(item: ProductionMatrixTask): PublishStatus {
  if (item.status === "published") return "published";
  if (item.failureReason) return "failed";
  if (item.status === "scheduled") return "scheduled";
  if (item.status === "generating") return "publishing";
  if (item.status === "system_recovering") return "failed";
  if (item.status === "awaiting_material") return "manual_takeover";
  return "waiting";
}

function toMachinePlatform(channel: string) {
  const normalized = channel.toLowerCase();
  if (normalized.includes("csdn")) return "csdn";
  if (normalized.includes("掘金") || normalized.includes("juejin")) return "juejin";
  if (normalized.includes("知乎") || normalized.includes("zhihu")) return "zhihu";
  if (normalized.includes("公众号") || normalized.includes("wechat") || normalized.includes("weixin")) return "wechat";
  return undefined;
}

export default function DailyExecutionPage() {
  const [messageApi, messageContext] = message.useMessage();
  const [dateKey, setDateKey] = useState<DateKey>("today");
  const [channelFilter, setChannelFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<PublishStatus>();
  const [selectedPreviewTaskId, setSelectedPreviewTaskId] = useState<string>();
  const [loadedPreviewTask, setLoadedPreviewTask] = useState<PreviewTask>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const [selectedPublishItem, setSelectedPublishItem] = useState<BatchQueueItem>();
  const [publishStatus, setPublishStatus] = useState<"published" | "failed" | "manual_takeover">("published");
  const [publicUrl, setPublicUrl] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [reads, setReads] = useState<number>();
  const [likes, setLikes] = useState<number>();
  const [leads, setLeads] = useState<number>();
  const [savingResult, setSavingResult] = useState(false);
  const [dispatchingTaskId, setDispatchingTaskId] = useState<string>();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const dates = useMemo(executionDates, []);
  const dailyExecutionItems = useMemo<DailyExecutionItem[]>(() => {
    const queueByTaskId = new Map((workspace?.batchQueueItems || []).map((item) => [item.matrixItemId, item]));
    const rulePackagesById = new Map((workspace?.rulePackages || []).flatMap((item) => [[item.id, item], [item.version, item]] as const));

    return (workspace?.productionTasks || [])
      .filter((item) => Boolean(item.scheduledAt))
      .map((item) => {
        const scheduleDate = item.scheduledAt?.slice(0, 10) || "";
        const matchedDateKey = Object.entries(dates).find(([, date]) => date === scheduleDate)?.[0] as DateKey | undefined;
        if (!matchedDateKey) return null;
        const queueItem = queueByTaskId.get(item.taskId);
        const product = queueItem?.product || rulePackagesById.get(item.rulePackageVersionId)?.productName || item.question;
        return {
          id: item.taskId,
          dateKey: matchedDateKey,
          date: scheduleDate,
          time: item.scheduledAt?.slice(11, 16) || "待定",
          title: item.title,
          product,
          channel: item.channel,
          status: queueItem ? toPublishStatus(queueItem) : toProductionPublishStatus(item),
          failureReason: queueItem?.failureReason || item.failureReason || ""
        } satisfies DailyExecutionItem;
      })
      .filter((item): item is DailyExecutionItem => item !== null);
  }, [dates, workspace?.batchQueueItems, workspace?.productionTasks, workspace?.rulePackages]);
  const dateItems = dailyExecutionItems.filter((item) => item.dateKey === dateKey);
  const visibleItems = dateItems.filter((item) => (!channelFilter || item.channel === channelFilter) && (!statusFilter || item.status === statusFilter));
  const channelOptions = Array.from(new Set(dateItems.map((item) => item.channel))).sort();
  const activeDate = dates[dateKey];
  const recentFailureCount = dailyExecutionItems.filter((item) => ["failed", "manual_takeover"].includes(item.status)).length;
  const queue = workspace?.batchQueueItems || [];
  const publishedCount = queue.filter((item) => item.displayStatus === "published").length;
  const scheduledCount = queue.filter((item) => item.scheduleStatus === "active" && item.displayStatus !== "published").length;
  const unscheduledCount = queue.filter((item) => item.scheduleStatus === "unscheduled").length;
  const queueById = new Map<string, BatchQueueItem>();
  for (const item of queue) {
    queueById.set(item.id, item);
    queueById.set(item.matrixItemId, item);
  }
  const compactPreviewTask = (workspace?.productionTasks || []).find((item) => item.taskId === selectedPreviewTaskId) as PreviewTask | undefined;
  const selectedPreviewTask = loadedPreviewTask?.taskId === selectedPreviewTaskId ? loadedPreviewTask : compactPreviewTask;
  const selectedPreviewDraft = selectedPreviewTask?.lastUsableDraft || selectedPreviewTask?.currentDraft;
  const selectedPreviewRow = dailyExecutionItems.find((item) => item.id === selectedPreviewTaskId);

  async function openPreview(taskId: string) {
    setSelectedPreviewTaskId(taskId);
    setLoadedPreviewTask(undefined);
    setPreviewError(undefined);
    const compactTask = (workspace?.productionTasks || []).find((item) => item.taskId === taskId) as PreviewTask | undefined;
    const compactDraft = compactTask?.lastUsableDraft || compactTask?.currentDraft;
    if (compactDraft?.bodyIncluded !== false && compactDraft?.markdown) return;
    setPreviewLoading(true);
    try {
      const query = new URLSearchParams({ taskId });
      if (workspace?.month) query.set("month", workspace.month);
      const response = await fetch(`/api/v5/monthly-workspace/tasks?${query.toString()}`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: { task?: PreviewTask }; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data?.task) throw new Error(body.error?.message || "正文读取失败。");
      setLoadedPreviewTask(body.data.task);
    } catch (requestError) {
      setPreviewError(requestError instanceof Error ? requestError.message : "正文读取失败。");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setSelectedPreviewTaskId(undefined);
    setLoadedPreviewTask(undefined);
    setPreviewError(undefined);
  }

  async function savePublishResult() {
    if (!selectedPublishItem) return;
    setSavingResult(true);
    try {
      const response = await fetch(`/api/v5/content-tasks/${encodeURIComponent(selectedPublishItem.matrixItemId)}/publish-result`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: selectedPublishItem.publishResultVersion || 0,
          status: publishStatus,
          publicUrl: publicUrl.trim() || undefined,
          failureReason: failureReason.trim() || undefined,
          metrics: Object.fromEntries(Object.entries({ reads, likes, leads }).filter(([, value]) => typeof value === "number")),
          auditReason: "在当日执行中回填正式发布结果和渠道指标"
        })
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string; nextAction?: string } };
      if (!response.ok || !body.ok) throw new Error([body.error?.message, body.error?.nextAction].filter(Boolean).join(" ") || "发布结果保存失败。");
      await refresh(workspace?.month);
      setSelectedPublishItem(undefined);
      messageApi.success("发布结果已保存并进入月度复盘数据源。");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "发布结果保存失败。");
    } finally {
      setSavingResult(false);
    }
  }

  async function dispatchMachinePublish(item: BatchQueueItem) {
    const platform = toMachinePlatform(item.channel);
    if (!item.draftId || !platform) {
      messageApi.error("当前任务缺少正式终稿或渠道尚未映射到发布机器。");
      return;
    }
    setDispatchingTaskId(item.matrixItemId);
    try {
      const response = await fetch(`/api/v5/content-tasks/${encodeURIComponent(item.matrixItemId)}/publish-job`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: item.draftId, platform, scheduledAt: item.scheduleDate ? `${item.scheduleDate}T${item.scheduleTime || "00:00"}:00+08:00` : undefined, dispatch: true })
      });
      const body = await response.json() as { ok?: boolean; message?: string; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.message || body.error?.message || "Publish Job 创建失败。");
      messageApi.success("已创建 Publish Job；常驻 Worker 将执行发布、URL 回填和存活核验。");
      window.location.href = "/publishing";
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "Publish Job 创建失败。");
    } finally { setDispatchingTaskId(undefined); }
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title="当日执行"
        subtitle="只回答昨天发生了什么、今天要处理什么、明天是否准备好；不承担计划、标题和正文生成。"
        actions={
          <Segmented
            aria-label="选择执行日期"
            options={dateOptions}
            value={dateKey}
            onChange={(value) => setDateKey(value as DateKey)}
          />
        }
      />

      <Alert
        showIcon
        type={workspace?.source.productionQueue === "v5_mysql" ? "info" : "warning"}
        message={workspace?.source.productionQueue === "v5_mysql" ? "正式发布执行视图" : "正式发布队列未连接"}
        description={workspace?.source.productionQueue === "v5_mysql" ? "正式终稿从这里进入 Publish Job；Worker 发布后由 reconciliation 自动回填 URL，并继续执行 24h/72h 存活验证。" : workspace?.formal.message || "请检查正式 MySQL Repository 配置。"}
        style={{ marginBottom: 16 }}
      />

      {error ? <Alert showIcon type="error" message="执行任务读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} style={{ marginBottom: 16 }} /> : null}
      {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取正式执行任务</span></div> : null}

      <V5StatusRail
        items={[
          { label: "本月已发布", value: publishedCount, helper: "按正式发布结果统计" },
          { label: "本月待发布", value: scheduledCount + unscheduledCount, helper: "包含已排程与未排程" },
          { label: "已排程待发布", value: scheduledCount, helper: "已确认发布时间" },
          { label: "未排程", value: unscheduledCount, helper: "返回批量生成中心安排" },
          { label: "近三日发布异常", value: recentFailureCount, helper: "失败或人工接管" }
        ]}
      />

      <Card title={`${dateLabels[dateKey]} · ${activeDate}`} size="small" extra={<Space wrap>
        <Select aria-label="渠道筛选" allowClear value={channelFilter} onChange={setChannelFilter} placeholder="全部渠道" style={{ width: 140 }} options={channelOptions.map((value) => ({ value, label: value }))} />
        <Select aria-label="发布状态筛选" allowClear value={statusFilter} onChange={setStatusFilter} placeholder="全部发布状态" style={{ width: 150 }} options={[
          { value: "scheduled", label: "已排程" }, { value: "waiting", label: "等待发布" }, { value: "publishing", label: "发布中" }, { value: "published", label: "已发布" }, { value: "failed", label: "发布失败" }, { value: "manual_takeover", label: "人工接管" }
        ]} />
        <Button onClick={() => { setChannelFilter(undefined); setStatusFilter(undefined); }}>清除筛选</Button>
      </Space>}>
        <Table
          className="v5-daily-execution-table"
          rowKey="id"
          size="small"
          tableLayout="fixed"
          pagination={false}
          dataSource={visibleItems}
          locale={{ emptyText: `${dateLabels[dateKey]}没有发布任务` }}
          columns={[
            { title: "发布日期", key: "publishDate", width: 120, render: (_, record) => <div className="v5-date-cell"><strong>{record.date.slice(5)}</strong><span>{record.time}</span></div> },
            { title: "标题", dataIndex: "title", render: (value) => <strong className="v5-title-cell">{value}</strong> },
            { title: "产品", dataIndex: "product", width: 160 },
            { title: "渠道", dataIndex: "channel", width: 100 },
            { title: "状态", dataIndex: "status", width: 110, render: (value: DailyExecutionItem["status"]) => <PublishStatusTag status={value} /> },
            {
              title: "操作",
              key: "action",
              width: 150,
              render: (_, record: DailyExecutionItem) => (
                <Space size={4} direction="vertical">
                  <Button size="small" onClick={() => void openPreview(record.id)}>查看正文</Button>
                  {queueById.get(record.id)?.publicUrl ? <a href={queueById.get(record.id)?.publicUrl} target="_blank" rel="noreferrer">查看结果</a> : null}
                  {record.status !== "published" && queueById.get(record.id)?.draftId && toMachinePlatform(record.channel) ? <Button size="small" type="primary" icon={<RocketOutlined />} loading={dispatchingTaskId === queueById.get(record.id)?.matrixItemId} onClick={() => {
                    const item = queueById.get(record.id);
                    if (item) void dispatchMachinePublish(item);
                  }}>机器发布</Button> : null}
                  {record.status !== "published" ? <Button size="small" onClick={() => {
                    const item = queueById.get(record.id);
                    if (!item) return;
                    setSelectedPublishItem(item);
                    setPublishStatus("published");
                    setPublicUrl(item.publicUrl || "");
                    setFailureReason(item.failureReason || "");
                    setReads(undefined); setLikes(undefined); setLeads(undefined);
                  }}>回填结果（异常）</Button> : null}
                </Space>
              )
            }
          ]}
        />
      </Card>
      <Modal
        width={1180}
        open={Boolean(selectedPreviewTask)}
        title={selectedPreviewDraft?.title || selectedPreviewTask?.title || "正文预览"}
        footer={<Button onClick={closePreview}>关闭</Button>}
        onCancel={closePreview}
        destroyOnHidden
      >
        {selectedPreviewTask ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="状态"><PublishStatusTag status={toProductionPublishStatus(selectedPreviewTask)} /></Descriptions.Item>
              <Descriptions.Item label="渠道">{selectedPreviewTask.channel}</Descriptions.Item>
              <Descriptions.Item label="发布日期">{selectedPreviewTask.scheduledAt?.slice(0, 10) || "未排程"}</Descriptions.Item>
              <Descriptions.Item label="产品">{selectedPreviewTask.productNameSnapshot || selectedPreviewRow?.product || selectedPreviewTask.question}</Descriptions.Item>
              <Descriptions.Item label="发布情况" span={2}>{selectedPreviewTask.publication?.nextAction || selectedPreviewTask.publication?.preflightMessage || "尚未运行发布预检"}</Descriptions.Item>
            </Descriptions>
            {previewLoading ? <div className="v5-loading-row"><Spin /><span>正在读取这篇完整正文</span></div> : null}
            {previewError ? <Alert showIcon type="error" message="正文读取失败" description={previewError} /> : null}
            <div className={styles.review}>
              <article className={styles.manuscript} aria-labelledby="daily-preview-body-heading">
                <div className={styles.panelHeading}>
                  <span>发布正文</span>
                  <h3 id="daily-preview-body-heading">正文预览</h3>
                </div>
                <MarkdownArticle className={styles.body} markdown={selectedPreviewDraft?.markdown} />
              </article>
              <aside className={styles.evidence} aria-labelledby="daily-preview-evidence-heading">
                <div className={styles.panelHeading}>
                  <span>不随正文发布</span>
                  <h3 id="daily-preview-evidence-heading">事实依据与边界</h3>
                </div>
                {selectedPreviewDraft?.evidenceReferences?.length ? (
                  <div className={styles.evidenceList}>
                    {selectedPreviewDraft.evidenceReferences.map((reference) => (
                      <section key={reference.sourceId}>
                        <strong>{reference.title}</strong>
                        <p>{reference.excerpt}</p>
                        {reference.limitation ? <small>公开边界：{reference.limitation}</small> : null}
                      </section>
                    ))}
                  </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这篇正文尚未保存结构化引用" />}
                <div className={styles.checkBasis}>
                  <strong>系统检查</strong>
                  <ul>{(selectedPreviewDraft?.basisSummary || []).map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className={styles.checkBasis}>
                  <strong>冻结 CTA</strong>
                  {selectedPreviewTask.frozenCta ? (
                    <>
                      <p>{selectedPreviewTask.frozenCta.copy}</p>
                      <a href={selectedPreviewTask.frozenCta.publicUrl} target="_blank" rel="noreferrer">{selectedPreviewTask.frozenCta.label}</a>
                      {selectedPreviewTask.frozenCta.ctaVariantVersionId ? <small>版本：{selectedPreviewTask.frozenCta.ctaVariantVersionId}</small> : null}
                    </>
                  ) : selectedPreviewTask.frozenCtaPreview ? <p>{selectedPreviewTask.frozenCtaPreview}</p> : <p>当前任务尚未冻结 CTA。</p>}
                </div>
              </aside>
            </div>
          </Space>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(selectedPublishItem)}
        title={selectedPublishItem ? `回填发布结果：${selectedPublishItem.title}` : "回填发布结果"}
        okText="保存结果"
        confirmLoading={savingResult}
        onOk={() => void savePublishResult()}
        onCancel={() => setSelectedPublishItem(undefined)}
        okButtonProps={{ disabled: publishStatus === "published" ? !/^https?:\/\//i.test(publicUrl) : !failureReason.trim() }}
      >
        <Form layout="vertical">
          <Form.Item label="实际状态" required>
            <Select value={publishStatus} onChange={setPublishStatus} options={[
              { value: "published", label: "已发布" },
              { value: "failed", label: "发布失败" },
              { value: "manual_takeover", label: "人工接管" }
            ]} />
          </Form.Item>
          {publishStatus === "published" ? <Form.Item label="公开 URL" required><Input type="url" value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} placeholder="https://" /></Form.Item> : <Form.Item label="原因" required><Input.TextArea rows={3} value={failureReason} onChange={(event) => setFailureReason(event.target.value)} /></Form.Item>}
          <Space wrap align="start">
            <Form.Item label="阅读"><InputNumber min={0} value={reads} onChange={(value) => setReads(value ?? undefined)} /></Form.Item>
            <Form.Item label="点赞"><InputNumber min={0} value={likes} onChange={(value) => setLikes(value ?? undefined)} /></Form.Item>
            <Form.Item label="线索"><InputNumber min={0} value={leads} onChange={(value) => setLeads(value ?? undefined)} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
