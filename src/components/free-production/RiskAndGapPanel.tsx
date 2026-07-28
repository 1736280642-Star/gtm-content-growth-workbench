"use client";

import { CheckCircleOutlined, ExclamationCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Tag } from "antd";
import { useMemo, useState } from "react";
import type { RiskAndGapItem } from "@/lib/v5/free-production-contracts";
import { InlineSupplementField, type SupplementValue } from "./InlineSupplementField";

const statusMeta: Record<string, { label: string; color: string }> = {
  ready: { label: "已补齐", color: "success" },
  needs_input: { label: "待补充", color: "warning" },
  needs_approval: { label: "待授权", color: "orange" },
  warning: { label: "请知悉", color: "blue" },
  blocked: { label: "阻断发布", color: "error" }
};

export function RiskAndGapPanel({ risks, saving, onSubmit }: { risks: RiskAndGapItem[]; saving?: boolean; onSubmit: (supplements: Array<{ riskId: string; value: SupplementValue }>) => void }) {
  const [values, setValues] = useState<Record<string, SupplementValue>>({});
  const actionable = useMemo(() => risks.filter((risk) => ["needs_input", "needs_approval", "blocked"].includes(risk.status) && risk.inputSchema), [risks]);
  const readyToSubmit = actionable.some((risk) => {
    const value = values[risk.id];
    return typeof value === "string" ? Boolean(value.trim()) : Boolean(value?.dataBase64);
  });
  return (
    <aside className="risk-gap-panel">
      <div className="risk-gap-heading"><div><span className="v5-kicker">发布门禁</span><h2>风险与缺失项</h2></div><strong>{actionable.length}</strong></div>
      {!risks.length ? <Alert showIcon type="success" icon={<SafetyCertificateOutlined />} message="检查已通过" /> : null}
      <div className="risk-gap-list">
        {risks.map((risk) => (
          <section className={`risk-gap-item is-${risk.status}`} key={risk.id}>
            <div><span>{risk.status === "ready" ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}</span><div><strong>{risk.title}</strong><p>{risk.reason}</p></div><Tag color={statusMeta[risk.status]?.color}>{statusMeta[risk.status]?.label}</Tag></div>
            {["needs_input", "needs_approval", "blocked"].includes(risk.status) && risk.inputSchema ? <InlineSupplementField risk={risk} value={values[risk.id]} onChange={(value) => setValues((current) => ({ ...current, [risk.id]: value }))} /> : null}
          </section>
        ))}
      </div>
      {actionable.length ? <Button block type="primary" loading={saving} disabled={!readyToSubmit} onClick={() => onSubmit(actionable.flatMap((risk) => values[risk.id] ? [{ riskId: risk.id, value: values[risk.id] }] : []))}>提交并重新检查</Button> : null}
    </aside>
  );
}
