"use client";

import { Alert, Button, Card, Table, Tag } from "antd";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ProductionReadinessPanel } from "@/components/ProductionReadinessPanel";
import { V5StatusRail } from "@/components/V5StatusRail";
import { exceptionItems, readinessRows, rulePackageOptions, strategyTermHits, v5DemoLabel } from "@/lib/v5-ui-mock-data";

const productionPoolRows = [
  { product: "Dify 企业版服务", rulePackage: "active", knowledge: "2 个可用", producible: "16 / 16", next: "进入矩阵" },
  { product: "唯客 AI 护栏", rulePackage: "active", knowledge: "3 个可用", producible: "10 / 14", next: "补案例证据" },
  { product: "大模型安全运营", rulePackage: "draft", knowledge: "1 个待切片", producible: "0 / 12", next: "确认规则包" }
];

export default function AgentFoundationPage() {
  return (
    <>
      <PageHeader
        title="Agent 底座总览"
        subtitle="查看月度批量生产前的规则包、知识库、Evidence Gate 与异常准备度。"
        actions={
          <>
            <Button disabled>刷新</Button>
            <Link href="/batch-generation#exceptions">
              <Button type="primary">查看异常队列</Button>
            </Link>
          </>
        }
      />
      <Alert showIcon type="info" message="底座状态为 demo" description={v5DemoLabel} style={{ marginBottom: 16 }} />
      <V5StatusRail
        items={[
          { label: "active 规则包", value: rulePackageOptions.filter((item) => item.status === "active" && item.monthlyProductionReady).length, helper: "月度生产硬准入" },
          { label: "可用知识库", value: 5, helper: "可支撑 EvidencePack" },
          { label: "预计可生成项", value: `${strategyTermHits.reduce((sum, item) => sum + item.estimatedReadyItemCount + item.estimatedAutoDowngradeItemCount, 0)} / 30`, helper: "策略阶段 Evidence Preview" },
          { label: "异常待处理", value: exceptionItems.filter((item) => item.status === "open").length, helper: "需人工判断", status: "mock" }
        ]}
      />
      <ProductionReadinessPanel rows={readinessRows} />
      <Card title="月度生产池" size="small" style={{ marginTop: 16 }}>
        <Table
          rowKey="product"
          size="small"
          pagination={false}
          dataSource={productionPoolRows}
          columns={[
            { title: "产品", dataIndex: "product" },
            { title: "规则包", dataIndex: "rulePackage", render: (value) => <Tag color={value === "active" ? "green" : "orange"}>{value}</Tag> },
            { title: "知识库", dataIndex: "knowledge" },
            { title: "月度可生产", dataIndex: "producible" },
            { title: "下一步", dataIndex: "next" }
          ]}
        />
      </Card>
    </>
  );
}
