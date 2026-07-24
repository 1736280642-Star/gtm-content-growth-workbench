"use client";

import { CheckOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Input, message, Modal, Radio, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WechatLayoutFamily,
  WechatLayoutTemplateOption,
  WechatTemplateSelection,
  WechatTemplateWorkspace
} from "@/lib/v5/wechat-presentation-contracts";

function TemplateChoice({
  template,
  recommended,
  selected,
  onPreview
}: {
  template: WechatLayoutTemplateOption;
  recommended: boolean;
  selected: boolean;
  onPreview: () => void;
}) {
  return (
    <label className={`v5-wechat-template-choice${selected ? " is-selected" : ""}`}>
      <div className="v5-wechat-template-choice-toolbar">
        <Radio value={template.templateId}>{template.name}</Radio>
        <Space size={6}>
          {recommended ? <Tag color="blue">系统推荐</Tag> : null}
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={(event) => { event.preventDefault(); onPreview(); }}>放大</Button>
        </Space>
      </div>
      <div className="v5-wechat-template-thumbnail" aria-hidden="true">
        <iframe title={`${template.name}缩略预览`} sandbox="" loading="lazy" tabIndex={-1} srcDoc={template.previewHtml} />
      </div>
      <Typography.Text>{template.description}</Typography.Text>
      <Typography.Text type="secondary">适合：{template.bestFor}</Typography.Text>
    </label>
  );
}

export function WechatTemplateSelectionPanel({ draftVersionId }: { draftVersionId: string }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [workspace, setWorkspace] = useState<WechatTemplateWorkspace>();
  const [choice, setChoice] = useState("");
  const [selectionReason, setSelectionReason] = useState("");
  const [preview, setPreview] = useState<WechatLayoutTemplateOption>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingIdempotency = useRef<{ fingerprint: string; key: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation/templates`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: WechatTemplateWorkspace; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "排版模板读取失败。");
      setWorkspace(body.data);
      setChoice(body.data.selection?.selectedTemplateId || body.data.recommendation.recommendedTemplateId || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "排版模板读取失败。");
    } finally {
      setLoading(false);
    }
  }, [draftVersionId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const groups: Record<WechatLayoutFamily, WechatLayoutTemplateOption[]> = { official: [], natural: [] };
    workspace?.templates.forEach((template) => groups[template.family].push(template));
    return groups;
  }, [workspace]);

  async function confirmSelection() {
    if (!workspace || !choice) return;
    setSaving(true);
    setError("");
    try {
      const fingerprint = `${workspace.sourceContentHash}:${choice}:${selectionReason}`;
      if (pendingIdempotency.current?.fingerprint !== fingerprint) {
        pendingIdempotency.current = {
          fingerprint,
          key: `wechat-template:${crypto.randomUUID()}`
        };
      }
      const idempotencyKey = pendingIdempotency.current.key;
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/wechat-presentation/selection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: choice, selectionReason, idempotencyKey })
      });
      const body = await response.json() as { ok?: boolean; data?: WechatTemplateSelection; message?: string; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "模板确认失败。");
      setWorkspace((current) => current ? { ...current, selection: body.data } : current);
      pendingIdempotency.current = undefined;
      messageApi.success(body.message || "公众号排版模板已确认。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模板确认失败。");
    } finally {
      setSaving(false);
    }
  }

  const currentSelection = workspace?.selection?.selectedTemplateId;
  const changed = Boolean(choice && choice !== currentSelection);
  const recommended = workspace?.recommendation.recommendedTemplateId;

  return (
    <div className="v5-wechat-template-workspace">
      {contextHolder}
      <div className="v5-wechat-template-intro">
        <div>
          <Typography.Title level={5}>选择公众号排版模板</Typography.Title>
          <Typography.Text type="secondary">系统只提供建议，必须由你确认后才会生成图文预览。</Typography.Text>
        </div>
        {workspace?.selection ? <Tag color="green" icon={<CheckOutlined />}>已人工确认</Tag> : <Tag color="gold">待选择</Tag>}
      </div>
      {loading ? <div className="v5-loading-row"><Spin size="small" /><span>正在准备 8 个模板预览</span></div> : null}
      {error ? <Alert showIcon type="error" message={error} action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>} /> : null}
      {workspace ? <Alert showIcon type="info" message={recommended ? "系统推荐已放在首位" : "本篇没有稳定推荐"} description={workspace.recommendation.businessReason} /> : null}
      {workspace ? (
        <Radio.Group className="v5-wechat-template-radio-group" value={choice} onChange={(event) => setChoice(event.target.value)}>
          {(["official", "natural"] as const).map((family) => (
            <section key={family} className="v5-wechat-template-family" aria-labelledby={`wechat-template-${family}`}>
              <div className="v5-wechat-template-family-heading">
                <Typography.Title level={5} id={`wechat-template-${family}`}>{family === "official" ? "官方风格" : "自然风格"}</Typography.Title>
                <Typography.Text type="secondary">{family === "official" ? "正式、品牌化、层级清晰" : "自然、连续、弱推广表达"}</Typography.Text>
              </div>
              <div className="v5-wechat-template-grid">
                {grouped[family].map((template) => (
                  <TemplateChoice
                    key={template.templateId}
                    template={template}
                    recommended={template.templateId === recommended}
                    selected={template.templateId === choice}
                    onPreview={() => setPreview(template)}
                  />
                ))}
              </div>
            </section>
          ))}
        </Radio.Group>
      ) : null}
      {workspace && choice && choice !== recommended ? (
        <Input.TextArea aria-label="模板选择说明" value={selectionReason} onChange={(event) => setSelectionReason(event.target.value)} placeholder="选择说明（可选）" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} showCount />
      ) : null}
      {workspace ? (
        <Space wrap>
          <Button type="primary" icon={<CheckOutlined />} disabled={!choice || (!changed && Boolean(currentSelection))} loading={saving} onClick={() => void confirmSelection()}>
            {currentSelection ? "确认更换模板" : "确认使用所选模板"}
          </Button>
          {workspace.selection ? <Typography.Text type="secondary">当前已选：{workspace.templates.find((item) => item.templateId === currentSelection)?.name}</Typography.Text> : null}
        </Space>
      ) : null}
      <Modal title={preview?.name || "模板预览"} open={Boolean(preview)} footer={null} width={760} onCancel={() => setPreview(undefined)} destroyOnClose>
        {preview ? <iframe className="v5-wechat-template-large-preview" title={`${preview.name}放大预览`} sandbox="" srcDoc={preview.previewHtml} /> : null}
      </Modal>
    </div>
  );
}
