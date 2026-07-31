"use client";

import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Spin } from "antd";
import { useEffect, useState } from "react";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import type { SupplementValue } from "./InlineSupplementField";
import { ConfirmAutoPublishButton } from "./ConfirmAutoPublishButton";
import { CitationSourcePanel } from "./CitationSourcePanel";
import { RiskAndGapPanel } from "./RiskAndGapPanel";
import { WechatArticlePreview } from "./WechatArticlePreview";

export function GenerationResultWorkspace({ batch, working, onBack, onRetry, onSupplements, onPublish }: { batch: FreeProductionBatch; working?: "supplements" | "publish" | "retry"; onBack: () => void; onRetry: () => void; onSupplements: (values: Array<{ riskId: string; value: SupplementValue }>) => void; onPublish: () => void }) {
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
          <div className="generation-result-columns">
            <WechatArticlePreview artifact={artifact} />
            {step === "sources" ? <CitationSourcePanel sources={artifact.sourceExcerpts} onContinue={() => setStep("publish")} /> : <aside className="publication-prep-panel"><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setStep("sources")}>返回引用来源</Button><RiskAndGapPanel risks={batch.risks} saving={working === "supplements"} onSubmit={onSupplements} /><ConfirmAutoPublishButton batch={batch} loading={working === "publish"} onConfirm={onPublish} /></aside>}
          </div>
        </>
      ) : batch.status !== "generation_failed" ? <Empty description="正文产物尚未生成" /> : null}
    </div>
  );
}
