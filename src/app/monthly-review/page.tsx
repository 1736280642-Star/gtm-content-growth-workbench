"use client";

import { Alert, Button, Card, Progress, Space, Table, Tag } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { monthlyTermReviews, nextMonthCandidates, v5DemoLabel } from "@/lib/v5-ui-mock-data";
import type { MonthlyTermReview, NextMonthCandidate } from "@/lib/v5-ui-mock-data";

const candidateStatusLabels: Record<NextMonthCandidate["status"], string> = {
  pending_review: "待人工确认",
  confirmed: "已确认",
  hold: "Hold"
};

export default function MonthlyReviewPage() {
  const plannedCount = monthlyTermReviews.reduce((total, item) => total + item.planned, 0);
  const publishedCount = monthlyTermReviews.reduce((total, item) => total + item.published, 0);
  const baselinePublished = monthlyTermReviews.filter((item) => item.mode === "baseline").reduce((total, item) => total + item.published, 0);
  const explorationPublished = publishedCount - baselinePublished;

  return (
    <>
      <PageHeader
        title="月度复盘"
        titleExtra={<Tag color="blue">2026-08</Tag>}
        subtitle="以蒸馏词和产品为观察单位，回看 baseline / exploration、GEO 缺口和下月候选调整。"
        actions={<Button type="primary" disabled>生成下月候选草稿</Button>}
      />
      <Alert
        showIcon
        type="info"
        message="复盘数据为 mock"
        description={`${v5DemoLabel}。下月候选只能由 Agent 生成草稿，必须人工确认，不能自动批准策略调整。`}
        style={{ marginBottom: 16 }}
      />
      <V5StatusRail
        items={[
          { label: "矩阵完成率", value: `${publishedCount}/${plannedCount}`, helper: "按主蒸馏词汇总", status: "mock" },
          { label: "baseline 实际", value: baselinePublished, helper: "稳定问题集复测" },
          { label: "exploration 实际", value: explorationPublished, helper: "新缺口和新变量验证" },
          { label: "GEO 缺口缩小", value: 3, helper: "可形成下月候选动作" },
          { label: "证据类问题", value: 2, helper: "回流知识库资料治理" }
        ]}
      />
      <Card title="GEO 月度结构" size="small" className="v5-review-allocation-card">
        <div className="v5-review-allocation">
          <div><span>baseline 实际比例</span><Progress percent={publishedCount ? Math.round((baselinePublished / publishedCount) * 100) : 0} strokeColor="#6554c0" /></div>
          <div><span>exploration 实际比例</span><Progress percent={publishedCount ? Math.round((explorationPublished / publishedCount) * 100) : 0} strokeColor="#1677ff" /></div>
        </div>
      </Card>
      <Card title="主蒸馏词月度结果" size="small" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={monthlyTermReviews}
          columns={[
            { title: "蒸馏词与产品", key: "term", render: (_, record: MonthlyTermReview) => <div className="v5-table-stack"><strong>{record.term}</strong><span>{record.product}</span><Tag color={record.mode === "baseline" ? "purple" : "geekblue"}>{record.mode}</Tag></div> },
            { title: "计划与发布", key: "completion", render: (_, record: MonthlyTermReview) => <div className="v5-review-progress"><Progress percent={Math.round((record.published / record.planned) * 100)} size="small" /><span>{record.published} / {record.planned} 篇</span></div> },
            { title: "GEO 指标变化", key: "geo", render: (_, record: MonthlyTermReview) => <Space size={4} wrap><Tag>可见率 {record.visibilityChange}</Tag><Tag>引用率 {record.citationChange}</Tag><Tag>实体准确 {record.entityAccuracy}</Tag><Tag>覆盖 {record.coverageChange}</Tag></Space> },
            { title: "缺口判断", dataIndex: "gapConclusion" },
            { title: "问题来源", dataIndex: "issueSource", render: (value) => <Tag color={value === "无主要阻断" ? "green" : "orange"}>{value}</Tag> }
          ]}
        />
      </Card>
      <Card title="下月候选调整" size="small" style={{ marginTop: 16 }} extra={<Tag>Agent 草稿 · 人工确认</Tag>}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={nextMonthCandidates}
          columns={[
            { title: "蒸馏词", dataIndex: "term", render: (value, record: NextMonthCandidate) => <div className="v5-table-stack"><strong>{value}</strong><span>{record.product}</span></div> },
            { title: "来源", dataIndex: "source" },
            { title: "形成原因", dataIndex: "reason" },
            { title: "建议动作", dataIndex: "proposedAction" },
            { title: "状态", dataIndex: "status", render: (value: NextMonthCandidate["status"]) => <Tag color={value === "hold" ? "default" : "blue"}>{candidateStatusLabels[value]}</Tag> },
            { title: "人工判断", key: "action", render: () => <Space size={4}><Button size="small" disabled>确认</Button><Button size="small" disabled>退回</Button></Space> }
          ]}
        />
      </Card>
    </>
  );
}
