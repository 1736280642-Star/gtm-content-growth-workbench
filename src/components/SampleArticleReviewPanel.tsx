"use client";

import { CheckOutlined, SendOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import type { SampleArticleFeedbackInput, SampleArticleReviewState } from "@/lib/v5/sample-calibration-contracts";

export function SampleArticleReviewPanel({
  draftVersionId,
  onUpdated
}: {
  draftVersionId: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<SampleArticleReviewState>();
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState<"approve" | "revise">();
  const [messageApi, holder] = message.useMessage();

  useEffect(() => {
    void fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/sample-review`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setState(body.data));
  }, [draftVersionId]);

  if (!state?.eligible) return null;

  async function submit(decision: SampleArticleFeedbackInput["decision"]) {
    const revisionInstruction = instruction.trim();
    if (decision === "changes_requested" && !revisionInstruction) {
      messageApi.warning("请先写下希望模型如何修改这篇文章。");
      return;
    }
    setLoading(decision === "approved" ? "approve" : "revise");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/sample-review`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `sample-${draftVersionId}-${crypto.randomUUID()}` },
        body: JSON.stringify({ decision, ...(revisionInstruction ? { revisionInstruction } : {}) })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "样文操作失败");
      if (decision === "approved") {
        messageApi.success(body.data.strategyReady ? "这篇样文已确认，全部样文验收完成。" : "这篇样文已确认。");
      } else {
        setInstruction("");
        messageApi.success("修改要求已发送，系统正在生成新版本。");
      }
      await onUpdated?.();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "样文操作失败");
    } finally {
      setLoading(undefined);
    }
  }

  if (state.reviewStatus === "approved") {
    return <Alert showIcon type="success" message="这篇样文已确认" description="系统已将最终版本冻结为当前文章类型的批量写作参考。" />;
  }

  return (
    <div className="sample-review-composer">
      {holder}
      <div>
        <Typography.Title level={5}>想修改哪里？直接告诉模型</Typography.Title>
        <Typography.Text type="secondary">不用打分，也不用判断问题类型。事实与身份规则仍由系统自动校验。</Typography.Text>
      </div>
      <Input.TextArea
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        rows={4}
        maxLength={1200}
        showCount
        placeholder="例如：开头太官方，先从企业负责人真实遇到的效率困境写起；减少清单，多用连贯叙述。"
      />
      <Space wrap className="sample-review-actions">
        <Button
          icon={<SendOutlined />}
          disabled={!instruction.trim()}
          loading={loading === "revise"}
          onClick={() => void submit("changes_requested")}
        >
          按要求重新生成
        </Button>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={loading === "approve"}
          onClick={() => void submit("approved")}
        >
          确认这篇样文
        </Button>
      </Space>
    </div>
  );
}
