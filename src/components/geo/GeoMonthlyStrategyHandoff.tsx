"use client";

import { Alert, Card, Spin, Tag } from "antd";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { callJsonApi } from "@/lib/client-api";
import type { ProductGeoStrategyPackRecord } from "@/lib/v5/product-strategy-pack-contracts";
import { GeoStructuredData } from "./GeoStructuredData";

interface ProductStrategyResponse {
  ok: true;
  productId: string;
  currentStrategyPack?: ProductGeoStrategyPackRecord | null;
}

export function GeoMonthlyStrategyHandoff() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("productId");
  const [data, setData] = useState<ProductStrategyResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!productId) return;
    let active = true;
    callJsonApi<ProductStrategyResponse>(`/api/v5/products/${encodeURIComponent(productId)}/strategy-pack`, { cache: "no-store" })
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "产品 GEO 策略读取失败"); });
    return () => { active = false; };
  }, [productId]);

  if (!productId) return null;
  if (error) return <Alert showIcon type="error" message="GEO 策略候选读取失败" description={error} style={{ marginBottom: 16 }} />;
  if (!data) return <div className="v5-loading-row"><Spin /><span>正在读取已确认产品 GEO 策略</span></div>;
  const strategyPack = data.currentStrategyPack;
  if (!strategyPack) {
    return (
      <Alert
        showIcon
        type="warning"
        message="产品 GEO 策略尚未确认"
        description="系统不会把未确认的调研综合结果写入月度策略。请先在产品页确认当前策略。"
        style={{ marginBottom: 16 }}
      />
    );
  }
  return (
    <Card
      bordered={false}
      title="产品 GEO 月度策略候选"
      extra={<Tag color="green">产品策略 v{strategyPack.strategyVersion} 已确认</Tag>}
      style={{ marginBottom: 16 }}
    >
      <Alert
        showIcon
        type="info"
        message="这是研究建议，不是已批准的 MonthlyPlan"
        description="请将其中的优先问题、内容类型和渠道配额与本月目标、知识快照和规则包一起判断。月度计划仍按原审批链路保存。"
        style={{ marginBottom: 14 }}
      />
      <GeoStructuredData value={{
        strategyPackId: strategyPack.id,
        strategyVersion: strategyPack.strategyVersion,
        contentPlan: strategyPack.contentPlan
      }} />
    </Card>
  );
}
