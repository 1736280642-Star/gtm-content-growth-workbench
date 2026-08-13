"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Spin, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import { SampleArticleReviewPanel } from "@/components/SampleArticleReviewPanel";
import { callJsonApi } from "@/lib/client-api";

interface ProductSampleState {
  taskId: string;
  strategyPackId: string;
  taskStatus: string;
  taskTitle: string;
  articleTypeVersionId: string;
  operationStatus?: string;
  error?: { code: string; message: string; nextAction: string };
  draft?: {
    draftVersionId: string;
    title: string;
    markdown: string;
    copyAllowed: boolean;
    hardRuleResult: { passed?: boolean; traceableFactCount?: number; blockers?: string[] };
    createdAt: string;
  };
}

export function ProductSampleArticlePanel({ productId }: { productId: string }) {
  const [state, setState] = useState<ProductSampleState | null>();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [messageApi, holder] = message.useMessage();

  const refresh = useCallback(async () => {
    try {
      const body = await callJsonApi<{ ok: true; data: ProductSampleState | null }>(
        `/api/v5/products/${encodeURIComponent(productId)}/sample-article`,
        { cache: "no-store" }
      );
      setState(body.data);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener("product-sample-updated", listener);
    return () => window.removeEventListener("product-sample-updated", listener);
  }, [refresh]);

  async function generate() {
    setGenerating(true);
    try {
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/sample-article`, {
        method: "POST",
        headers: { "x-idempotency-key": `product-sample-retry:${state?.strategyPackId || productId}:${crypto.randomUUID()}` }
      });
      messageApi.success("示例正文已生成");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "示例正文生成失败");
      await refresh();
    } finally {
      setGenerating(false);
    }
  }

  if (loading && state === undefined) return <Card bordered={false}><Spin /> 正在读取示例正文状态</Card>;
  if (!state) return null;

  return (
    <Card
      bordered={false}
      title="公众号示例正文"
      extra={<Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>}
    >
      {holder}
      {state.error ? (
        <Alert
          showIcon
          type="error"
          message={state.error.message}
          description={state.error.nextAction}
          action={<Button type="primary" loading={generating} onClick={() => void generate()}>修复后重试生成</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!state.draft && !state.error ? (
        <Alert
          showIcon
          type="info"
          message="策略已确认，示例正文正在生成"
          description="系统正在冻结证据包、生产合同并执行正文硬规则检查。"
          action={<Button loading={generating} onClick={() => void generate()}>立即检查并生成</Button>}
        />
      ) : null}
      {state.draft ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            showIcon
            type={state.draft.copyAllowed && state.draft.hardRuleResult.passed ? "success" : "warning"}
            message="只验收内容质量，样稿不会进入真实发布"
            description="通过验收后，系统会冻结你的表达偏好；随后生成的批量正式正文才可进入账号绑定与发布准入。"
          />
          <Space wrap>
            <Tag color={state.draft.copyAllowed ? "green" : "gold"}>{state.draft.copyAllowed ? "系统检查通过" : "等待系统检查"}</Tag>
            <Tag>可追溯事实 {state.draft.hardRuleResult.traceableFactCount || 0} 条</Tag>
            <Typography.Text type="secondary">{new Date(state.draft.createdAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text>
          </Space>
          <Card size="small" title={state.draft.title} className="v5-draft-preview">
            <MarkdownArticle markdown={state.draft.markdown} />
          </Card>
          <SampleArticleReviewPanel draftVersionId={state.draft.draftVersionId} />
        </Space>
      ) : null}
    </Card>
  );
}
