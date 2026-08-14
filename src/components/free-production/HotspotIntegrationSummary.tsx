"use client";

import { LinkOutlined } from "@ant-design/icons";
import { Tag, Typography } from "antd";
import type { HotspotIntegrationPlan } from "@/lib/v5/free-production-contracts";
import styles from "./HotspotIntegrationSummary.module.css";

function displayTime(value?: string) {
  if (!value) return "发布时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "发布时间未知" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function HotspotIntegrationSummary({ plan }: { plan: HotspotIntegrationPlan }) {
  return (
    <section className={styles.summary} aria-label="当前正文热点融入依据">
      <div className={styles.heading}>
        <div>
          <span className={styles.kicker}>AIHOT 热点已融入</span>
          <strong>{plan.title}</strong>
        </div>
        <Tag color={plan.hotspotDataFreshness === "live" ? "green" : "gold"}>{plan.hotspotDataFreshness === "live" ? "最新数据" : "缓存数据"}</Tag>
      </div>
      <dl>
        <div><dt>选择原因</dt><dd>{plan.selectionReason}</dd></div>
        <div><dt>写作角度</dt><dd>{plan.writingAngle}</dd></div>
        <div><dt>影响章节</dt><dd>{plan.affectedSectionKeys.join("、")}</dd></div>
      </dl>
      <div className={styles.meta}>
        <Typography.Text type="secondary">{plan.sourceName} · {displayTime(plan.publishedAt)} · 相关度 {plan.relevanceScore}</Typography.Text>
        <span>
          <a href={plan.aihotUrl} target="_blank" rel="noreferrer"><LinkOutlined /> AIHOT</a>
          <a href={plan.originalUrl} target="_blank" rel="noreferrer"><LinkOutlined /> 原文</a>
        </span>
      </div>
      {plan.riskNotes.length ? <p className={styles.risk}>发布前留意：{plan.riskNotes.join("；")}</p> : null}
    </section>
  );
}
