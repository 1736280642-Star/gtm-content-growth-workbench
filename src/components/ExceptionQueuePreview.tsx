import { Button, Card, Space, Table, Tag } from "antd";
import Link from "next/link";
import type { ExceptionItem } from "@/lib/v5-ui-mock-data";

const severityColors: Record<ExceptionItem["severity"], string> = {
  high: "red",
  medium: "orange",
  low: "blue"
};

const exceptionLabels: Record<ExceptionItem["code"], string> = {
  rule_package_inactive: "规则包失效",
  distilled_term_product_mismatch: "蒸馏词与产品不匹配",
  evidence_missing: "证据缺失",
  title_unprovable: "标题不可证明",
  role_boundary_risk: "人机责任边界风险",
  provider_pending_config: "暂不可生成",
  hard_rule_blocked: "硬规则阻断",
  soft_quality_failed: "软质量不合格",
  publish_pending_config: "需人工发布"
};

function buildEvidenceHref(item: ExceptionItem) {
  const params = new URLSearchParams({
    productId: item.productId,
    distilledTermId: item.distilledTermId,
    matrixItemId: item.matrixItemId,
    missingClaimType: item.missingClaimType,
    requiredEvidenceLevel: item.requiredEvidenceLevel,
    titlePromise: item.currentTitlePromise
  });
  return `/knowledge/import?${params.toString()}`;
}

export function ExceptionQueuePreview({ items }: { items: ExceptionItem[] }) {
  const openCount = items.filter((item) => item.status === "open").length;

  return (
    <Card title="异常拦截" size="small" extra={<Tag color={openCount ? "orange" : "green"}>{openCount} 项待处理</Tag>}>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={items}
        expandable={{
          expandedRowRender: (record) => (
            <div className="v5-exception-context">
              <p><strong>判断依据：</strong>{record.claimContext}</p>
              <p><strong>证据说明：</strong>{record.evidenceItemContext}</p>
              <p><strong>处理方向：</strong>{record.governanceLayer}</p>
            </div>
          )
        }}
        columns={[
          {
            title: "异常",
            key: "type",
            width: 190,
            render: (_, record: ExceptionItem) => (
              <Space size={4} wrap>
                <Tag color={severityColors[record.severity]}>{exceptionLabels[record.code]}</Tag>
                <Tag color={record.blocking ? "red" : "cyan"}>{record.blocking ? "阻断生成" : "已自动处理"}</Tag>
              </Space>
            )
          },
          { title: "发生位置", dataIndex: "stage", width: 160 },
          {
            title: "关联内容",
            key: "content",
            width: 260,
            render: (_, record: ExceptionItem) => (
              <div className="v5-table-stack"><strong>{record.title}</strong><span>{record.product} · {record.distilledTerm}</span></div>
            )
          },
          { title: "原因", dataIndex: "reason" },
          { title: "推荐动作", dataIndex: "nextAction" },
          {
            title: "处理",
            key: "action",
            width: 115,
            render: (_, record: ExceptionItem) => {
              if (record.code === "evidence_missing") {
                return <Link href={buildEvidenceHref(record)}><Button size="small">补证据</Button></Link>;
              }
              if (record.code === "provider_pending_config") {
                return <Link href="/configuration"><Button size="small">完善生成条件</Button></Link>;
              }
              return <Button size="small" disabled>{record.status === "auto_resolved" ? "已复检" : "待处理"}</Button>;
            }
          }
        ]}
      />
    </Card>
  );
}
