import {
  CheckCircleFilled,
  CloseCircleFilled,
  PauseCircleFilled,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Button, Card, Tag } from "antd";
import Link from "next/link";
import type { GeoResearchReadiness } from "@/lib/v5/geo-research-contracts";

const statusCopy = {
  ready: { label: "已就绪", icon: <CheckCircleFilled />, color: "green" },
  blocked: { label: "需处理", icon: <CloseCircleFilled />, color: "red" },
  pending_config: { label: "待配置", icon: <PauseCircleFilled />, color: "gold" }
} as const;

export function GeoReadinessPanel({ readiness }: { readiness: GeoResearchReadiness }) {
  return (
    <Card
      bordered={false}
      className="geo-readiness-card"
      title={<span><SafetyCertificateOutlined /> 启动前检查</span>}
      extra={<Tag color={statusCopy[readiness.status].color}>{statusCopy[readiness.status].label}</Tag>}
    >
      <div className="geo-readiness-grid">
        {readiness.checks.map((check) => {
          const meta = statusCopy[check.status];
          return (
            <article className={`geo-readiness-item is-${check.status}`} key={check.key}>
              <span className="geo-readiness-icon">{meta.icon}</span>
              <div>
                <div className="geo-readiness-heading">
                  <strong>{check.label}</strong>
                  <span>{meta.label}</span>
                </div>
                <p>{check.detail}</p>
                {check.missingConfig?.length ? (
                  <div className="geo-config-list">
                    {check.missingConfig.map((field) => <code key={field}>{field}</code>)}
                  </div>
                ) : null}
                {check.actionHref && check.actionLabel ? (
                  <Link href={check.actionHref}><Button size="small">{check.actionLabel}</Button></Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
