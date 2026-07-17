import { Descriptions, Space, Table, Tag } from "antd";
import { EvidenceGateTag } from "@/components/EvidenceGateTag";
import type { StrategyTermHit } from "@/lib/v5-ui-mock-data";

const priorityColors: Record<StrategyTermHit["priority"], string> = {
  P0: "red",
  P1: "orange",
  P2: "blue",
  Hold: "default"
};

const strategyStatusLabels: Record<StrategyTermHit["status"], string> = {
  ready: "可确认",
  ready_with_conditions: "部分可确认",
  needs_material: "需补证据",
  needs_review: "需人工确认",
  quota_error: "配额错误",
  blocked: "已阻断"
};

const strategyStatusColors: Record<StrategyTermHit["status"], string> = {
  ready: "green",
  ready_with_conditions: "cyan",
  needs_material: "orange",
  needs_review: "blue",
  quota_error: "red",
  blocked: "red"
};

export function MonthlyStrategyTable({ items }: { items: StrategyTermHit[] }) {
  return (
    <Table
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={items}
      expandable={{
        expandedRowRender: (record) => (
          <Descriptions className="v5-expanded-detail" size="small" bordered column={2}>
            <Descriptions.Item label="优先级原因">{record.priorityReason}</Descriptions.Item>
            <Descriptions.Item label="上月 GEO 指标">{record.previousGeoSummary}</Descriptions.Item>
            <Descriptions.Item label="测试假设">{record.testHypothesis}</Descriptions.Item>
            <Descriptions.Item label="成功信号">{record.successSignal}</Descriptions.Item>
            <Descriptions.Item label="必需 Claim">{record.requiredClaims.join("、")}</Descriptions.Item>
            <Descriptions.Item label="证据缺口">{record.evidenceGaps.length ? record.evidenceGaps.join("；") : "当前无缺口"}</Descriptions.Item>
          </Descriptions>
        )
      }}
      columns={[
        {
          title: "优先级与蒸馏词命中",
          key: "term",
          width: 250,
          render: (_, record: StrategyTermHit) => (
            <div className="v5-table-stack">
              <Space size={6} wrap>
                <Tag color={priorityColors[record.priority]}>{record.priority}</Tag>
                <strong>{record.term}</strong>
              </Space>
              <span>{record.source}</span>
              <span className="muted">{record.previousGeoSummary}</span>
            </div>
          )
        },
        {
          title: "产品与内容配额",
          key: "allocation",
          width: 245,
          render: (_, record: StrategyTermHit) => (
            <div className="v5-table-stack">
              <Space size={6} wrap>
                <strong>{record.productName}</strong>
                <Tag>{record.rulePackageVersion}</Tag>
                <Tag color="blue">{record.allocatedQuota} 篇</Tag>
              </Space>
              <span>{record.channelAllocation.join(" · ")}</span>
              <span className="muted">{record.contentTypeSuggestions.join(" / ")}</span>
            </div>
          )
        },
        {
          title: "测试目标",
          key: "test",
          width: 230,
          render: (_, record: StrategyTermHit) => (
            <div className="v5-table-stack">
              <Tag color={record.geoTestMode === "baseline" ? "purple" : "geekblue"}>
                {record.geoTestMode === "baseline" ? "baseline" : "exploration"}
              </Tag>
              <span>{record.querySet}</span>
              <span className="muted">{record.testHypothesis}</span>
            </div>
          )
        },
        {
          title: "知识库证据准备度",
          key: "evidence",
          width: 250,
          render: (_, record: StrategyTermHit) => {
            const estimatedGeneratable = record.estimatedReadyItemCount + record.estimatedAutoDowngradeItemCount;
            return (
              <div className="v5-table-stack">
                <Space size={6} wrap>
                  <EvidenceGateTag status={record.evidenceStatus} />
                  <strong>{`${estimatedGeneratable}/${record.allocatedQuota} 项预计可生成`}</strong>
                </Space>
                <span>{`直接 ${record.estimatedReadyItemCount} · 自动降级 ${record.estimatedAutoDowngradeItemCount} · 待补 ${record.estimatedMissingEvidenceItemCount}`}</span>
                <span className="muted">策略可行不等于正文可生成，最终以标题冻结后的 Final Evidence Gate 为准。</span>
              </div>
            );
          }
        },
        {
          title: "状态",
          dataIndex: "status",
          width: 120,
          render: (value: StrategyTermHit["status"]) => <Tag color={strategyStatusColors[value]}>{strategyStatusLabels[value]}</Tag>
        }
      ]}
    />
  );
}
