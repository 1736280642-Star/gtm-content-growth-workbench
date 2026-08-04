"use client";

import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Empty, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import { freeProductionChannelLabels } from "@/lib/v5/free-production-contracts";

const statusLabels: Record<string, { label: string; color?: string }> = {
  draft: { label: "草稿" },
  ready_for_confirmation: { label: "待确认", color: "blue" },
  compiling: { label: "编译中", color: "processing" },
  generating: { label: "生成中", color: "processing" },
  checking: { label: "检查中", color: "processing" },
  repairing: { label: "修复中", color: "processing" },
  needs_input: { label: "待补充", color: "warning" },
  blocked: { label: "已阻断", color: "error" },
  publishing: { label: "发布中", color: "processing" },
  published: { label: "已发布", color: "success" },
  generation_failed: { label: "生成失败", color: "error" },
  publish_failed: { label: "发布失败", color: "error" },
  cancelled: { label: "已取消" }
};

export function FreeProductionTaskTable({ data, loading, onPreview, onRetry }: { data: FreeProductionBatch[]; loading?: boolean; onPreview: (batch: FreeProductionBatch) => void; onRetry: (batch: FreeProductionBatch) => void }) {
  const columns: ColumnsType<FreeProductionBatch> = [
    { title: "单篇任务", key: "batch", render: (_, record) => <div className="v5-table-stack"><strong>{record.draftArtifacts.find((item) => item.id === record.currentDraftArtifactId)?.selectedTitle || "正文生成中"}</strong><span>{record.productName} · {record.freeContentExpressionTypeVersionId}</span></div> },
    { title: "月份", dataIndex: "monthStart", width: 100, render: (value: string) => value.slice(0, 7) },
    { title: "渠道", key: "channel", width: 110, render: (_, record) => <Tag>{freeProductionChannelLabels[record.channelConfig.channel]}</Tag> },
    { title: "状态", dataIndex: "status", width: 110, render: (value: string) => <Tag color={statusLabels[value]?.color}>{statusLabels[value]?.label || value}</Tag> },
    { title: "更新时间", dataIndex: "updatedAt", width: 170, render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
    { title: "操作", key: "actions", width: 170, render: (_, record) => <div className="free-table-actions"><Button type="text" icon={<EyeOutlined />} onClick={() => onPreview(record)}>查看正文</Button>{["generation_failed", "publish_failed"].includes(record.status) ? <Button type="text" icon={<ReloadOutlined />} onClick={() => onRetry(record)}>安全重试</Button> : null}</div> }
  ];
  return <Table rowKey="id" loading={loading} dataSource={data} columns={columns} pagination={{ pageSize: 12 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有公众号生产批次" /> }} />;
}
