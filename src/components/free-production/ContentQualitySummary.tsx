"use client";

import { CheckCircleOutlined, InfoCircleOutlined, WarningOutlined } from "@ant-design/icons";
import type { ContentDraftArtifact, FreeProductionBatch } from "@/lib/v5/free-production-contracts";

export function ContentQualitySummary({ batch, artifact }: { batch: FreeProductionBatch; artifact: ContentDraftArtifact }) {
  const blockers = batch.risks.filter((risk) => ["needs_input", "needs_approval", "blocked"].includes(risk.status)).length;
  return (
    <div className="content-quality-summary">
      <span><CheckCircleOutlined /><strong>{artifact.factCheck.supportedClaims.length}</strong> 条事实依据</span>
      <span><WarningOutlined /><strong>{blockers}</strong> 项发布阻断</span>
      <span><InfoCircleOutlined /><strong>{batch.riskAndGapSummary.warning}</strong> 项阅读建议</span>
      <span><strong>v{artifact.version}</strong> 正文版本</span>
    </div>
  );
}
