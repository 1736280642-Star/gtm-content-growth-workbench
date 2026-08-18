"use client";

import { ArrowRightOutlined, FileDoneOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Progress, Space, Spin, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callJsonApi } from "@/lib/client-api";

interface SampleListItem {
  articleTypeVersionId: string;
  articleTypeName: string;
  evidenceReadiness: string;
  taskId?: string;
  title?: string;
  reviewStatus: string;
  operation?: { status: string; progressStage?: string; error?: { message: string; nextAction: string } };
}

interface ProductSampleListState {
  strategyPackId: string;
  strategyVersion: number;
  strategyStatus: string;
  requiredCount: number;
  approvedCount: number;
  items: SampleListItem[];
}

const labels: Record<string, { text: string; color: string }> = {
  pending_generation: { text: "等待生成", color: "default" },
  pending_review: { text: "待你验收", color: "blue" },
  pending_revision: { text: "正在按要求修改", color: "processing" },
  approved: { text: "已确认", color: "green" },
  evidence_pending: { text: "资料待补", color: "gold" }
};

export function ProductSampleArticlePanel({ productId }: { productId: string }) {
  const [state, setState] = useState<ProductSampleListState | null>();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [messageApi, holder] = message.useMessage();

  const refresh = useCallback(async () => {
    try {
      const body = await callJsonApi<{ ok: true; data: ProductSampleListState | null }>(
        `/api/v5/products/${encodeURIComponent(productId)}/sample-article`,
        { cache: "no-store" }
      );
      setState(body.data);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!state?.items.some((item) => ["queued", "running"].includes(item.operation?.status || ""))) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh, state]);

  async function generateAll() {
    setGenerating(true);
    try {
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/sample-article`, {
        method: "POST",
        headers: { "x-idempotency-key": `product-samples:${state?.strategyPackId || productId}:${crypto.randomUUID()}` }
      });
      messageApi.success("所有证据就绪的代表样文已进入生成队列。");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "样文任务提交失败");
    } finally {
      setGenerating(false);
    }
  }

  if (loading && state === undefined) return <Card bordered={false}><Spin /> 正在读取样文状态</Card>;
  if (!state) return null;
  const percentage = state.requiredCount ? Math.round(state.approvedCount / state.requiredCount * 100) : 0;
  const needsQueue = state.items.some((item) => item.evidenceReadiness === "ready" && !item.operation && item.reviewStatus !== "approved");

  return (
    <Card
      bordered={false}
      className="sample-review-entry-card"
      title={<Space><FileDoneOutlined /><span>样文验收</span></Space>}
      extra={<Space>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>
        <Link href={`/products/${encodeURIComponent(productId)}/samples`}>
          <Button type="primary">进入样文验收 <ArrowRightOutlined /></Button>
        </Link>
      </Space>}
    >
      {holder}
      <div className="sample-review-entry-summary">
        <div>
          <Typography.Title level={4}>{state.approvedCount} / {state.requiredCount} 篇已确认</Typography.Title>
          <Typography.Text type="secondary">策略包 V{state.strategyVersion} · 只验收证据就绪的文章类型</Typography.Text>
        </div>
        <Progress type="circle" size={72} percent={percentage} format={() => `${percentage}%`} />
      </div>
      <div className="sample-review-entry-types">
        {state.items.map((item) => {
          const status = labels[item.reviewStatus] || labels.pending_generation;
          return <Tag key={item.articleTypeVersionId} color={status.color}>{item.articleTypeName} · {status.text}</Tag>;
        })}
      </div>
      {needsQueue ? (
        <Alert
          showIcon
          type="info"
          message="还有证据就绪的文章类型尚未创建样文"
          action={<Button loading={generating} onClick={() => void generateAll()}>生成全部样文</Button>}
        />
      ) : null}
    </Card>
  );
}
