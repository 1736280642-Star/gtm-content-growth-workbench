"use client";

import { SendOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";

export function ConfirmAutoPublishButton({ batch, loading, onConfirm }: { batch: FreeProductionBatch; loading?: boolean; onConfirm: () => void }) {
  const blockers = batch.risks.filter((risk) => ["needs_input", "needs_approval", "blocked"].includes(risk.status));
  const enabled = batch.status === "ready_for_confirmation" && blockers.length === 0 && Boolean(batch.currentDraftArtifactId);
  return (
    <div className="confirm-publish-action">
      <div><strong>自动发布：{batch.channelConfig.channel === "wechat_official_account" ? "公众号" : batch.channelConfig.channel === "zhihu" ? "知乎" : "官网"}</strong><span>{enabled ? "当前正文与风险快照已就绪" : blockers.length ? `还有 ${blockers.length} 项发布阻断` : "正文尚未通过完整检查"}</span></div>
      <Button type="primary" size="large" icon={<SendOutlined />} loading={loading} disabled={!enabled} onClick={onConfirm}>确认并自动发布</Button>
    </div>
  );
}
