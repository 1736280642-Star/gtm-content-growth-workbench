"use client";

import { ArrowRightOutlined, LockOutlined } from "@ant-design/icons";
import { Button, Empty, Tag } from "antd";
import type { ChannelReadinessItem, FreeContentExpressionTypeSummary, FreeProductionCatalogProduct } from "@/lib/v5/free-production-contracts";
import { ExpressionPresetSummary } from "./ExpressionPresetSummary";

export function ExpressionPresetList({ expressions, products, readiness, loadingId, onUse }: { expressions: FreeContentExpressionTypeSummary[]; products: FreeProductionCatalogProduct[]; readiness: ChannelReadinessItem[]; loadingId?: string; onUse: (expression: FreeContentExpressionTypeSummary) => void }) {
  if (!expressions.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可用表达" />;
  return (
    <div className="expression-preset-list">
      {expressions.map((profile) => {
        const expression = profile.activeVersion!;
        return (
          <article className="expression-preset-row" key={profile.typeId}>
            <div className="expression-preset-identity">
              <div><h2>{expression.name}</h2>{expression.systemManaged ? <Tag icon={<LockOutlined />}>系统预设</Tag> : <Tag color="blue">工作区表达</Tag>}</div>
              <p>{expression.description}</p>
              <ExpressionPresetSummary expression={expression} productName={products.find((item) => item.productId === expression.productId)?.name} readiness={readiness.find((item) => item.channel === expression.channelBinding.channel)} />
            </div>
            <div className="expression-preset-structure">
              <span>结构</span>
              <p>{expression.structureModules.map((key) => key.replaceAll("_", " ")).join(" → ")}</p>
            </div>
            <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" loading={loadingId === expression.freeContentExpressionTypeVersionId} onClick={() => onUse(profile)}>使用此表达</Button>
          </article>
        );
      })}
    </div>
  );
}
