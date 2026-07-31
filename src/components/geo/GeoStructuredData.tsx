import { Empty, Tag } from "antd";
import type { ReactNode } from "react";

function labelFor(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function renderValue(value: unknown, depth: number): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="geo-data-empty">待补充</span>;
  }
  if (typeof value === "boolean") return <Tag color={value ? "green" : "default"}>{value ? "是" : "否"}</Tag>;
  if (typeof value === "number") return <strong className="geo-data-number">{value}</strong>;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      return <a href={value} target="_blank" rel="noreferrer">{value}</a>;
    }
    return <span>{value}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="geo-data-empty">暂无</span>;
    const primitives = value.every((item) => ["string", "number", "boolean"].includes(typeof item));
    if (primitives) {
      return <div className="geo-data-tags">{value.map((item, index) => <Tag key={`${String(item)}-${index}`}>{String(item)}</Tag>)}</div>;
    }
    return (
      <div className="geo-data-array">
        {value.map((item, index) => (
          <article key={index}>
            <span className="geo-data-index">{String(index + 1).padStart(2, "0")}</span>
            {renderValue(item, depth + 1)}
          </article>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return <span className="geo-data-empty">暂无</span>;
    return (
      <dl className={depth ? "geo-data-nested" : "geo-data-root"}>
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt>{labelFor(key)}</dt>
            <dd>{renderValue(item, depth + 1)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}

export function GeoStructuredData({ value }: { value: Record<string, unknown> }) {
  if (!Object.keys(value).length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无结构化结果" />;
  return <div className="geo-structured-data">{renderValue(value, 0)}</div>;
}
