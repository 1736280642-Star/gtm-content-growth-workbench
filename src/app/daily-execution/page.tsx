"use client";

import { Alert, Button, Card, Segmented, Space, Table } from "antd";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PublishStatusTag } from "@/components/PublishStatusTag";
import { V5StatusRail } from "@/components/V5StatusRail";
import { dailyExecutionItems, v5DemoLabel } from "@/lib/v5-ui-mock-data";
import type { DailyExecutionItem } from "@/lib/v5-ui-mock-data";

type DateKey = DailyExecutionItem["dateKey"];

const dateOptions = [
  { label: "昨日", value: "yesterday" },
  { label: "今日", value: "today" },
  { label: "明日", value: "tomorrow" }
];

const dateLabels: Record<DateKey, string> = {
  yesterday: "昨日",
  today: "今日",
  tomorrow: "明日"
};

export default function DailyExecutionPage() {
  const [dateKey, setDateKey] = useState<DateKey>("today");
  const visibleItems = dailyExecutionItems.filter((item) => item.dateKey === dateKey);
  const activeDate = visibleItems[0]?.date || "-";
  const recentFailureCount = dailyExecutionItems.filter((item) => ["failed", "manual_takeover"].includes(item.status)).length;

  return (
    <>
      <PageHeader
        title="当日执行"
        subtitle="只回答昨天发生了什么、今天要处理什么、明天是否准备好；不承担计划、标题和正文生成。"
        actions={
          <Segmented
            aria-label="选择执行日期"
            options={dateOptions}
            value={dateKey}
            onChange={(value) => setDateKey(value as DateKey)}
          />
        }
      />

      <Alert
        showIcon
        type="info"
        message="发布执行视图"
        description={`${v5DemoLabel}。URL 不在本页呈现，也不作为发布状态；发布后统一进入独立的批量上传或数据回传入口。`}
        style={{ marginBottom: 16 }}
      />

      <V5StatusRail
        items={[
          { label: "本月已发布", value: 11, helper: "与 URL 是否上传无关", status: "mock" },
          { label: "本月待发布", value: 19, helper: "包含已排程与未排程" },
          { label: "已排程待发布", value: 12, helper: "已激活 Publish Schedule" },
          { label: "未排程", value: 7, helper: "返回批量生成中心安排" },
          { label: "近三日发布异常", value: recentFailureCount, helper: "失败或人工接管" }
        ]}
      />

      <Card title={`${dateLabels[dateKey]} · ${activeDate}`} size="small">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={visibleItems}
          locale={{ emptyText: `${dateLabels[dateKey]}没有发布任务` }}
          columns={[
            { title: "计划时间", dataIndex: "time", width: 100 },
            { title: "标题", dataIndex: "title", render: (value) => <strong className="v5-title-cell">{value}</strong> },
            { title: "产品", dataIndex: "product" },
            { title: "渠道", dataIndex: "channel" },
            { title: "实际状态", dataIndex: "status", render: (value: DailyExecutionItem["status"]) => <PublishStatusTag status={value} /> },
            { title: "失败原因", dataIndex: "failureReason", render: (value) => value || <span className="muted">无</span> },
            {
              title: "处理",
              key: "action",
              width: 170,
              render: (_, record: DailyExecutionItem) => (
                <Space size={4} wrap>
                  <Link href="/batch-generation"><Button size="small">查看</Button></Link>
                  {record.status === "failed" ? <Button size="small" type="primary" disabled>重试 / 人工接管</Button> : null}
                </Space>
              )
            }
          ]}
        />
      </Card>
    </>
  );
}
