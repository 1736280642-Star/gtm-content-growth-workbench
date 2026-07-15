"use client";

import { PauseOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Tag } from "antd";
import { BatchGenerationMatrixTable } from "@/components/BatchGenerationMatrixTable";
import { ExceptionQueuePreview } from "@/components/ExceptionQueuePreview";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleCalendarLite } from "@/components/ScheduleCalendarLite";
import { V5StatusRail } from "@/components/V5StatusRail";
import { batchQueueItems, exceptionItems, scheduleDraftItems, v5DemoLabel } from "@/lib/v5-ui-mock-data";

export default function BatchGenerationPage() {
  const generatableCount = batchQueueItems.filter(
    (item) => item.titleConfirmed && item.finalEvidenceGate === "ready" && ["pending", "input_expired"].includes(item.generationStatus)
  ).length;
  const evidenceBlockedCount = batchQueueItems.filter((item) => ["needs_material", "needs_review", "blocked"].includes(item.evidencePreview)).length;
  const titlePendingCount = batchQueueItems.filter((item) => !item.titleConfirmed).length;
  const platformPendingCount = batchQueueItems.filter((item) => item.scheduleStatus === "pending_config" || item.finalEvidenceGate === "pending_config").length;
  const openExceptionCount = exceptionItems.filter((item) => item.status === "open").length;

  return (
    <>
      <PageHeader
        title="批量生成中心"
        titleExtra={<Tag color="blue">2026-08</Tag>}
        subtitle="当月正文生产操作台：标题确认、Final Evidence Gate、生成质检、异常分流和文章级人工排程。"
        actions={
          <Space wrap>
            <Button icon={<PauseOutlined />} disabled>暂停批次</Button>
            <Button icon={<SafetyCertificateOutlined />} disabled>批量确认标题与矩阵</Button>
            <Button type="primary" icon={<ThunderboltOutlined />} disabled>批量生成当月可生成内容</Button>
          </Space>
        }
      />

      <Alert
        showIcon
        type="warning"
        message="只生成通过正式准入的矩阵项"
        description={`${v5DemoLabel}。真实接入后，本批次只执行 ready 或自动安全降级后复检通过的项目；异常项保留原状态和原因，不会取消全部批次。`}
        style={{ marginBottom: 16 }}
      />

      <V5StatusRail
        items={[
          { label: "本次可生成", value: generatableCount, helper: "标题冻结且 Final Gate 通过", status: "mock" },
          { label: "证据闸门拦截", value: evidenceBlockedCount, helper: "只拦截受影响矩阵项" },
          { label: "标题未确认", value: titlePendingCount, helper: "不可创建 Final Evidence Pack" },
          { label: "平台配置缺失", value: platformPendingCount, helper: "仅可草稿或人工接管" },
          { label: "预计进入异常", value: openExceptionCount, helper: "保留原因和治理入口" }
        ]}
      />

      <Card
        className="v5-batch-matrix-card"
        title="当月内容生成矩阵"
        size="small"
        extra={
          <Space wrap>
            <Tag>monthlyPlanId: mp-2026-08</Tag>
            <Tag>matrixVersion: draft-01</Tag>
          </Space>
        }
      >
        <BatchGenerationMatrixTable items={batchQueueItems} />
      </Card>

      <section id="schedule" className="v5-section-anchor">
        <ScheduleCalendarLite items={scheduleDraftItems} month="2026-08" />
      </section>

      <section id="exceptions" className="v5-section-anchor">
        <ExceptionQueuePreview items={exceptionItems} />
      </section>
    </>
  );
}
