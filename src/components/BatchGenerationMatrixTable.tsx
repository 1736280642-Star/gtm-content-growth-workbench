import { Button, Progress, Space, Table, Tag } from "antd";
import Link from "next/link";
import { EvidenceGateTag } from "@/components/EvidenceGateTag";
import type { BatchQueueItem, FinalEvidenceGateStatus, GenerationStatus, ScheduleDraftStatus } from "@/lib/v5-ui-mock-data";

const finalGateLabels: Record<FinalEvidenceGateStatus, string> = {
  not_created: "未创建",
  ready: "Final Gate 通过",
  needs_review: "Final Gate 待确认",
  blocked: "Final Gate 阻断",
  pending_config: "Final Gate 待配置"
};

const finalGateColors: Record<FinalEvidenceGateStatus, string> = {
  not_created: "default",
  ready: "green",
  needs_review: "blue",
  blocked: "red",
  pending_config: "default"
};

const generationLabels: Record<GenerationStatus, string> = {
  title_pending: "标题待确认",
  pending: "待生成",
  generating: "生成中",
  generated: "已生成",
  provider_failed: "Provider 失败",
  input_expired: "输入已过期"
};

const generationColors: Record<GenerationStatus, string> = {
  title_pending: "default",
  pending: "blue",
  generating: "processing",
  generated: "green",
  provider_failed: "red",
  input_expired: "orange"
};

const scheduleLabels: Record<ScheduleDraftStatus, string> = {
  unscheduled: "未排程",
  draft: "排程草稿",
  active: "正式排程",
  pending_config: "发布待配置"
};

export function BatchGenerationMatrixTable({ items }: { items: BatchQueueItem[] }) {
  return (
    <Table
      rowKey="matrixItemId"
      size="small"
      scroll={{ x: 1460 }}
      pagination={{ pageSize: 8, hideOnSinglePage: true }}
      dataSource={items}
      rowSelection={{ getCheckboxProps: (record) => ({ disabled: record.displayStatus === "exception" }) }}
      columns={[
        {
          title: "内容任务",
          key: "task",
          fixed: "left",
          width: 270,
          render: (_, record: BatchQueueItem) => (
            <div className="v5-table-stack">
              <strong className="v5-title-cell">{record.title}</strong>
              <Space size={4} wrap>
                <Tag color={record.priority === "P0" ? "red" : record.priority === "P1" ? "orange" : "blue"}>{record.priority}</Tag>
                <Tag color={record.geoTestMode === "baseline" ? "purple" : "geekblue"}>{record.geoTestMode}</Tag>
                <Tag>{record.contentType}</Tag>
              </Space>
              <span className="muted">主蒸馏词：{record.primaryDistilledTerm}</span>
            </div>
          )
        },
        {
          title: "产品与渠道",
          key: "product",
          width: 210,
          render: (_, record: BatchQueueItem) => (
            <div className="v5-table-stack">
              <Space size={4} wrap><strong>{record.product}</strong><Tag>{record.rulePackageVersion}</Tag></Space>
              <span>{record.channel}</span>
              <span className="muted">{record.platformExpressionType}</span>
            </div>
          )
        },
        {
          title: "标题与证据",
          key: "evidence",
          width: 260,
          render: (_, record: BatchQueueItem) => (
            <div className="v5-table-stack">
              <Tag color={record.titleConfirmed ? "green" : "default"}>{record.titleConfirmed ? "标题已冻结" : "标题待确认"}</Tag>
              <EvidenceGateTag status={record.evidencePreview} />
              <Tag color={finalGateColors[record.finalEvidenceGate]}>{finalGateLabels[record.finalEvidenceGate]}</Tag>
              <span className="muted">已绑定 {record.claimCount} 个可用 Claim</span>
            </div>
          )
        },
        {
          title: "生成状态",
          dataIndex: "generationStatus",
          width: 135,
          render: (value: GenerationStatus) => <Tag color={generationColors[value]}>{generationLabels[value]}</Tag>
        },
        {
          title: "质检状态",
          key: "quality",
          width: 165,
          render: (_, record: BatchQueueItem) => (
            <div className="v5-table-stack">
              <Tag color={record.hardRuleStatus === "passed" ? "green" : record.hardRuleStatus === "blocked" ? "red" : "default"}>
                {record.hardRuleStatus === "passed" ? "硬规则通过" : record.hardRuleStatus === "blocked" ? "硬规则阻断" : "硬规则待检"}
              </Tag>
              {typeof record.softQualityScore === "number" ? <Progress percent={record.softQualityScore} size="small" format={(percent) => `软质量 ${percent}`} /> : <span className="muted">软质量待评测</span>}
            </div>
          )
        },
        {
          title: "人工排程",
          key: "schedule",
          width: 190,
          render: (_, record: BatchQueueItem) => (
            <div className="v5-table-stack">
              <Tag color={record.scheduleStatus === "active" ? "green" : record.scheduleStatus === "draft" ? "blue" : "default"}>{scheduleLabels[record.scheduleStatus]}</Tag>
              <span>{record.scheduleDate ? `${record.scheduleDate} ${record.scheduleTime || ""}` : "尚未选择日期和时间"}</span>
              <span className="muted">{record.platformAccount || "未选择平台账号"}</span>
            </div>
          )
        },
        {
          title: "操作",
          key: "action",
          fixed: "right",
          width: 170,
          render: (_, record: BatchQueueItem) => (
            <Space size={4} wrap>
              <Button size="small" disabled>查看正文</Button>
              {record.evidencePreview === "needs_material" ? (
                <Link href={`/knowledge/import?matrixItemId=${record.matrixItemId}`}><Button size="small">补证据</Button></Link>
              ) : (
                <Button size="small" disabled>{record.generationStatus === "provider_failed" ? "重新生成" : "排程"}</Button>
              )}
            </Space>
          )
        }
      ]}
    />
  );
}
