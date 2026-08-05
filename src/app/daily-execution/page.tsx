"use client";

import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import { PageHeader } from "@/components/PageHeader";
import { PublishStatusTag } from "@/components/PublishStatusTag";
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

function sortByExecutionTime(left: DailyExecutionItem, right: DailyExecutionItem) {
  return `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`);
}

function shortTitle(title: string) {
  return title.length > 42 ? `${title.slice(0, 42)}...` : title;
}

export default function DailyExecutionPage() {
  const [messageApi, messageContext] = message.useMessage();
  const [dateKey, setDateKey] = useState<DateKey>("today");
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
  const attentionItems = dateItems.filter((item) => item.status === "failed" || item.status === "manual_takeover").sort(sortByExecutionTime);
  const autoItems = dateItems.filter((item) => item.status === "scheduled" || item.status === "waiting" || item.status === "publishing").sort(sortByExecutionTime);
  const publishedItems = dateItems.filter((item) => item.status === "published").sort(sortByExecutionTime);
  const activeDate = dates[dateKey];
  const queue = workspace?.batchQueueItems || [];
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
          auditReason: "在当日执行中回填正式发布结果和渠道指标。"
        })
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string; nextAction?: string } };
      if (!response.ok || !body.ok) throw new Error([body.error?.message, body.error?.nextAction].filter(Boolean).join(" ") || "发布结果保存失败。");
      await refresh(workspace?.month);
      setSelectedPublishItem(undefined);
      messageApi.success("发布结果已保存，并进入月度复盘数据源。");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "发布结果保存失败。");
    } finally {
      setSavingResult(false);
    }
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title="当日执行"
        subtitle="只看是否需要你介入。能自动发布、自动验证、自动回填的任务都交给系统。"
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
        type={workspace?.source.productionQueue === "v5_mysql" ? "success" : "warning"}
        message={workspace?.source.productionQueue === "v5_mysql" ? "系统会自动处理已排程文章" : "发布队列还没准备好"}
        description={workspace?.source.productionQueue === "v5_mysql" ? "你只需要看红色异常。其他文章会按时间进入发布、URL 回填和存活验证。" : workspace?.formal.message || "请检查正式发布队列配置。"}
        style={{ marginBottom: 16 }}
      />

      {error ? <Alert showIcon type="error" message="执行任务读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} style={{ marginBottom: 16 }} /> : null}
      {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取今日状态</span></div> : null}

      <section className={styles.commandCenter} aria-label="当日执行摘要">
        <Card className={attentionItems.length ? styles.needAction : styles.allClear} size="small">
          <span className={styles.kicker}>{dateLabels[dateKey]} · {activeDate}</span>
          <Typography.Title level={2} className={styles.verdict}>
            {attentionItems.length ? `需要处理 ${attentionItems.length} 件` : "不用处理"}
          </Typography.Title>
          <Typography.Text className={styles.verdictCopy}>
            {attentionItems.length ? "先看下面红色任务。其他内容系统会自己发布和验证。" : "今天没有需要你介入的发布任务。"}
          </Typography.Text>
        </Card>
        <div className={styles.simpleStats}>
          <div><strong>{autoItems.length}</strong><span>系统处理中</span></div>
          <div><strong>{publishedItems.length}</strong><span>已完成</span></div>
          <div><strong>{dateItems.length}</strong><span>总任务</span></div>
        </div>
      </section>

      <section className={styles.focusGrid}>
        <Card
          title={<Space><span>需人工处理</span><PublishStatusTag status={attentionItems.length ? "failed" : "published"} /></Space>}
          size="small"
          className={styles.attentionCard}
        >
          {attentionItems.length ? (
            <div className={styles.taskStack}>
              {attentionItems.map((record) => {
                const item = queueById.get(record.id);
                return (
                  <article className={styles.attentionItem} key={record.id}>
                    <div>
                      <span>{record.time} · {record.channel}</span>
                      <strong>{shortTitle(record.title)}</strong>
                      <p>{record.failureReason || item?.nextAction || "系统已暂停这篇文章，请确认原因后再处理。"}</p>
                    </div>
                    <Space wrap>
                      <Button size="small" onClick={() => void openPreview(record.id)}>看正文</Button>
                      {item ? <Button size="small" type="primary" onClick={() => {
                        setSelectedPublishItem(item);
                        setPublishStatus("published");
                        setPublicUrl(item.publicUrl || "");
                        setFailureReason(item.failureReason || "");
                        setReads(undefined); setLikes(undefined); setLeads(undefined);
                      }}>记录结果</Button> : null}
                    </Space>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有异常，系统会继续自动推进。" />
          )}
        </Card>

        <Card title="系统自动处理中" size="small" className={styles.autoCard}>
          {autoItems.length ? (
            <div className={styles.autoList}>
              {autoItems.slice(0, 5).map((record) => (
                <div className={styles.autoItem} key={record.id}>
                  <span>{record.time}</span>
                  <strong>{shortTitle(record.title)}</strong>
                  <PublishStatusTag status={record.status} />
                </div>
              ))}
              {autoItems.length > 5 ? <Typography.Text type="secondary">还有 {autoItems.length - 5} 篇由系统继续处理。</Typography.Text> : null}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无等待系统处理的文章。" />
          )}
        </Card>
      </section>
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
            {previewLoading ? <div className="v5-loading-row"><Spin /><span>正在读取完整正文</span></div> : null}
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
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这篇正文尚未保存结构化引用。" />}
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
        title={selectedPublishItem ? `记录发布结果：${selectedPublishItem.title}` : "记录发布结果"}
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




