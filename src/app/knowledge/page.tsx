"use client";

import { Button, Card, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
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
import type { KnowledgeBase, KnowledgeEmbeddingStatus } from "@/lib/types";

const knowledgeTypeLabels: Record<KnowledgeBase["type"], string> = {
  brand: "品牌事实",
  product: "产品知识",
  official_blog: "官网博客",
  channel_history: "渠道历史",
  competitor: "竞品参考",
  custom: "用户自定义"
};

const statusLabels: Record<KnowledgeBase["status"], string> = {
  enabled: "启用",
  disabled: "停用"
};

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

const knowledgeTypeOptions = Object.entries(knowledgeTypeLabels).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));

function getKnowledgeTimestamp(value?: string) {
  if (!value) return 0;

  const timestamp = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getKnowledgeStatus(record: KnowledgeBase) {
  if (record.vectorizationStatus === "real_embedding") return "已完成";
  if (record.chunks?.length) return "待向量化";
  if (record.sources?.some((source) => source.status === "failed")) return "解析失败";
  if (record.sources?.length || record.contentPreview) return "待解析";
  return "待补资料";
}

export default function KnowledgePage() {
  const {
    state: { knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [typeFilter, setTypeFilter] = useState<KnowledgeBase["type"][]>([]);
  const [statusFilter, setStatusFilter] = useState<KnowledgeBase["status"][]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [deletingId, setDeletingId] = useState<string>();
  const [batchAction, setBatchAction] = useState<"merge" | "vectorize">();
  const hasActiveFilter = Boolean(typeFilter.length || statusFilter.length);
  const selectedIds = selectedRowKeys.map(String);
  const selectedKnowledgeBases = knowledgeBases.filter((item) => selectedIds.includes(item.id));
  const canMergeSelected = selectedKnowledgeBases.length >= 2 && selectedKnowledgeBases.every((item) => item.vectorizationStatus !== "real_embedding");
  const visibleKnowledgeBases = useMemo(
    () =>
      knowledgeBases
        .filter((item) => {
          const typeMatched = !typeFilter.length || typeFilter.includes(item.type);
          const statusMatched = !statusFilter.length || statusFilter.includes(item.status);
          return typeMatched && statusMatched;
        })
        .sort((left, right) => getKnowledgeTimestamp(right.lastSyncedAt) - getKnowledgeTimestamp(left.lastSyncedAt)),
    [knowledgeBases, statusFilter, typeFilter]
  );
  const rowSelection: TableRowSelection<KnowledgeBase> | undefined = selectionMode
    ? {
        selectedRowKeys,
        onChange: setSelectedRowKeys,
        getCheckboxProps: (record) => ({
          disabled: record.vectorizationStatus === "real_embedding",
          title: record.vectorizationStatus === "real_embedding" ? "已向量化知识库暂不参与合并" : undefined
        })
      }
    : undefined;
  const pendingVectorCount = knowledgeBases.filter((item) => item.vectorizationStatus !== "real_embedding").length;
  const vectorReadyCount = knowledgeBases.filter((item) => item.vectorizationStatus === "real_embedding").length;
  const sourceCount = knowledgeBases.reduce((sum, item) => sum + (item.sources?.length || 0), 0);

  function clearFilters() {
    setTypeFilter([]);
    setStatusFilter([]);
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) setSelectedRowKeys([]);
      return !current;
    });
  }

  async function handleDeleteKnowledgeBase(id: string) {
    setDeletingId(id);

    try {
      const result = await callJsonApi(`/api/knowledge-bases/${id}`, { method: "DELETE" });
      await refresh();
      setSelectedRowKeys((current) => current.filter((item) => item !== id));
      messageApi.success(formatApiMessage(result, "知识库已删除。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除知识库失败");
    } finally {
      setDeletingId(undefined);
    }
  }

  async function handleMergeSelected() {
    if (!canMergeSelected) {
      messageApi.warning("请选择至少两个未向量化知识库。");
      return;
    }

    setBatchAction("merge");

    try {
      const result = await callJsonApi("/api/knowledge-bases/merge", {
        method: "POST",
        body: JSON.stringify({ ids: selectedIds })
      });
      await refresh();
      setSelectedRowKeys([]);
      messageApi.success(formatApiMessage(result, "已创建合并知识库。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "合并知识库失败");
    } finally {
      setBatchAction(undefined);
    }
  }

  async function handleVectorizeSelected() {
    setBatchAction("vectorize");

    try {
      const result = await callJsonApi("/api/knowledge-bases/vectorize", {
        method: "POST",
        body: JSON.stringify({ ids: selectedIds })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "已提交向量化。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "向量化失败");
    } finally {
      setBatchAction(undefined);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="知识库"
        subtitle="管理内容资产、导入状态和向量化状态；导入、切片向量化、规则包维护进入独立子页面。"
        actions={
          <Space wrap>
            <Link href="/knowledge/import">
              <Button type="primary" data-testid="knowledge-import-button">导入资料</Button>
            </Link>
            <Button onClick={toggleSelectionMode}>{selectionMode ? "退出选择" : "批量选择"}</Button>
            <Button disabled={!selectionMode || !canMergeSelected} loading={batchAction === "merge"} onClick={handleMergeSelected}>
              合并知识库
            </Button>
            <Button disabled={!selectionMode || !selectedIds.length} loading={batchAction === "vectorize"} onClick={handleVectorizeSelected}>
              批量向量化
            </Button>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      <div className="metric-grid">
        <MetricCard title="知识库资产" value={knowledgeBases.length} suffix="条" />
        <MetricCard title="待向量化" value={pendingVectorCount} suffix="条" />
        <MetricCard title="已向量化" value={vectorReadyCount} suffix="条" />
        <MetricCard title="来源资料" value={sourceCount} suffix="个" />
      </div>

      <Card title="知识库列表">
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按类型筛选"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value)}
            options={knowledgeTypeOptions}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按启用状态筛选"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={statusOptions}
            style={{ minWidth: 180 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>清空筛选</Button>
          {selectionMode ? <Tag color="blue">已选择 {selectedIds.length} 条</Tag> : null}
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleKnowledgeBases}
          rowSelection={rowSelection}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有知识库" : "还没有知识库"}
                description={hasActiveFilter ? "清空筛选后再查看。" : "从内容导入页新增 URL 或文档资料。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>清空筛选</Button>
                  ) : (
                    <Link href="/knowledge/import"><Button type="primary">导入资料</Button></Link>
                  )
                }
              />
            )
          }}
          columns={[
            {
              title: "名称",
              dataIndex: "name",
              render: (value, record) => (
                <Space direction="vertical" size={2}>
                  <Link href={`/knowledge/${record.id}`}>{value}</Link>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {record.usageScope || "未填写资料用途"}
                  </Typography.Text>
                </Space>
              )
            },
            { title: "类型", dataIndex: "type", width: 120, render: (value) => <Tag>{knowledgeTypeLabels[value as KnowledgeBase["type"]]}</Tag> },
            { title: "时间", dataIndex: "lastSyncedAt", width: 190, render: (value) => value || "-" },
            {
              title: "状态",
              width: 180,
              render: (_, record) => {
                const vectorStatus = (record.vectorizationStatus || "pending_config") as KnowledgeEmbeddingStatus;
                return (
                  <Space size={4} wrap>
                    <Tag color={record.status === "enabled" ? "green" : "default"}>{statusLabels[record.status]}</Tag>
                    <Tag color={embeddingStatusColors[vectorStatus]}>{getKnowledgeStatus(record)}</Tag>
                  </Space>
                );
              }
            },
            {
              title: "操作",
              width: 180,
              render: (_, record) => (
                <Space>
                  <Link href={`/knowledge/${record.id}`}>
                    <Button size="small" data-testid={`knowledge-edit-detail-${record.id}`}>编辑详情</Button>
                  </Link>
                  <Popconfirm
                    title="确认删除这个知识库？"
                    description="删除后会从知识库列表移除；如只是暂时不用，后续可在详情页停用。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleDeleteKnowledgeBase(record.id)}
                  >
                    <Button size="small" danger loading={deletingId === record.id}>删除</Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>
    </>
  );
}
