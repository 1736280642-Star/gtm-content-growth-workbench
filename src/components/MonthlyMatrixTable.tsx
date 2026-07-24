import { Button, Space, Table, Tag } from "antd";
import type { ContentStrategyPackageRecord, StrategyPreflightStatus } from "@/lib/v5/monthly-workspace-contracts";

const preflightLabels: Record<StrategyPreflightStatus, { label: string; color: string }> = {
  generatable: { label: "可生产", color: "green" },
  awaiting_material: { label: "待补资料", color: "gold" },
  configuration_error: { label: "配置错误", color: "red" }
};

export function MonthlyStrategyTable({ strategyPackage, onEdit }: { strategyPackage: ContentStrategyPackageRecord; onEdit?: () => void }) {
  const resultByRule = new Map(strategyPackage.preflightResults.map((item) => [item.quotaRuleId, item]));
  const locked = strategyPackage.status === "approved" || strategyPackage.status === "partially_approved";
  return (
    <Table
      rowKey="quotaRuleId"
      size="small"
      pagination={false}
      tableLayout="fixed"
      dataSource={strategyPackage.quotaRules}
      columns={[
        { title: "目标问题", dataIndex: "question", width: "30%", render: (value: string) => <strong>{value}</strong> },
        { title: "内容类型 / 来源", key: "contentType", width: 180, render: (_: unknown, record) => <div className="v5-table-stack"><strong>{record.articleTypeNameSnapshot}</strong><span>{record.typeSelectionSource === "ai_recommended" ? "AI 推荐后确认" : "用户手动选择"} · {record.articleTypeProfileVersionId}</span></div> },
        { title: "匹配理由", dataIndex: "matchReasonSnapshot", width: "24%" },
        { title: "Prompt 约束", dataIndex: "articleTypePromptConstraintSnapshotHash", width: 130, render: (value: string) => <Tag>{value.slice(0, 12)}</Tag> },
        {
          title: "渠道配额",
          dataIndex: "channelQuotas",
          width: "24%",
          render: (value: Record<string, number>) => <Space size={[4, 4]} wrap>{Object.entries(value).map(([channel, quota]) => <Tag key={channel}>{channel} {quota} 篇</Tag>)}</Space>
        },
        { title: "渠道成品", dataIndex: "expandedDeliverableCount", width: 100, render: (value: number) => <strong>{value} 篇</strong> },
        {
          title: "生产准入",
          key: "preflight",
          width: 150,
          render: (_: unknown, record) => {
            const result = resultByRule.get(record.quotaRuleId);
            return result ? <Tag color={preflightLabels[result.status].color}>{preflightLabels[result.status].label}</Tag> : <Tag>待预检</Tag>;
          }
        },
        { title: "操作", key: "action", width: 90, render: () => <Button size="small" disabled={locked} onClick={onEdit}>编辑</Button> }
      ]}
    />
  );
}
