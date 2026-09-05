import type { HostedResultContent } from "./hosted-history-contracts";

interface StrategySummary {
  coreExpressions: { productIdentity: string; entityRelationship: string; fixedExpression: string; ctaLabel: string; ctaUrl: string };
  automaticStrategy: { targetAudience: string[]; promotionPurpose: string; keyMessages: string[]; channels: string[]; articleDirections: Array<{ name: string; direction: string }>; prohibitedClaims: string[] };
}
export function strategyResultContent(input: { sourceId: string; sourceVersion: string; summary: StrategySummary; materials?: { acceptedSourceCount: number; fileNames: string[]; officialUrl?: string } }): HostedResultContent {
  const { coreExpressions: core, automaticStrategy: strategy } = input.summary;
  return {
    title: "GEO 策略结果", summary: strategy.promotionPurpose, sourceId: input.sourceId, sourceVersion: input.sourceVersion,
    sections: [
      ...(input.materials ? [{ title: "资料处理结果", items: [`已接收 ${input.materials.acceptedSourceCount} 个来源`, ...input.materials.fileNames, ...(input.materials.officialUrl ? [input.materials.officialUrl] : [])] }] : []),
      { title: "核心表达", items: [core.productIdentity, core.entityRelationship, core.fixedExpression, [core.ctaLabel, core.ctaUrl].filter(Boolean).join(" · ")].filter(Boolean) },
      { title: "目标用户", items: strategy.targetAudience },
      { title: "关键表达", items: strategy.keyMessages },
      { title: "推广渠道", items: strategy.channels },
      { title: "内容方向", items: strategy.articleDirections.map(item => `${item.name}：${item.direction}`) },
      { title: "表达边界", items: strategy.prohibitedClaims }
    ]
  };
}
export function sampleResultContent(input: { sourceId: string; sourceVersion: string; title: string; markdown: string; articleTypeName: string; channel: string }): HostedResultContent {
  return { title: "代表样文结果", summary: input.title, sourceId: input.sourceId, sourceVersion: input.sourceVersion,
    sections: [{ title: "样文信息", items: [`内容类型：${input.articleTypeName}`, `渠道：${input.channel}`] }],
    article: { title: input.title, markdown: input.markdown } };
}
export function publishingResultContent(input: { batchId: string; businessDate: string; rowVersion?: number; plannedCount: number; publishedCount: number; pendingCount: number; failedCount: number; results: NonNullable<HostedResultContent["publications"]> }): HostedResultContent {
  return { title: `${input.businessDate} 发布回执`, summary: `计划 ${input.plannedCount} 篇 · 已公开 ${input.publishedCount} 篇 · 审核或顺延 ${input.pendingCount} 篇 · 未完成 ${input.failedCount} 篇`,
    sourceId: input.batchId, sourceVersion: `批次 V${input.rowVersion || 1}`, sections: [], publications: input.results.map(({ taskId, title, channel, status, publicUrl, failureReason, nextAction }) => ({ taskId, title, channel, status, publicUrl, failureReason, nextAction })) };
}
