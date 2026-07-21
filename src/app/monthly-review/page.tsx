"use client";

import { Alert, Button, Card, Progress, Space, Table, Tag } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { monthlyTermReviews, nextMonthCandidates } from "@/lib/v5-ui-mock-data";
import type { MonthlyTermReview, NextMonthCandidate } from "@/lib/v5-ui-mock-data";

const candidateStatusLabels: Record<NextMonthCandidate["status"], string> = {
  pending_review: "待人工确认",
  confirmed: "已确认",
  hold: "Hold"
};

export default function MonthlyReviewPage() {
  const plannedCount = monthlyTermReviews.reduce((total, item) => total + item.planned, 0);
  const publishedCount = monthlyTermReviews.reduce((total, item) => total + item.published, 0);

  return (
    <>
      <PageHeader
        title="月度复盘"
        titleExtra={<Tag color="blue">2026-08</Tag>}
        subtitle="以蒸馏词和产品为观察单位，回看发布完成度、证据问题和下月候选调整。"
        actions={<Button type="primary" disabled>生成下月候选草稿</Button>}
      />
      <Alert
        showIcon
        type="info"
        message="下月建议需人工确认"
        description="系统会根据本月表现生成调整建议；确认前不会改变下月内容策略。"
        style={{ marginBottom: 16 }}
      />
      <V5StatusRail
        items={[
          { label: "矩阵完成率", value: `${publishedCount}/${plannedCount}`, helper: "按主蒸馏词汇总" },
          { label: "本月已发布", value: publishedCount, helper: "按主蒸馏词汇总" },
          { label: "证据类问题", value: 2, helper: "回流知识库资料治理" }
        ]}
      />
      <Card title="主蒸馏词月度结果" size="small">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={monthlyTermReviews}
          columns={[
            { title: "蒸馏词与产品", key: "term", render: (_, record: MonthlyTermReview) => <div className="v5-table-stack"><strong>{record.term}</strong><span>{record.product}</span></div> },
            { title: "计划与发布", key: "completion", render: (_, record: MonthlyTermReview) => <div className="v5-review-progress"><Progress percent={Math.round((record.published / record.planned) * 100)} size="small" /><span>{record.published} / {record.planned} 篇</span></div> },
            { title: "缺口判断", dataIndex: "gapConclusion" },
            { title: "问题来源", dataIndex: "issueSource", render: (value) => <Tag color={value === "无主要阻断" ? "green" : "orange"}>{value}</Tag> }
          ]}
        />
      </Card>
      <Card title="下月候选调整" size="small" style={{ marginTop: 16 }} extra={<Tag>系统建议 · 人工确认</Tag>}>
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
