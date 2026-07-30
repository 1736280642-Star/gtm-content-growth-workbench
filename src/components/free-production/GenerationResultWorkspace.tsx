"use client";

import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Spin } from "antd";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import { hasCurrentSourceReview, visibleFreeProductionRisks } from "@/lib/v5/free-production-presentation";
import type { SupplementValue } from "./InlineSupplementField";
import { ConfirmAutoPublishButton } from "./ConfirmAutoPublishButton";
import { CitationSourcePanel } from "./CitationSourcePanel";
import { RiskAndGapPanel } from "./RiskAndGapPanel";
import { WechatArticlePreview } from "./WechatArticlePreview";

export function GenerationResultWorkspace({ batch, working, onBack, onRetry, onReviewSources, onSupplements, onPublish }: { batch: FreeProductionBatch; working?: "supplements" | "review-sources" | "publish" | "retry"; onBack: () => void; onRetry: () => void; onReviewSources: () => void; onSupplements: (values: Array<{ riskId: string; value: SupplementValue }>) => void; onPublish: () => void }) {
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  const visibleRisks = visibleFreeProductionRisks(batch);
  return (
    <div className="generation-result-workspace">
      <div className="generation-result-toolbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回内容类型</Button>
        <strong>核对正文、来源与发布准备</strong>
      </div>
      {batch.status === "generation_failed" ? <Alert showIcon type="error" message={batch.failureMessage || "正文生成失败"} description={batch.nextAction} action={<Button icon={<ReloadOutlined />} loading={working === "retry"} onClick={onRetry}>安全重试</Button>} /> : null}
      {batch.status === "compiling" || batch.status === "generating" ? <div className="generation-progress"><Spin /><strong>正在编译表达并生成安全草稿</strong><span>系统自动解析产品、知识、标题、受众、渠道和发布配置。</span></div> : null}
      {artifact ? (
        <>
          <div className="generation-result-columns">
            <WechatArticlePreview artifact={artifact} />
            <aside className="generation-result-side-rail">
              <CitationSourcePanel sources={artifact.sourceExcerpts} reviewed={hasCurrentSourceReview(batch, artifact)} reviewing={working === "review-sources"} onReview={onReviewSources} />
              <section className="publication-prep-panel">
                <div className="citation-source-heading"><span className="v5-kicker">发布准备</span><h2>封面与发布</h2></div>
                <RiskAndGapPanel risks={visibleRisks} saving={working === "supplements"} onSubmit={onSupplements} />
                <ConfirmAutoPublishButton batch={batch} loading={working === "publish"} onConfirm={onPublish} />
              </section>
            </aside>
          </div>
        </>
      ) : batch.status !== "generation_failed" ? <Empty description="正文产物尚未生成" /> : null}
    </div>
  );
}
