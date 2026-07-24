"use client";

import { Alert, Button, Descriptions, Drawer, Empty, List, Popconfirm, Space, Tag } from "antd";
import type { MonthlyQuestionReview, NextMonthProposal } from "@/lib/v5/monthly-review-contracts";

export function MonthlyQuestionReviewDrawer({ row, proposals, open, creating, onClose, onCreateProposal }: {
  row?: MonthlyQuestionReview;
  proposals: NextMonthProposal[];
  open: boolean;
  creating?: boolean;
  onClose: () => void;
  onCreateProposal: (row: MonthlyQuestionReview) => Promise<void>;
}) {
  const existing = row ? proposals.find((item) => item.questionKey === row.questionKey) : undefined;
  return (
    <Drawer
      title={row ? `问题复盘：${row.questionText}` : "问题复盘"}
      open={open}
      onClose={onClose}
      width={680}
      extra={row && !existing ? <Popconfirm title="生成下月 Proposal？" description="只创建待审批建议，不创建月度任务，也不修改渠道配额。" onConfirm={() => onCreateProposal(row)}><Button type="primary" loading={creating}>生成下月 Proposal</Button></Popconfirm> : null}
    >
      {row ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="MonthlyPlan">{row.monthlyPlanIds.join("、") || "待接入"}</Descriptions.Item>
          <Descriptions.Item label="计划 / 发布">{row.plannedContentCount} / {row.publishedContent.length}</Descriptions.Item>
          <Descriptions.Item label="AI 前台测试" span={2}>{row.captureSummary}</Descriptions.Item>
          <Descriptions.Item label="已确认缺口" span={2}>{row.confirmedGapCodes.length ? row.confirmedGapCodes.map((item) => <Tag key={item}>{item}</Tag>) : "无"}</Descriptions.Item>
        </Descriptions>
        <div><strong>内容与渠道</strong>{row.publishedContent.length ? <List size="small" dataSource={row.publishedContent} renderItem={(item) => <List.Item><List.Item.Meta title={item.title} description={`${item.channel} · ${item.publishedAt} · ${item.metricSummary || "无有效指标"}`} /></List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本月没有关联的已发布内容" />}</div>
        <Alert showIcon type="info" message="下月建议" description={row.recommendation} />
        {existing ? <Alert showIcon type="success" message={`已生成 ${existing.targetMonth} Proposal`} description="Proposal 仍需进入下个月 MonthlyPlan 人工审批；当前未创建生产任务，也未改变配额。" /> : null}
      </Space> : null}
    </Drawer>
  );
}
