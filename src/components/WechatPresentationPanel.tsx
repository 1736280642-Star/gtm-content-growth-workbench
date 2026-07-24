"use client";

import { CheckOutlined, CloudUploadOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Input, message, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { WechatPresentationState } from "@/lib/v5/wechat-presentation-contracts";

const templateLabels: Record<string, string> = {
  "official-command": "官方指挥型", "official-blueprint": "官方蓝图型", "official-cobalt": "官方钴蓝型", "official-graphite": "官方石墨型",
  "natural-fieldnotes": "自然现场笔记型", "natural-notebook": "自然研究手记型", "natural-column": "自然专栏型", "natural-calm": "自然克制型"
};

export function WechatPresentationPanel({ draftVersionId }: { draftVersionId: string }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [state, setState] = useState<WechatPresentationState>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: WechatPresentationState; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "图文预览读取失败。");
      setState(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图文预览读取失败。");
    } finally { setLoading(false); }
  }, [draftVersionId]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setWorking(true); setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auditReason: "基于人工所选模板生成公众号图文预览" })
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "图文预览生成失败。");
      await load();
      messageApi.success("图文预览已生成并完成 HTML 校验。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图文预览生成失败。"); }
    finally { setWorking(false); }
  }

  async function review(decision: "approved" | "rejected") {
    const artifact = state?.artifact;
    if (!artifact) return;
    setWorking(true); setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId: artifact.artifactId, decision, reason: decision === "rejected" ? rejectReason : "最终图文呈现检查通过" })
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "审核保存失败。");
      await load(); setRejecting(false); setRejectReason("");
      messageApi.success(decision === "approved" ? "最终图文呈现已确认可发布。" : "呈现问题已退回。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审核保存失败。"); }
    finally { setWorking(false); }
  }

  async function publish() {
    setWorking(true); setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation/publish`, { method: "POST" });
      const body = await response.json() as { ok?: boolean; message?: string; error?: { message?: string; nextAction?: string } };
      if (!response.ok || !body.ok) throw new Error([body.error?.message, body.error?.nextAction].filter(Boolean).join(" ") || "公众号草稿写入失败。");
      messageApi.success(body.message || "已写入微信公众号草稿箱。"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "公众号草稿写入失败。"); }
    finally { setWorking(false); }
  }

  const selection = state?.selection;
  const artifact = state?.artifact;

  return (
    <div className="v5-wechat-presentation">
      {contextHolder}
      <div className="v5-wechat-presentation-heading">
        <div><Typography.Title level={5}>图文预览</Typography.Title><Typography.Text type="secondary">使用人工确认的模板合成最终公众号 HTML。</Typography.Text></div>
        {selection ? <Tag color="blue">{templateLabels[selection.selectedTemplateId] || selection.selectedTemplateId}</Tag> : null}
      </div>
      {loading ? <div className="v5-loading-row"><Spin size="small" /><span>正在读取图文预览</span></div> : null}
      {error ? <Alert showIcon type="error" message={error} /> : null}
      {!loading && !selection ? <Alert showIcon type="warning" message="尚未确认排版模板" description="先到“排版模板”页完成选择，系统才会生成图文预览。" /> : null}
      {!loading && selection && !artifact ? <Alert showIcon type="info" message="模板已确认，等待生成图文预览" description="配图节点接入后，已批准图片角色和封面引用会随生成请求一起进入这里。" /> : null}
      {artifact?.reviewStatus === "stale" ? <Alert showIcon type="warning" message="当前图文预览已失效" description="正文、模板或视觉资产发生变化，请重新生成。" /> : null}
      {artifact ? (
        <>
          <div className="v5-wechat-selection-summary">
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
      {rejecting ? <Input.TextArea aria-label="呈现问题" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="填写需要修正的具体问题" autoSize={{ minRows: 3, maxRows: 6 }} maxLength={500} showCount /> : null}
      <Space wrap>
        {selection && (!artifact || artifact.reviewStatus === "stale" || artifact.reviewStatus === "rejected") ? <Button type="primary" icon={<ReloadOutlined />} loading={working} onClick={() => void generate()}>生成图文预览</Button> : null}
        {artifact?.reviewStatus === "pending_review" && artifact.validation.passed ? <Button type="primary" icon={<CheckOutlined />} loading={working} onClick={() => void review("approved")}>确认可发布</Button> : null}
        {artifact?.reviewStatus === "pending_review" && !rejecting ? <Button danger icon={<StopOutlined />} onClick={() => setRejecting(true)}>填写问题退回</Button> : null}
        {rejecting ? <Button danger disabled={!rejectReason.trim()} loading={working} onClick={() => void review("rejected")}>确认退回</Button> : null}
        {rejecting ? <Button onClick={() => setRejecting(false)}>取消</Button> : null}
        {artifact?.reviewStatus === "approved" && artifact.publishStatus !== "draft_created" ? <Button type="primary" icon={<CloudUploadOutlined />} loading={working} onClick={() => void publish()}>写入公众号草稿箱</Button> : null}
      </Space>
    </div>
  );
}
