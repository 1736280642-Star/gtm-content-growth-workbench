"use client";

import { CheckCircleFilled, ClockCircleOutlined, ExclamationCircleFilled, LoadingOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

export type AutomationPulseStatus = "healthy" | "running" | "attention" | "waiting";

export interface AutomationPulseItem {
  key: string;
  label: string;
  status?: AutomationPulseStatus;
  detail?: string;
}

const defaultItems: AutomationPulseItem[] = [
  { key: "knowledge", label: "知识采集", status: "waiting" },
  { key: "research", label: "GEO 调研", status: "waiting" },
  { key: "strategy", label: "月度策略", status: "waiting" },
  { key: "production", label: "内容生产", status: "waiting" },
  { key: "schedule", label: "自动排程", status: "waiting" },
  { key: "publishing", label: "发布回传", status: "waiting" },
  { key: "review", label: "数据复盘", status: "waiting" }
];

function iconFor(status: AutomationPulseStatus) {
  if (status === "healthy") return <CheckCircleFilled />;
  if (status === "running") return <LoadingOutlined />;
  if (status === "attention") return <ExclamationCircleFilled />;
  return <ClockCircleOutlined />;
}

export function AutomationPulseRail({ items, month }: { items?: AutomationPulseItem[]; month?: string }) {
  const [liveItems, setLiveItems] = useState<AutomationPulseItem[]>(items || defaultItems);

  useEffect(() => {
    if (items) {
      setLiveItems(items);
      return;
    }
    const controller = new AbortController();
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    fetch(`/api/v5/automation/status${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (Array.isArray(payload?.data?.items) && payload.data.items.length) setLiveItems(payload.data.items);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [items, month]);

  return (
    <section className="automation-pulse" aria-label="GEO 自动化运行链路">
      <div className="automation-pulse-heading">
        <div>
          <span className="automation-pulse-kicker">AUTOMATION PULSE</span>
          <strong>系统持续运行中</strong>
        </div>
        <span>只在异常时请求人工判断</span>
      </div>
      <div className="automation-pulse-track">
        {liveItems.map((item, index) => (
          <div className={`automation-pulse-item is-${item.status || "waiting"}`} key={item.key} title={item.detail}>
            <span className="automation-pulse-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="automation-pulse-icon">{iconFor(item.status || "waiting")}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
