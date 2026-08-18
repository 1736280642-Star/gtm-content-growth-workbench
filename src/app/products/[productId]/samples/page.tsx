"use client";

import { ArrowLeftOutlined, ArrowRightOutlined, FileTextOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Progress, Space, Spin, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callJsonApi } from "@/lib/client-api";

interface SampleListItem {
  articleTypeVersionId: string;
  articleTypeName: string;
  evidenceReadiness: string;
  taskId?: string;
  title?: string;
  reviewStatus: string;
  draft?: { versionNumber: number; createdAt?: string };
  operation?: { status: string; progressStage?: string; error?: { message: string; nextAction: string } };
}

interface SampleListState {
  strategyPackId: string;
  strategyVersion: number;
  strategyStatus: string;
  requiredCount: number;
  approvedCount: number;
  items: SampleListItem[];
}

const statusMeta: Record<string, { text: string; color: string }> = {
  pending_generation: { text: "等待生成", color: "default" },
  pending_review: { text: "待你验收", color: "blue" },
  pending_revision: { text: "正在按要求修改", color: "processing" },
  approved: { text: "已确认", color: "green" },
  evidence_pending: { text: "资料待补", color: "gold" }
};

const progressText: Record<string, string> = {
  queued: "等待 Worker 领取",
  retrieving_evidence: "正在检索证据",
  compiling_contract: "正在准备写作 Brief",
  provider_preflight: "正在检查正文模型",
  calling_provider: "正在生成正文",
  local_repair: "正在整理正文",
  quality_validation: "正在校验事实"
};

export default function ProductSampleListPage() {
  const { productId } = useParams<{ productId: string }>();
  const [state, setState] = useState<SampleListState | null>();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [messageApi, holder] = message.useMessage();

  const refresh = useCallback(async () => {
    try {
      const body = await callJsonApi<{ ok: true; data: SampleListState | null }>(
        `/api/v5/products/${encodeURIComponent(productId)}/sample-article`,
        { cache: "no-store" }
      );
      setState(body.data);
    } finally { setLoading(false); }
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
        headers: { "x-idempotency-key": `product-samples:${state?.strategyPackId}:${crypto.randomUUID()}` }
      });
      messageApi.success("证据就绪的样文已全部进入生成队列。");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "样文任务提交失败");
    } finally { setGenerating(false); }
  }

  if (loading && state === undefined) return <div className="sample-page-loading"><Spin /> 正在读取样文验收队列</div>;
  if (!state) return <Empty description="当前产品还没有已确认策略包下的样文任务" />;
  const percentage = state.requiredCount ? Math.round(state.approvedCount / state.requiredCount * 100) : 0;
  const needsQueue = state.items.some((item) => item.evidenceReadiness === "ready" && !item.operation && item.reviewStatus !== "approved");

  return (
    <div className="sample-proofing-page">
      {holder}
      <div className="sample-proofing-header">
        <div>
          <Link href={`/products/${encodeURIComponent(productId)}?tab=geo&geoView=strategy`}>
            <Button type="text" icon={<ArrowLeftOutlined />}>返回 GEO 策略</Button>
          </Link>
          <Typography.Title level={2}>样文验收</Typography.Title>
          <Typography.Paragraph type="secondary">
            策略包 V{state.strategyVersion} · 每种证据就绪的文章类型先确认一篇，再进入批量生产。
          </Typography.Paragraph>
        </div>
        <div className="sample-proofing-progress">
          <Progress type="circle" size={82} percent={percentage} format={() => `${state.approvedCount}/${state.requiredCount}`} />
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{percentage === 100 ? "全部确认完成" : "继续验收样文"}</Typography.Text>
            <Typography.Text type="secondary">资料待补类型不计入本轮</Typography.Text>
          </Space>
        </div>
      </div>

      <Card bordered={false} className="sample-proofing-queue" title="文章类型与代表样文" extra={<Space>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>
        {needsQueue ? <Button type="primary" loading={generating} onClick={() => void generateAll()}>生成全部样文</Button> : null}
      </Space>}>
        <div className="sample-proofing-list">
          {state.items.map((item) => {
            const operationActive = ["queued", "running"].includes(item.operation?.status || "");
            const effectiveStatus = item.evidenceReadiness !== "ready"
              ? "evidence_pending"
              : operationActive ? "pending_revision" : item.reviewStatus;
            const meta = statusMeta[effectiveStatus] || statusMeta.pending_generation;
            return (
              <article key={item.articleTypeVersionId} className="sample-proofing-row">
                <div className="sample-proofing-row-icon"><FileTextOutlined /></div>
                <div className="sample-proofing-row-copy">
                  <Space wrap size={8}>
                    <Typography.Text strong>{item.articleTypeName}</Typography.Text>
                    <Tag color={meta.color}>{meta.text}</Tag>
                    {item.draft ? <Tag>第 {item.draft.versionNumber} 版</Tag> : null}
                  </Space>
                  <Typography.Text>{item.title || "资料补齐后，系统会自动选择一个代表问题。"}</Typography.Text>
                  {operationActive ? <Typography.Text type="secondary">{progressText[item.operation?.progressStage || "queued"] || "正在生成"}</Typography.Text> : null}
                  {item.operation?.error ? <Alert showIcon type="error" message={item.operation.error.message} description={item.operation.error.nextAction} /> : null}
                </div>
                <div>
                  {item.taskId ? (
                    <Link href={`/products/${encodeURIComponent(productId)}/samples/${encodeURIComponent(item.taskId)}`}>
                      <Button type={item.reviewStatus === "pending_review" ? "primary" : "default"}>
                        {item.reviewStatus === "approved" ? "查看已确认版本" : "查看样文"} <ArrowRightOutlined />
                      </Button>
                    </Link>
                  ) : <Button disabled>等待资料</Button>}
                </div>
              </article>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
