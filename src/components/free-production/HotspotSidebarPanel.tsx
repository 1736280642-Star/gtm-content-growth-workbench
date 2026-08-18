"use client";

import { FireOutlined, RollbackOutlined, SwapOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Tag } from "antd";
import type { HotspotIntegrationPlan } from "@/lib/v5/free-production-contracts";
import { HotspotIntegrationSummary } from "./HotspotIntegrationSummary";
import styles from "./HotspotSidebarPanel.module.css";

export function HotspotSidebarPanel({ plan, hasPreviousVersion, integrating, restoring, locked, error, onIntegrate, onRestore }: {
  plan?: HotspotIntegrationPlan;
  hasPreviousVersion: boolean;
  integrating?: boolean;
  restoring?: boolean;
  locked?: boolean;
  error?: string;
  onIntegrate: () => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  const noSuitableHotspot = error?.includes("最近没有与当前正文自然相关的热点。");
  return (
    <section className={styles.panel} aria-label="AI 热点与融入依据">
      <div className={styles.heading}>
        <div><span className="v5-kicker">写作依据</span><h2>AI 热点</h2></div>
        <Tag color={plan ? "green" : "default"}>{plan ? "已融入" : "未加入"}</Tag>
      </div>
      <Space.Compact block className={styles.actions}>
        <Button
          block
          type={plan ? "default" : "primary"}
          icon={plan ? <SwapOutlined /> : <FireOutlined />}
          loading={integrating}
          disabled={locked || restoring}
          onClick={() => void onIntegrate()}
        >
          {plan ? "更换热点" : "加入热点"}
        </Button>
        {hasPreviousVersion ? (
          <Button block icon={<RollbackOutlined />} loading={restoring} disabled={locked || integrating} onClick={() => void onRestore()}>
            返回上一版本
          </Button>
        ) : null}
      </Space.Compact>
      {noSuitableHotspot ? <p className={styles.empty}>最近没有与当前正文自然相关的热点。</p> : null}
      {error && !noSuitableHotspot ? <Alert showIcon type="error" message="热点未能融入正文" description={error} /> : null}
      {plan ? <HotspotIntegrationSummary plan={plan} /> : !error ? <p className={styles.empty}>模型会结合当前内容类型、完整写作规则和最新热点，判断是否适合融入以及应该改写哪些位置。</p> : null}
    </section>
  );
}
