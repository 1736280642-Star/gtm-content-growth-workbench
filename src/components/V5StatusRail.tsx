interface V5StatusRailItem {
  label: string;
  value: string | number;
  helper: string;
}
export function V5StatusRail({ items }: { items: V5StatusRailItem[] }) {
  return (
    <div className="v5-status-rail" role="status" aria-label="当前步骤状态摘要">
      {items.map((item) => (
        <div key={item.label} className="v5-status-card" title={item.helper}>
          <span className="v5-status-label">{item.label}</span>
          <strong className="v5-status-value">{item.value}</strong>
          <span className="v5-status-helper">{item.helper}</span>
        </div>
      ))}
    </div>
  );
}
