import { Card } from "antd";

interface V5StatusRailItem {
  label: string;
  value: string | number;
  helper: string;
}
export function V5StatusRail({ items }: { items: V5StatusRailItem[] }) {
  return (
    <div className="v5-status-rail">
      {items.map((item) => (
        <Card key={item.label} size="small" className="v5-status-card">
          <div className="v5-status-card-top">
            <span className="v5-status-label">{item.label}</span>
          </div>
          <strong className="v5-status-value">{item.value}</strong>
          <span className="v5-status-helper">{item.helper}</span>
        </Card>
      ))}
    </div>
  );
}
