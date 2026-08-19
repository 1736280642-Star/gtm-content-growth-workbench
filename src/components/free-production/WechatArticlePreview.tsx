"use client";

import { EditOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Select, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import type { ContentDraftArtifact } from "@/lib/v5/free-production-contracts";
import { WECHAT_LAYOUT_TEMPLATES } from "@/lib/v5/wechat-layout-selector";
import type { WechatRenderableTemplateId } from "@/lib/v5/wechat-presentation-contracts";
import { VisualSuggestionPlaceholder } from "./VisualSuggestionPlaceholder";
import { VisualAssetBindingPanel } from "./VisualAssetBindingPanel";
import { WechatCoverBindingPanel, type WechatCoverFile } from "./WechatCoverBindingPanel";

const layoutOptions = [
  { label: "品牌排版", options: [{ value: "joto-official-v1", label: "JOTO 官方排版" }] },
  { label: "官方风格", options: WECHAT_LAYOUT_TEMPLATES.filter((item) => item.family === "official").map((item) => ({ value: item.templateId, label: item.name })) },
  { label: "自然风格", options: WECHAT_LAYOUT_TEMPLATES.filter((item) => item.family === "natural").map((item) => ({ value: item.templateId, label: item.name })) }
];

const layoutNames = new Map(layoutOptions.flatMap((group) => group.options.map((item) => [item.value, item.label] as const)));

function bodyWithoutTitle(artifact: ContentDraftArtifact) {
  return artifact.articleBody.replace(/\r\n?/g, "\n").trim().replace(/^#\s+[^\n]+\n+/, "");
}

export function WechatArticlePreview({
  artifact,
  productId,
  batchId,
  batchVersion,
  coverRisk,
  changingLayout,
  savingContent,
  savingCover,
  locked,
  onChangeLayout,
  onEditContent,
  onBindVisual,
  onSaveCover
}: {
  artifact: ContentDraftArtifact;
  productId: string;
  batchId?: string;
  batchVersion?: number;
  coverRisk?: import("@/lib/v5/free-production-contracts").RiskAndGapItem;
  changingLayout?: boolean;
  savingContent?: boolean;
  savingCover?: boolean;
  locked?: boolean;
  onChangeLayout: (templateId: WechatRenderableTemplateId) => Promise<void>;
  onEditContent: (input: { title: string; summary: string; articleBody: string }) => Promise<void>;
  onBindVisual: (suggestionId: string, mediaAssetId?: string) => Promise<void>;
  onSaveCover?: (file: WechatCoverFile) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(artifact.selectedTitle);
  const [summary, setSummary] = useState(artifact.summary);
  const [articleBody, setArticleBody] = useState(bodyWithoutTitle(artifact));
  useEffect(() => {
    if (editing) return;
    setTitle(artifact.selectedTitle);
    setSummary(artifact.summary);
    setArticleBody(bodyWithoutTitle(artifact));
  }, [artifact, editing]);

  async function saveContent() {
    await onEditContent({ title: title.trim(), summary: summary.trim(), articleBody: articleBody.trim() });
    setEditing(false);
  }

  if (artifact.wechatPresentation) {
    const templateId = artifact.wechatPresentation.templateId;
    return (
      <article className="wechat-official-preview" aria-label="微信公众号正式 HTML 预览">
        <div className="wechat-official-preview-meta">
          <div className="wechat-layout-picker">
            <Typography.Text type="secondary">排版风格</Typography.Text>
            <Select
              aria-label="选择公众号排版风格"
              value={templateId}
              options={layoutOptions}
              loading={changingLayout}
              disabled={changingLayout}
              popupMatchSelectWidth={260}
              onChange={(value) => void onChangeLayout(value as WechatRenderableTemplateId)}
            />
          </div>
          <Space size={8} wrap>
            <strong>{layoutNames.get(templateId) || templateId}</strong>
            <span>预览与写入公众号草稿箱使用同一排版。</span>
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(true)}>编辑正文</Button>
          </Space>
        </div>
        {batchId && batchVersion !== undefined && onSaveCover
          ? <WechatCoverBindingPanel batchId={batchId} batchVersion={batchVersion} coverRisk={coverRisk} saving={savingCover} locked={locked} onSave={onSaveCover} />
          : null}
        <VisualAssetBindingPanel suggestions={artifact.visualSuggestions} productId={productId} onBind={onBindVisual} />
        <iframe
          className="wechat-official-preview-frame"
          title={`${artifact.selectedTitle}的公众号排版预览`}
          srcDoc={artifact.wechatPresentation.previewHtml}
          sandbox=""
        />
        <Modal
          title="编辑公众号正文"
          open={editing}
          width={860}
          okText="保存并更新预览"
          cancelText="取消"
          confirmLoading={savingContent}
          okButtonProps={{ disabled: !title.trim() || !articleBody.trim() }}
          onOk={() => void saveContent()}
          onCancel={() => { if (!savingContent) setEditing(false); }}
          destroyOnClose={false}
        >
          <div className="wechat-content-editor">
            <label><span>标题</span><Input value={title} maxLength={120} showCount onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>摘要</span><Input.TextArea value={summary} maxLength={300} showCount autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => setSummary(event.target.value)} /></label>
            <label><span>正文（Markdown，不含标题）</span><Input.TextArea value={articleBody} maxLength={100000} showCount autoSize={{ minRows: 18, maxRows: 30 }} onChange={(event) => setArticleBody(event.target.value)} /></label>
            <Typography.Text type="secondary">保存后会重新生成当前风格的预览与正式发布 HTML，并要求重新核对来源。</Typography.Text>
          </div>
        </Modal>
      </article>
    );
  }

  return (
    <article className="wechat-article-preview" aria-label="公众号排版预览">
      <div className="wechat-brand-bar"><span>JOTO AI</span><em>让 AI 进入真实工作流</em></div>
      <header><h1>{artifact.selectedTitle}</h1><p>{artifact.summary}</p></header>
      <div className="wechat-article-body">
        {artifact.sections.map((section, index) => {
          const suggestion = artifact.visualSuggestions.find((item) => item.placementAnchor === section.sectionKey && !item.boundAssetRef);
          return (
            <section key={section.sectionKey}>
              <span className="wechat-section-index">{String(index + 1).padStart(2, "0")}</span>
              <h2>{section.heading}</h2>
              {section.markdown.split(/\n{2,}/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph.replace(/^#+\s*/, "")}</p>)}
              {suggestion ? <VisualSuggestionPlaceholder suggestion={suggestion} /> : null}
            </section>
          );
        })}
      </div>
      <footer><strong>JOTO</strong><p>AI 承担重复、机械、耗时工作，人保留专业判断和最终决策权。</p></footer>
    </article>
  );
}
