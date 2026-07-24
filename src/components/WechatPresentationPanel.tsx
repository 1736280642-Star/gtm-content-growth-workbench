"use client";

import { CheckOutlined, CloudUploadOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Input, message, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { WechatPresentationArtifact } from "@/lib/v5/wechat-presentation-contracts";

const templateLabels: Record<string, string> = {
  "official-command": "官方指令型",
  "official-blueprint": "官方蓝图型",
  "official-cobalt": "官方钴蓝型",
  "official-graphite": "官方石墨型",
  "natural-fieldnotes": "自然田野笔记型",
  "natural-notebook": "自然手记型",
  "natural-column": "自然专栏型",
  "natural-calm": "自然克制型"
};

export function WechatPresentationPanel({ draftVersionId }: { draftVersionId: string }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [artifact, setArtifact] = useState<WechatPresentationArtifact>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: WechatPresentationArtifact | null; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "公众号呈现读取失败。");
      setArtifact(body.data || undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公众号呈现读取失败。");
    } finally {
      setLoading(false);
    }
  }, [draftVersionId]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auditReason: "从正文预览运行公众号自动排版" })
      });
      const body = await response.json() as { ok?: boolean; data?: WechatPresentationArtifact; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "公众号自动排版失败。");
      setArtifact(body.data);
      messageApi.success("系统已完成模板选择和 HTML 校验。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公众号自动排版失败。");
    } finally {
      setWorking(false);
    }
  }

  async function review(decision: "approved" | "rejected") {
    if (!artifact) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId: artifact.artifactId, decision, reason: decision === "rejected" ? rejectReason : "最终呈现检查通过" })
      });
      const body = await response.json() as { ok?: boolean; data?: WechatPresentationArtifact; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "审核保存失败。");
      setArtifact(body.data);
      setRejecting(false);
      setRejectReason("");
      messageApi.success(decision === "approved" ? "最终呈现已确认可发布。" : "问题已退回规则治理队列。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核保存失败。");
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation/publish`, { method: "POST" });
      const body = await response.json() as { ok?: boolean; message?: string; error?: { message?: string; nextAction?: string } };
      if (!response.ok || !body.ok) throw new Error([body.error?.message, body.error?.nextAction].filter(Boolean).join(" ") || "公众号草稿写入失败。");
      messageApi.success(body.message || "已写入微信公众号草稿箱。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公众号草稿写入失败。");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="v5-wechat-presentation" aria-labelledby="wechat-presentation-heading">
      {contextHolder}
      <div className="v5-wechat-presentation-heading">
        <div>
          <Typography.Title level={5} id="wechat-presentation-heading">公众号呈现</Typography.Title>
          <Typography.Text type="secondary">系统自动选择唯一最优排版，人工只确认最终呈现。</Typography.Text>
        </div>
        {artifact?.templateId ? <Tag color="blue">{templateLabels[artifact.templateId] || artifact.templateId}</Tag> : null}
      </div>

      {loading ? <div className="v5-loading-row"><Spin size="small" /><span>正在读取公众号呈现</span></div> : null}
      {error ? <Alert showIcon type="error" message={error} /> : null}
      {!loading && !artifact ? <Alert showIcon type="info" message="尚未生成公众号呈现" description="运行后系统会按内容类型、受众、结构、CTA 和已批准视觉资产自动确定排版。" /> : null}
      {artifact?.selectionStatus === "selection_blocked" ? <Alert showIcon type="warning" message="自动选版已阻断" description={artifact.businessReason} /> : null}
      {artifact?.reviewStatus === "stale" ? <Alert showIcon type="warning" message="当前呈现已失效" description="正文或规则状态已变化，请基于最新正文重新运行自动排版。" /> : null}
      {artifact?.selectionStatus === "selected" ? (
        <>
          <div className="v5-wechat-selection-summary">
            <Typography.Text strong>系统选择依据</Typography.Text>
            <Typography.Paragraph>{artifact.businessReason}</Typography.Paragraph>
            <Space wrap>
              <Tag color={artifact.validation.passed ? "green" : "red"}>{artifact.validation.passed ? "HTML 校验通过" : "HTML 校验失败"}</Tag>
              <Tag color={artifact.reviewStatus === "approved" ? "green" : artifact.reviewStatus === "rejected" ? "red" : "default"}>
                {artifact.reviewStatus === "approved" ? "已确认可发布" : artifact.reviewStatus === "rejected" ? "已退回" : "待最终审核"}
              </Tag>
              {artifact.publishStatus === "draft_created" ? <Tag color="green">已写入公众号草稿箱</Tag> : null}
            </Space>
          </div>
          {artifact.html ? <iframe className="v5-wechat-mobile-preview" title="公众号手机预览" sandbox="" srcDoc={artifact.html} /> : null}
        </>
      ) : null}

      {rejecting ? <Input.TextArea aria-label="呈现问题" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="填写具体问题，系统将按规则修正后重跑" autoSize={{ minRows: 3, maxRows: 6 }} maxLength={500} showCount /> : null}
      <Space wrap>
        {(!artifact || artifact.reviewStatus === "stale" || artifact.reviewStatus === "rejected" || artifact.selectionStatus === "selection_blocked")
          ? <Button type="primary" icon={<ReloadOutlined />} loading={working} onClick={() => void generate()}>系统自动排版</Button>
          : null}
        {artifact?.reviewStatus === "pending_review" && artifact.validation.passed
          ? <Button type="primary" icon={<CheckOutlined />} loading={working} onClick={() => void review("approved")}>确认可发布</Button>
          : null}
        {artifact?.reviewStatus === "pending_review" && !rejecting
          ? <Button danger icon={<StopOutlined />} onClick={() => setRejecting(true)}>填写问题退回</Button>
          : null}
        {rejecting ? <Button danger disabled={!rejectReason.trim()} loading={working} onClick={() => void review("rejected")}>确认退回</Button> : null}
        {rejecting ? <Button onClick={() => setRejecting(false)}>取消</Button> : null}
        {artifact?.reviewStatus === "approved" && artifact.publishStatus !== "draft_created"
          ? <Button type="primary" icon={<CloudUploadOutlined />} loading={working} onClick={() => void publish()}>写入公众号草稿箱</Button>
          : null}
      </Space>
    </section>
  );
}
