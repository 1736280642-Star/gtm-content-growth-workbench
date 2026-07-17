"use client";

import { Alert, Button, Card, Progress, Select, Space, Table, Tag, Typography, message } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import Link from "next/link";
import type { Key } from "react";
import { useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { KnowledgeBase, KnowledgeEmbeddingModelProvider, KnowledgeEmbeddingStatus, KnowledgeRetrievalStrategy } from "@/lib/types";

const embeddingStatusLabels: Record<KnowledgeEmbeddingStatus, string> = {
  not_required: "未启用",
  pending_config: "待向量化",
  fallback_hash: "待向量化",
  real_embedding: "已向量化",
  failed: "失败"
};

const embeddingStatusColors: Record<KnowledgeEmbeddingStatus, string> = {
  not_required: "default",
  pending_config: "gold",
  fallback_hash: "gold",
  real_embedding: "green",
  failed: "red"
};

const embeddingOptions: Array<{ value: KnowledgeEmbeddingModelProvider; label: string }> = [
  { value: "qwen_embedding", label: "qwen_embedding" },
  { value: "doubao_embedding", label: "doubao_embedding" }
];

const retrievalOptions: Array<{ value: KnowledgeRetrievalStrategy; label: string }> = [
  { value: "keyword", label: "keyword" },
  { value: "vector", label: "vector" },
  { value: "hybrid", label: "hybrid" }
];

function getVectorStatus(record: KnowledgeBase) {
  return (record.vectorizationStatus || "pending_config") as KnowledgeEmbeddingStatus;
}

export default function KnowledgeVectorizePage() {
  const {
    state: { knowledgeBases, workspaceSetting },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [embeddingModelProvider, setEmbeddingModelProvider] = useState<KnowledgeEmbeddingModelProvider | undefined>();
  const [retrievalStrategy, setRetrievalStrategy] = useState<KnowledgeRetrievalStrategy | undefined>();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultRows, setResultRows] = useState<Array<{ id: string; name: string; status: string; message: string; vectorizedCount?: number; dimensions?: number }>>([]);

  const pendingKnowledgeBases = useMemo(
    () => knowledgeBases.filter((item) => item.status !== "disabled" && getVectorStatus(item) !== "real_embedding"),
    [knowledgeBases]
  );
  const selectedIds = selectedRowKeys.map(String);
  const globalConfig = workspaceSetting.knowledgeRagConfig;
  const effectiveEmbeddingProvider = embeddingModelProvider || globalConfig?.embeddingModelProvider;
  const effectiveRetrievalStrategy = retrievalStrategy || globalConfig?.retrievalStrategy;
  const rowSelection: TableRowSelection<KnowledgeBase> = {
    selectedRowKeys,
    onChange: setSelectedRowKeys
  };

  async function handleVectorize() {
    if (!selectedIds.length) {
      messageApi.warning("请先选择待向量化知识库。");
      return;
    }

    setRunning(true);
    setProgress(20);
    setResultRows([]);

    try {
      setProgress(55);
      const result = await callJsonApi<{ data?: { results?: Array<{ id: string; name: string; status: string; message: string; vectorizedCount?: number; dimensions?: number }> } }>(
        "/api/knowledge-bases/vectorize",
        {
          method: "POST",
          body: JSON.stringify({
            ids: selectedIds,
            embeddingModelProvider,
            retrievalStrategy
          })
        }
      );
      setProgress(100);
      setResultRows(result.data?.results || []);
      await refresh();
      messageApi.success(formatApiMessage(result, "向量化任务已处理。"));
    } catch (error) {
      setProgress(100);
      messageApi.error(error instanceof Error ? error.message : "向量化失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="切片与向量化"
        subtitle="集中处理待向量化知识库；未单独选择策略时使用全局 RAG 预设配置。"
        actions={
          <Space>
            <Link href="/knowledge/import">
              <Button>返回内容导入</Button>
            </Link>
            <Link href="/knowledge">
              <Button>知识库列表</Button>
            </Link>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      <div className="metric-grid">
        <MetricCard title="待处理知识库" value={pendingKnowledgeBases.length} suffix="个" />
        <MetricCard title="已选择" value={selectedIds.length} suffix="个" />
        <MetricCard title="向量模型" value={globalConfig?.embeddingModelProvider || "未选择"} />
        <MetricCard title="检索策略" value={globalConfig?.retrievalStrategy || "未选择"} />
      </div>

      <Card title="解析策略">
        <Alert
          showIcon
          type={effectiveEmbeddingProvider ? "info" : "warning"}
          message={effectiveEmbeddingProvider ? "已选择向量模型" : "请选择向量模型"}
          description={
            effectiveEmbeddingProvider
              ? `当前使用 ${effectiveEmbeddingProvider}，检索策略为 ${effectiveRetrievalStrategy || "未选择"}。`
              : "选择模型和检索策略后，才能开始处理知识库内容。"
          }
          style={{ marginBottom: 16 }}
        />
        <Space wrap>
          <Select
            allowClear
            placeholder="Embedding 模型，不选则用全局配置"
            value={embeddingModelProvider}
            onChange={setEmbeddingModelProvider}
            options={embeddingOptions}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            placeholder="检索策略，不选则用全局配置"
            value={retrievalStrategy}
            onChange={setRetrievalStrategy}
            options={retrievalOptions}
            style={{ width: 220 }}
          />
          <Button type="primary" loading={running} onClick={handleVectorize}>
            确认解析
          </Button>
        </Space>
        {running || progress > 0 ? <Progress percent={progress} style={{ marginTop: 16 }} status={running ? "active" : "normal"} /> : null}
      </Card>

      <Card title="待解析知识库列表" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          loading={loading}
          rowSelection={rowSelection}
          dataSource={pendingKnowledgeBases}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          locale={{
            emptyText: <ActionEmpty title="暂无待向量化知识库" description="导入或追加资料后，状态会回到待向量化。" />
          }}
          columns={[
            {
              title: "名称",
              dataIndex: "name",
              render: (value, record) => <Link href={`/knowledge/${record.id}`}>{value}</Link>
            },
            { title: "切片数", dataIndex: "chunks", width: 100, render: (_, record) => record.chunks?.length || 0 },
            { title: "来源数", dataIndex: "sources", width: 100, render: (_, record) => record.sources?.length || 0 },
            {
              title: "状态",
              width: 140,
              render: (_, record) => {
                const status = getVectorStatus(record);
                return <Tag color={embeddingStatusColors[status]}>{embeddingStatusLabels[status]}</Tag>;
              }
            },
            { title: "最近更新", dataIndex: "lastSyncedAt", width: 190, render: (value) => value || "-" }
          ]}
        />
      </Card>

      {resultRows.length ? (
        <Card title="解析结果" style={{ marginTop: 16 }}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={resultRows}
            columns={[
              { title: "知识库", dataIndex: "name" },
              { title: "状态", dataIndex: "status", width: 130, render: (value) => <Tag>{value}</Tag> },
              { title: "写入切片", dataIndex: "vectorizedCount", width: 110, render: (value) => value ?? "-" },
              { title: "维度", dataIndex: "dimensions", width: 90, render: (value) => value ?? "-" },
              { title: "说明", dataIndex: "message" }
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
