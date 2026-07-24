"use client";

import { Button, Progress, Table, Tag } from "antd";
import type { MonthlyQuestionReview } from "@/lib/v5/monthly-review-contracts";

export function MonthlyQuestionReviewTable({ rows, onOpen }: { rows: MonthlyQuestionReview[]; onOpen: (row: MonthlyQuestionReview) => void }) {
  return (
    <Table
      rowKey="id"
      size="small"
      scroll={{ x: 980 }}
      pagination={false}
      dataSource={rows}
      columns={[
        { title: "目标问题", dataIndex: "questionText", width: 280, render: (value, row) => <div className="v5-table-stack"><strong>{value}</strong><span>{row.questionKey}</span></div> },
        { title: "计划 / 发布", width: 170, render: (_, row) => <div className="v5-review-progress"><Progress percent={row.plannedContentCount ? Math.round((row.publishedContent.length / row.plannedContentCount) * 100) : 0} size="small" /><span>{row.publishedContent.length} / {row.plannedContentCount}</span></div> },
        { title: "指标表现", render: (_, row) => row.publishedContent.find((item) => item.metricSummary)?.metricSummary || "数据不足" },
        { title: "AI 表现", dataIndex: "captureSummary", width: 220 },
        { title: "建议", dataIndex: "recommendation", ellipsis: true },
        { title: "数据状态", dataIndex: "dataStatus", width: 110, render: (value) => <Tag color={value === "complete" ? "green" : value === "partial" ? "orange" : "default"}>{value}</Tag> },
        { title: "操作", width: 90, fixed: "right", render: (_, row) => <Button type="link" size="small" onClick={() => onOpen(row)}>查看</Button> }
      ]}
    />
  );
}
