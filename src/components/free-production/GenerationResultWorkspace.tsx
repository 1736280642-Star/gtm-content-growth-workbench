"use client";

import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Space, Spin, Tag } from "antd";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import type { SupplementValue } from "./InlineSupplementField";
import { ConfirmAutoPublishButton } from "./ConfirmAutoPublishButton";
import { ContentQualitySummary } from "./ContentQualitySummary";
import { RiskAndGapPanel } from "./RiskAndGapPanel";
import { WechatArticlePreview } from "./WechatArticlePreview";

export function GenerationResultWorkspace({ batch, working, onBack, onRetry, onSupplements, onPublish }: { batch: FreeProductionBatch; working?: "supplements" | "publish" | "retry"; onBack: () => void; onRetry: () => void; onSupplements: (values: Array<{ riskId: string; value: SupplementValue }>) => void; onPublish: () => void }) {
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  return (
    <div className="generation-result-workspace">
      <div className="generation-result-toolbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回表达预设</Button>
        <Space wrap><Tag>{batch.productName}</Tag><Tag color="blue">{batch.monthStart.slice(0, 7)} MonthlyPlan</Tag><Tag>{batch.status}</Tag></Space>
      </div>
      {batch.status === "generation_failed" ? <Alert showIcon type="error" message={batch.failureMessage || "正文生成失败"} description={batch.nextAction} action={<Button icon={<ReloadOutlined />} loading={working === "retry"} onClick={onRetry}>安全重试</Button>} /> : null}
      {batch.status === "compiling" || batch.status === "generating" ? <div className="generation-progress"><Spin /><strong>正在编译表达并生成安全草稿</strong><span>系统自动解析产品、知识、标题、受众、渠道和发布配置。</span></div> : null}
      {artifact ? (
        <>
          <ContentQualitySummary batch={batch} artifact={artifact} />
          <div className="generation-result-columns">
            <WechatArticlePreview artifact={artifact} />
            <RiskAndGapPanel risks={batch.risks} saving={working === "supplements"} onSubmit={onSupplements} />
          </div>
          <ConfirmAutoPublishButton batch={batch} loading={working === "publish"} onConfirm={onPublish} />
        </>
      ) : batch.status !== "generation_failed" ? <Empty description="正文产物尚未生成" /> : null}
    </div>
  );
}
