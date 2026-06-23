"use client";

import { Alert, Button, Card, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Upload, message } from "antd";
import type { UploadFile } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, contentTypeLabels, productLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useState } from "react";
import type { ChannelKey, PublishRecord } from "@/lib/types";

const publishStatusLabels: Record<PublishRecord["publishStatus"], string> = {
  queued: "待发布",
  published: "已发布",
  url_filled: "已回填",
  failed: "失败"
};

const draftStatusLabels = {
  draft: "草稿",
  final: "终稿",
  discarded: "已废弃"
} as const;

const draftStatusColors = {
  draft: "gold",
  final: "green",
  discarded: "default"
} as const;

type PublishNextStep = "publish" | "fill_url" | "record_metrics" | "review" | "failed";

const publishNextStepLabels: Record<PublishNextStep, string> = {
  publish: "待人工发布",
  fill_url: "待回填 URL",
  record_metrics: "待录入指标",
  review: "可复盘",
  failed: "需排查失败"
};

const publishNextStepColors: Record<PublishNextStep, string> = {
  publish: "gold",
  fill_url: "blue",
  record_metrics: "purple",
  review: "green",
  failed: "red"
};

function getPublishNextStep(record: PublishRecord): PublishNextStep {
  if (record.publishStatus === "failed") {
    return "failed";
  }

  if (record.publishStatus === "queued") {
    return "publish";
  }

  if (!record.publishedUrl) {
    return "fill_url";
  }

  if (!record.channelMetrics) {
    return "record_metrics";
  }

  return "review";
}

function getPublishActionText(record: PublishRecord): string {
  const nextStep = getPublishNextStep(record);

  if (nextStep === "publish") {
    return "先按导出的发布清单完成人工发布，发布完成后标记为已发布。";
  }

  if (nextStep === "fill_url") {
    return "内容已标记发布，但缺少正式 URL；先回填链接，后续才能进入指标和周报复盘。";
  }

  if (nextStep === "record_metrics") {
    return "发布 URL 已闭环，继续录入阅读、点赞、收藏、评论和转发指标。";
  }

  if (nextStep === "failed") {
    return "当前发布记录失败，先重新导出清单核对渠道动作；确认已发布后再标记并回填 URL。";
  }

  return "发布、URL 和渠道指标已闭环，可进入周报复盘查看内容表现。";
}

export default function PublishPage() {
  const {
    state: { publishRecords, drafts, tasks },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [exporting, setExporting] = useState(false);
  const [importingMetrics, setImportingMetrics] = useState(false);
  const [markingRecordId, setMarkingRecordId] = useState<string>();
  const [fillingRecord, setFillingRecord] = useState<PublishRecord>();
  const [metricsRecord, setMetricsRecord] = useState<PublishRecord>();
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");
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
  const visibleQueuedCount = filteredPublishRecords.filter((record) => getPublishNextStep(record) === "publish").length;
  const visiblePendingUrlCount = filteredPublishRecords.filter((record) => getPublishNextStep(record) === "fill_url").length;
  const visiblePendingMetricsCount = filteredPublishRecords.filter((record) => getPublishNextStep(record) === "record_metrics").length;
  const visibleReviewReadyCount = filteredPublishRecords.filter((record) => getPublishNextStep(record) === "review").length;

  function clearFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
  }

  async function handleExport() {
    setExporting(true);

    try {
      const result = await callJsonApi("/api/publish-records/export", { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "发布清单已导出"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导出发布清单失败");
    } finally {
      setExporting(false);
    }
  }

  async function handleFillUrl() {
    if (!fillingRecord) {
      return;
    }

    try {
      const result = await callJsonApi(`/api/publish-records/${fillingRecord.id}/url`, {
        method: "PATCH",
        body: JSON.stringify({ publishedUrl })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "URL 已回填"));
      setFillingRecord(undefined);
      setPublishedUrl("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "URL 回填失败");
    }
  }

  async function handleMarkPublished(recordId: string) {
    setMarkingRecordId(recordId);

    try {
      const result = await callJsonApi(`/api/publish-records/${recordId}/published`, { method: "PATCH" });
      await refresh();
      messageApi.success(formatApiMessage(result, "已标记为已发布"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "标记已发布失败");
    } finally {
      setMarkingRecordId(undefined);
    }
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
      return "待录入";
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

  function renderPublishEntry(record: PublishRecord) {
    const nextStep = getPublishNextStep(record);

    if (nextStep === "publish") {
      return (
        <Popconfirm
          title="确认标记为已发布？"
          description="状态会进入已发布，后续需要回填正式 URL。"
          okText="标记"
          cancelText="取消"
          onConfirm={() => handleMarkPublished(record.id)}
          okButtonProps={{ "data-testid": `publish-mark-published-confirm-${record.id}` }}
        >
          <Button size="small" type="primary" loading={markingRecordId === record.id} data-testid={`publish-mark-published-${record.id}`}>
            标记已发布
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "fill_url") {
      return (
        <Button
          size="small"
          type="primary"
          data-testid={`publish-fill-url-${record.id}`}
          onClick={() => {
            setFillingRecord(record);
            setPublishedUrl(record.publishedUrl || "");
          }}
        >
          回填 URL
        </Button>
      );
    }

    if (nextStep === "record_metrics") {
      return (
        <Button size="small" type="primary" onClick={() => openMetricsModal(record)}>
          录入指标
        </Button>
      );
    }

    if (nextStep === "failed") {
      return (
        <Space>
          <Button size="small" loading={exporting} onClick={handleExport}>
            重新导出
          </Button>
          <Popconfirm
            title="确认标记为已发布？"
            description="仅在已经确认渠道侧发布成功时使用，后续还需要回填 URL。"
            okText="标记"
            cancelText="取消"
            onConfirm={() => handleMarkPublished(record.id)}
            okButtonProps={{ "data-testid": `publish-mark-published-confirm-${record.id}` }}
          >
            <Button size="small" loading={markingRecordId === record.id} data-testid={`publish-mark-published-${record.id}`}>
              标记已发布
            </Button>
          </Popconfirm>
        </Space>
      );
    }

    return (
      <Link href="/weekly-report">
        <Button size="small">去周报复盘</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="发布队列"
        subtitle="MVP 不做自动发布，只做导出、标记已发布和 URL 回填。"
        actions={
          <Button type="primary" loading={exporting} onClick={handleExport}>
            导出发布清单
          </Button>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Card>
        <Alert
          showIcon
          type={visibleQueuedCount || visiblePendingUrlCount || visiblePendingMetricsCount ? "info" : "success"}
          message={`发布队列共 ${filteredPublishRecords.length} 条，待发布 ${visibleQueuedCount} 条，待回填 URL ${visiblePendingUrlCount} 条`}
          description={`待录入指标 ${visiblePendingMetricsCount} 条，可进入周报复盘 ${visibleReviewReadyCount} 条。`}
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
          <Upload
            multiple
            accept=".csv,.txt,.xls,.xlsx"
            beforeUpload={() => false}
            fileList={metricsFiles}
            onChange={({ fileList }) => setMetricsFiles(fileList)}
          >
            <Button>选择渠道数据表</Button>
          </Upload>
          <Input.TextArea
            rows={4}
            placeholder="也可以粘贴 CSV：标题,阅读,点赞,收藏,评论,分享 或 title,views,likes,favorites,comments,shares"
            value={metricsCsv}
            onChange={(event) => setMetricsCsv(event.target.value)}
          />
          <Popconfirm
            title="确认导入渠道数据？"
            description="会自动识别中文/英文字段，统一写入展现、阅读、点赞、收藏、评论和分享指标。"
            okText="导入"
            cancelText="取消"
            onConfirm={handleImportMetrics}
          >
            <Button loading={importingMetrics}>
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
                title={hasActiveFilter ? "当前筛选没有发布记录" : "发布队列还没有终稿"}
                description={hasActiveFilter ? "清空筛选或调整状态、渠道条件后再查看。" : "先在今日任务生成稿件，并在终稿确认页加入发布队列。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/today">
                      <Button type="primary">去今日任务</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "状态", dataIndex: "publishStatus", render: (value) => <Tag>{publishStatusLabels[value as keyof typeof publishStatusLabels]}</Tag> },
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as keyof typeof channelLabels] },
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
            {
              title: "稿件来源",
              render: (_, record) => {
                const draft = draftById.get(record.draftId);

                if (!draft) {
                  return <Tag color="red">稿件缺失</Tag>;
                }

                return (
                  <Space wrap>
                    <Tag color={draftStatusColors[draft.status]}>{draftStatusLabels[draft.status]}</Tag>
                    <Tag>{`v${draft.version}`}</Tag>
                  </Space>
                );
              }
            },
            { title: "发布时间", dataIndex: "publishedAt", render: (value) => value || "-" },
            { title: "URL", dataIndex: "publishedUrl", render: (value) => value || "待回填" },
            { title: "渠道指标", render: (_, record) => <span>{renderMetrics(record)}</span> },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getPublishNextStep(record);

                return <Tag color={publishNextStepColors[nextStep]}>{publishNextStepLabels[nextStep]}</Tag>;
              }
            },
            { title: "处理动作", render: (_, record) => getPublishActionText(record) },
            {
              title: "可执行入口",
              render: (_, record) => renderPublishEntry(record)
            }
          ]}
        />
      </Card>
      <Modal
        title="回填发布 URL"
        open={Boolean(fillingRecord)}
        onOk={handleFillUrl}
        onCancel={() => setFillingRecord(undefined)}
        okButtonProps={{ "data-testid": "publish-url-save-button" }}
      >
        <Input placeholder="https://..." value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} data-testid="publish-url-input" />
      </Modal>
      <Modal
        title="录入渠道指标"
        open={Boolean(metricsRecord)}
        onOk={handleSaveMetrics}
        confirmLoading={savingMetrics}
        onCancel={() => setMetricsRecord(undefined)}
      >
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
