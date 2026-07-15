import { Card, Table } from "antd";
import { EvidenceGateTag } from "@/components/EvidenceGateTag";
import type { ReadinessRow } from "@/lib/v5-ui-mock-data";

export function ProductionReadinessPanel({ rows }: { rows: ReadinessRow[] }) {
  return (
    <Card title="月度生产准备度" size="small">
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: "检查项", dataIndex: "area" },
          { title: "状态", dataIndex: "status", render: (value) => <EvidenceGateTag status={value} /> },
          { title: "负责人", dataIndex: "owner" },
          { title: "影响", dataIndex: "impact" }
        ]}
      />
    </Card>
  );
}
