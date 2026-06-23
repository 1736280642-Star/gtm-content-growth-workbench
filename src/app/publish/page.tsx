"use client";

import { Alert, Button, Card, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Upload, message } from "antd";
import type { UploadFile } from "antd";
import Link from "next/link";
import { useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { channelLabels, contentTypeLabels, productLabels } from "@/lib/labels";
import type { ChannelKey, PublishRecord } from "@/lib/types";

const publishStatusLabels: Record<PublishRecord["publishStatus"], string> = {
  queued: "待确认发布",
  published: "待回填 URL",
  url_filled: "已回填 URL",
  failed: "失败"
};

type DataReturnStatus = "missing_url" | "pending_metrics" | "matched" | "publish_pending" | "failed";

const dataReturnStatusLabels: Record<DataReturnStatus, string> = {
  missing_url: "缺 URL",
  pending_metrics: "待数据回传",
  matched: "已匹配数据",
  publish_pending: "待今日确认",
  failed: "需排查"
};

const dataReturnStatusColors: Record<DataReturnStatus, string> = {
  missing_url: "orange",
  pending_metrics: "gold",
  matched: "green",
  publish_pending: "blue",
  failed: "red"
};

function getDataReturnStatus(record: PublishRecord): DataReturnStatus {
  if (record.publishStatus === "failed") {
    return "failed";
  }

  if (record.channelMetrics) {
    return "matched";
  }

  if (record.publishStatus === "queued") {
    return "publish_pending";
  }

  if (!record.publishedUrl) {
    return "missing_url";
  }

  return "pending_metrics";
}

function getDataReturnActionText(record: PublishRecord) {
  const status = getDataReturnStatus(record);

  if (status === "publish_pending") {
    return "这篇还没有在今日发布页确认已发布，先回今日发布处理。";
  }

  if (status === "missing_url") {
    return "缺正式 URL，渠道数据无法稳定匹配，先回今日发布页补链接。";
  }

  if (status === "pending_metrics") {
    return "可以通过导入渠道数据表或手动补录，把阅读、点赞等指标写回。";
  }

  if (status === "failed") {
    return "发布记录失败，先回今日发布核对状态，再导入指标。";
  }

  return "渠道指标已匹配，可进入周度复盘。";
}

export default function PublishPage() {
  const {
    state: { publishRecords, drafts, tasks },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [importingMetrics, setImportingMetrics] = useState(false);
  const [metricsRecord, setMetricsRecord] = useState<PublishRecord>();
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PublishRecord["publishStatus"][]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelKey[]>([]);
  const [manualMetrics, setManualMetrics] = useState({
    impressions: 0,
    views: 0,
    likes: 0,
    favorites: 0,
    comments: 0,
    shares: 0
  });
  const [metricsCsv, setMetricsCsv] = useState("");
  const [metricsFiles, setMetricsFiles] = useState<UploadFile[]>([]);
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const filteredPublishRecords = publishRecords.filter((record) => {
    const statusMatched = !statusFilter.length || statusFilter.includes(record.publishStatus);
    const channelMatched = !channelFilter.length || channelFilter.includes(record.channel);

    return statusMatched && channelMatched;
  });
  const publishedCount = filteredPublishRecords.filter((record) => record.publishStatus !== "queued").length;
  const matchedCount = filteredPublishRecords.filter((record) => getDataReturnStatus(record) === "matched").length;
  const missingUrlCount = filteredPublishRecords.filter((record) => getDataReturnStatus(record) === "missing_url").length;
  const pendingMetricsCount = filteredPublishRecords.filter((record) => getDataReturnStatus(record) === "pending_metrics").length;

  function clearFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
  }

  async function handleCopyTemplate() {
    await navigator.clipboard.writeText("title,publishedUrl,views,likes,favorites,comments,shares\n");
    messageApi.success("渠道数据 CSV 模板已复制。");
  }

  async function handleImportMetrics() {
    setImportingMetrics(true);

    try {
      let result: unknown;

      if (metricsFiles.length) {
        const formData = new FormData();

        for (const file of metricsFiles) {
          if (file.originFileObj) {
            formData.append("files", file.originFileObj);
          }
        }

        if (metricsCsv.trim()) {
          formData.append("csv", metricsCsv.trim());
        }

        const response = await fetch("/api/channel-metrics/import", {
          method: "POST",
          body: formData
        });
        result = await response.json();

        if (!response.ok) {
          throw new Error((result as { message?: string }).message || `Request failed: ${response.status}`);
        }
      } else {
        const payload: Record<string, unknown> = {};

        if (metricsCsv.trim()) {
          payload.csv = metricsCsv.trim();
        }

        result = await callJsonApi("/api/channel-metrics/import", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      await refresh();
      messageApi.success(formatApiMessage(result, "渠道数据导入完成"));
      setMetricsFiles([]);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "渠道数据导入失败");
    } finally {
      setImportingMetrics(false);
    }
  }

  function openMetricsModal(record: PublishRecord) {
    setMetricsRecord(record);
    setManualMetrics({
      impressions: record.channelMetrics?.impressions || 0,
      views: record.channelMetrics?.views || 0,
      likes: record.channelMetrics?.likes || 0,
      favorites: record.channelMetrics?.favorites || 0,
      comments: record.channelMetrics?.comments || 0,
      shares: record.channelMetrics?.shares || 0
    });
  }

  async function handleSaveMetrics() {
    if (!metricsRecord) {
      return;
    }

    setSavingMetrics(true);

    try {
      const result = await callJsonApi(`/api/publish-records/${metricsRecord.id}/metrics`, {
        method: "PATCH",
        body: JSON.stringify(manualMetrics)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "渠道指标已保存"));
      setMetricsRecord(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "渠道指标保存失败");
    } finally {
      setSavingMetrics(false);
    }
  }

  function updateManualMetric(key: keyof typeof manualMetrics, value: number | null) {
    setManualMetrics((current) => ({
      ...current,
      [key]: Math.max(0, Math.trunc(value || 0))
    }));
  }

  function renderMetrics(record: PublishRecord) {
    if (!record.channelMetrics) {
      return <span className="muted">待回传</span>;
    }

    return [
      `展现 ${record.channelMetrics.impressions ?? 0}`,
      `阅读 ${record.channelMetrics.views ?? 0}`,
      `点赞 ${record.channelMetrics.likes ?? 0}`,
      `收藏 ${record.channelMetrics.favorites ?? 0}`,
      `评论 ${record.channelMetrics.comments ?? 0}`,
      `分享 ${record.channelMetrics.shares ?? 0}`
    ].join(" / ");
  }

  function renderDataReturnEntry(record: PublishRecord) {
    const status = getDataReturnStatus(record);

    if (status === "pending_metrics") {
      return (
        <Button size="small" type="primary" onClick={() => openMetricsModal(record)}>
          手动补录
        </Button>
      );
    }

    if (status === "matched") {
      return (
        <Link href="/weekly-report">
          <Button size="small">去周报</Button>
        </Link>
      );
    }

    return (
      <Link href="/today">
        <Button size="small">{status === "missing_url" ? "回填 URL" : "回今日发布"}</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="数据回传"
        subtitle="这里只负责把渠道数据匹配到已发布文章；发布确认和 URL 回填统一回今日发布页处理。"
        actions={
          <>
            <Button onClick={handleCopyTemplate}>下载模板</Button>
            <Link href="/today">
              <Button>回今日发布</Button>
            </Link>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid">
        <MetricCard title="已发布文章" value={publishedCount} suffix="篇" />
        <MetricCard title="已匹配数据" value={matchedCount} suffix="篇" />
        <MetricCard title="匹配失败/缺 URL" value={missingUrlCount} suffix="篇" />
        <MetricCard title="待导入渠道" value={pendingMetricsCount} suffix="篇" />
      </div>
      <Card>
        <Alert
          showIcon
          type={missingUrlCount ? "warning" : pendingMetricsCount ? "info" : "success"}
          message={`数据回传记录 ${filteredPublishRecords.length} 条，已匹配 ${matchedCount} 条，待回传 ${pendingMetricsCount} 条。`}
          description="如果记录缺 URL，先回今日发布补链接；只有已发布且 URL 完整的内容，才适合导入渠道指标。"
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
          <Upload multiple accept=".csv,.txt,.xls,.xlsx" beforeUpload={() => false} fileList={metricsFiles} onChange={({ fileList }) => setMetricsFiles(fileList)}>
            <Button>选择渠道数据表</Button>
          </Upload>
          <Input.TextArea
            rows={4}
            placeholder="也可以粘贴 CSV：title,publishedUrl,views,likes,favorites,comments,shares"
            value={metricsCsv}
            onChange={(event) => setMetricsCsv(event.target.value)}
          />
          <Popconfirm title="导入渠道数据？" description="会按标题或 URL 匹配已发布文章，并统一写入渠道指标。" okText="导入" cancelText="取消" onConfirm={handleImportMetrics}>
            <Button type="primary" loading={importingMetrics}>
              导入渠道数据
            </Button>
          </Popconfirm>
        </Space>
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按发布状态筛选"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={Object.entries(publishStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按渠道筛选"
            value={channelFilter}
            onChange={(value) => setChannelFilter(value)}
            options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredPublishRecords}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有数据回传记录" : "还没有已发布记录"}
                description={hasActiveFilter ? "清空筛选或调整状态、渠道条件后再查看。" : "先在今日发布页确认已发布并回填 URL，再回到这里导入渠道数据。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/today">
                      <Button type="primary">去今日发布</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "匹配状态", render: (_, record) => <Tag color={dataReturnStatusColors[getDataReturnStatus(record)]}>{dataReturnStatusLabels[getDataReturnStatus(record)]}</Tag>, width: 130 },
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as ChannelKey], width: 120 },
            { title: "标题", dataIndex: "title" },
            {
              title: "来源任务",
              render: (_, record) => {
                const draft = draftById.get(record.draftId);
                const task = draft ? taskById.get(draft.taskId) : undefined;

                if (!task) {
                  return <Tag color="red">任务缺失</Tag>;
                }

                return (
                  <Space direction="vertical" size={4}>
                    <span>{task.publishDate}</span>
                    <Space wrap>
                      <Tag>{productLabels[task.product]}</Tag>
                      <Tag>{contentTypeLabels[task.contentType]}</Tag>
                    </Space>
                  </Space>
                );
              }
            },
            { title: "URL", dataIndex: "publishedUrl", render: (value) => value || <span className="muted">缺 URL</span> },
            { title: "渠道指标", render: (_, record) => renderMetrics(record) },
            { title: "处理动作", render: (_, record) => getDataReturnActionText(record) },
            { title: "可执行入口", render: (_, record) => renderDataReturnEntry(record), width: 130 }
          ]}
        />
      </Card>
      <Modal title="手动补录渠道指标" open={Boolean(metricsRecord)} onOk={handleSaveMetrics} confirmLoading={savingMetrics} onCancel={() => setMetricsRecord(undefined)}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <InputNumber addonBefore="展现" min={0} precision={0} value={manualMetrics.impressions} onChange={(value) => updateManualMetric("impressions", value)} style={{ width: "100%" }} />
          <InputNumber addonBefore="阅读" min={0} precision={0} value={manualMetrics.views} onChange={(value) => updateManualMetric("views", value)} style={{ width: "100%" }} />
          <InputNumber addonBefore="点赞" min={0} precision={0} value={manualMetrics.likes} onChange={(value) => updateManualMetric("likes", value)} style={{ width: "100%" }} />
          <InputNumber addonBefore="收藏" min={0} precision={0} value={manualMetrics.favorites} onChange={(value) => updateManualMetric("favorites", value)} style={{ width: "100%" }} />
          <InputNumber addonBefore="评论" min={0} precision={0} value={manualMetrics.comments} onChange={(value) => updateManualMetric("comments", value)} style={{ width: "100%" }} />
          <InputNumber addonBefore="分享" min={0} precision={0} value={manualMetrics.shares} onChange={(value) => updateManualMetric("shares", value)} style={{ width: "100%" }} />
        </Space>
      </Modal>
    </>
  );
}
