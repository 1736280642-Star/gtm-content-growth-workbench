"use client";

import { Alert, Card, Spin, Tag } from "antd";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { callJsonApi } from "@/lib/client-api";
import type { GeoResearchReadiness, GeoResearchWorkspace } from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import { GeoStructuredData } from "./GeoStructuredData";

interface ProductWorkspaceResponse {
  ok: true;
  product: ProductRegistryItem;
  workspace?: GeoResearchWorkspace;
  readiness: GeoResearchReadiness;
}

export function GeoMonthlyStrategyHandoff() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("productId");
  const blueprintVersionId = searchParams.get("geoBlueprintVersionId");
  const [data, setData] = useState<ProductWorkspaceResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!productId || !blueprintVersionId) return;
    let active = true;
    callJsonApi<ProductWorkspaceResponse>(`/api/v5/products/${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "GEO 蓝图读取失败"); });
    return () => { active = false; };
  }, [blueprintVersionId, productId]);

  if (!productId || !blueprintVersionId) return null;
  if (error) return <Alert showIcon type="error" message="GEO 策略候选读取失败" description={error} style={{ marginBottom: 16 }} />;
  if (!data) return <div className="v5-loading-row"><Spin /><span>正在读取已批准 GEO 蓝图</span></div>;
  const blueprint = data.workspace?.currentBlueprint;
  if (!blueprint || blueprint.blueprintVersionId !== blueprintVersionId || blueprint.status !== "approved") {
    return (
      <Alert
        showIcon
        type="warning"
        message="该 GEO 蓝图尚未批准或已被新版本替代"
        description="系统不会把未批准研究结论写入月度策略。请返回产品调研页确认当前版本。"
        style={{ marginBottom: 16 }}
      />
    );
  }
  return (
    <Card
      bordered={false}
      title={`${data.product.displayName} · GEO 月度策略候选`}
      extra={<Tag color="green">蓝图 v{blueprint.versionNumber} 已批准</Tag>}
      style={{ marginBottom: 16 }}
    >
      <Alert
        showIcon
        type="info"
        message="这是研究建议，不是已批准的 MonthlyPlan"
        description="请将其中的优先问题、内容类型和渠道配额与本月目标、知识快照和规则包一起判断。月度计划仍按原审批链路保存。"
        style={{ marginBottom: 14 }}
      />
      <GeoStructuredData value={blueprint.monthlyStrategyInput} />
    </Card>
  );
}
