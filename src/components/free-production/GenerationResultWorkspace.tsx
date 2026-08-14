"use client";

import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Spin } from "antd";
import { useEffect, useState } from "react";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import type { WechatRenderableTemplateId } from "@/lib/v5/wechat-presentation-contracts";
import type { SupplementValue } from "./InlineSupplementField";
import { ConfirmAutoPublishButton } from "./ConfirmAutoPublishButton";
import { CitationSourcePanel } from "./CitationSourcePanel";
import { RiskAndGapPanel } from "./RiskAndGapPanel";
import { WechatArticlePreview } from "./WechatArticlePreview";
import { WechatPublishAccountBar } from "./WechatPublishAccountBar";

export function GenerationResultWorkspace({ batch, working, hotspotError, onBack, onRetry, onSupplements, onChangeLayout, onEditContent, onBindVisual, onIntegrateHotspot, onRestorePreviousVersion, onPublish }: { batch: FreeProductionBatch; working?: "supplements" | "visual" | "layout" | "content" | "hotspot" | "restore" | "publish" | "retry"; hotspotError?: string; onBack: () => void; onRetry: () => void; onSupplements: (values: Array<{ riskId: string; value: SupplementValue }>) => void; onChangeLayout: (artifactId: string, templateId: WechatRenderableTemplateId) => Promise<void>; onEditContent: (artifactId: string, input: { title: string; summary: string; articleBody: string }) => Promise<void>; onBindVisual: (artifactId: string, suggestionId: string, mediaAssetId?: string) => Promise<void>; onIntegrateHotspot: (artifactId: string, mode: "integrate" | "replace") => Promise<void>; onRestorePreviousVersion: (artifactId: string) => Promise<void>; onPublish: () => void }) {
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  const [step, setStep] = useState<"sources" | "publish">("sources");
  useEffect(() => setStep("sources"), [artifact?.id]);
  return (
    <div className="generation-result-workspace">
      <div className="generation-result-toolbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回内容类型</Button>
        <strong>{step === "sources" ? "核对正文与来源" : "补充封面并发布"}</strong>
      </div>
      {batch.status === "generation_failed" ? <Alert showIcon type="error" message={batch.failureMessage || "正文生成失败"} description={batch.nextAction} action={<Button icon={<ReloadOutlined />} loading={working === "retry"} onClick={onRetry}>安全重试</Button>} /> : null}
      {batch.status === "compiling" || batch.status === "generating" ? <div className="generation-progress"><Spin /><strong>正在编译表达并生成安全草稿</strong><span>系统自动解析产品、知识、标题、受众、渠道和发布配置。</span></div> : null}
      {artifact ? (
        <>
          {batch.channelConfig.channel === "wechat_official_account" ? <WechatPublishAccountBar batch={batch} publishing={working === "publish"} onPublish={onPublish} /> : null}
          <div className="generation-result-columns">
            <WechatArticlePreview artifact={artifact} productId={batch.productId} hotspotError={hotspotError} changingLayout={working === "layout"} savingContent={working === "content"} integratingHotspot={working === "hotspot"} restoringVersion={working === "restore"} hotspotLocked={["publishing", "published", "cancelled"].includes(batch.status)} onChangeLayout={(templateId) => onChangeLayout(artifact.id, templateId)} onEditContent={(input) => onEditContent(artifact.id, input)} onBindVisual={(suggestionId, mediaAssetId) => onBindVisual(artifact.id, suggestionId, mediaAssetId)} onIntegrateHotspot={() => onIntegrateHotspot(artifact.id, artifact.hotspotIntegration ? "replace" : "integrate")} onRestorePreviousVersion={() => onRestorePreviousVersion(artifact.id)} />
            {step === "sources" ? <CitationSourcePanel sources={artifact.sourceExcerpts} onContinue={() => setStep("publish")} /> : <aside className="publication-prep-panel"><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setStep("sources")}>返回引用来源</Button><RiskAndGapPanel risks={batch.risks} saving={working === "supplements"} onSubmit={onSupplements} />{batch.channelConfig.channel !== "wechat_official_account" ? <ConfirmAutoPublishButton batch={batch} loading={working === "publish"} onConfirm={onPublish} /> : null}</aside>}
          </div>
        </>
      ) : batch.status !== "generation_failed" ? <Empty description="正文产物尚未生成" /> : null}
    </div>
  );
}
