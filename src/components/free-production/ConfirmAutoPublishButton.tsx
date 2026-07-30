"use client";

import { SendOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import { blockingFreeProductionRisks, freeProductionStatusPresentation, hasCitationCoverage, hasCurrentSourceReview } from "@/lib/v5/free-production-presentation";

export function ConfirmAutoPublishButton({ batch, loading, onConfirm }: { batch: FreeProductionBatch; loading?: boolean; onConfirm: () => void }) {
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  const blockers = blockingFreeProductionRisks(batch);
  const status = freeProductionStatusPresentation(batch);
  const enabled = batch.status === "ready_for_confirmation" && blockers.length === 0 && hasCitationCoverage(artifact) && hasCurrentSourceReview(batch, artifact);
  return (
    <div className="confirm-publish-action">
      <div><strong>自动发布：{batch.channelConfig.channel === "wechat_official_account" ? "公众号" : batch.channelConfig.channel === "zhihu" ? "知乎" : "官网"}</strong><span>{enabled ? "当前正文、来源与封面已就绪" : status.nextAction}</span></div>
      <Button type="primary" size="large" icon={<SendOutlined />} loading={loading} disabled={!enabled} onClick={onConfirm}>确认并自动发布</Button>
    </div>
  );
}
