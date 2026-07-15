import { Card, Tag } from "antd";

interface V5StatusRailItem {
  label: string;
  value: string | number;
  helper: string;
  status?: "demo" | "mock" | "pending_config" | "待接入";
}
export function V5StatusRail({ items }: { items: V5StatusRailItem[] }) {
  return (
    <div className="v5-status-rail">
      {items.map((item) => (
        <Card key={item.label} size="small" className="v5-status-card">
          <div className="v5-status-card-top">
            <span className="v5-status-label">{item.label}</span>
            {item.status ? <Tag>{item.status}</Tag> : null}
          </div>
          <strong className="v5-status-value">{item.value}</strong>
          <span className="v5-status-helper">{item.helper}</span>
        </Card>
      ))}
    </div>
  );
}
