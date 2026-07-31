"use client";

import { CheckCircleOutlined, DisconnectOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import type { ChannelReadinessItem, FreeContentExpressionTypeVersion } from "@/lib/v5/free-production-contracts";
import { freeProductionChannelLabels } from "@/lib/v5/free-production-contracts";

export function ExpressionPresetSummary({ expression, productName, readiness }: { expression: FreeContentExpressionTypeVersion; productName?: string; readiness?: ChannelReadinessItem }) {
  return (
    <div className="expression-preset-summary">
      <span>{productName || "生产池产品"}</span>
      <span>{freeProductionChannelLabels[expression.channelBinding.channel]}</span>
      <Tag icon={readiness?.connected ? <CheckCircleOutlined /> : <DisconnectOutlined />} color={readiness?.connected ? "success" : "default"}>{readiness?.connected ? "账号已连接" : "账号待连接"}</Tag>
      {expression.visualSuggestionMode === "placeholders" ? <Tag>含视觉建议</Tag> : null}
    </div>
  );
}
