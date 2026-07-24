import { Tag } from "antd";
import type { EvidenceReadinessStatus } from "@/lib/v5-ui-mock-data";

const evidenceGateLabels: Record<EvidenceReadinessStatus, string> = {
  ready: "可生成",
  ready_with_auto_downgrade: "自动降级后可生成",
  needs_material: "需补证据",
  needs_review: "需人工确认",
  blocked: "已阻断",
  pending_config: "暂不可生成"
};

const evidenceGateColors: Record<EvidenceReadinessStatus, string> = {
  ready: "green",
  ready_with_auto_downgrade: "cyan",
  needs_material: "orange",
  needs_review: "blue",
  blocked: "red",
  pending_config: "default"
};

export function EvidenceGateTag({ status }: { status: EvidenceReadinessStatus }) {
  return <Tag color={evidenceGateColors[status]}>{evidenceGateLabels[status]}</Tag>;
}
