"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Result, Select, Tag } from "antd";
import { useState } from "react";
import { MonthlyQuestionReviewTable } from "@/components/MonthlyQuestionReviewTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useMonthlyObservationReview } from "@/lib/v5/use-monthly-observation-review";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

export default function MonthlyReviewPage() {
  const [month, setMonth] = useState(currentMonth);
  const { review, loading, error, refresh } = useMonthlyObservationReview(month, "workbench_operator");

  if (error && !review) return <Result status="error" title="月度复盘读取失败" subTitle={error} extra={<Button onClick={() => refresh()}>重试</Button>} />;

  return (
    <>
      <PageHeader
        title="数据复盘"
        titleExtra={<Tag color="blue">问题级视图</Tag>}
        subtitle="系统按目标问题自动关联 MonthlyPlan、已发布内容、指标与 AI 前台复测，形成下一月决策基线。"
        actions={<><Select value={month} onChange={setMonth} style={{ width: 132 }} options={[{ value: month, label: month }]} /><Button icon={<ReloadOutlined />} loading={loading} onClick={() => refresh()}>刷新数据</Button></>}
      />
      {review?.source === "pending_config" ? <Alert showIcon type="warning" message="正式月度关联数据待同步" description={review.message} style={{ marginBottom: 16 }} /> : null}
      <V5StatusRail items={[
        { label: "计划成品", value: review?.metrics.plannedContent || 0, helper: "来自 MonthlyPlan 只读适配器" },
        { label: "已发布", value: review?.metrics.publishedContent || 0, helper: "按目标问题关联" },
        { label: "有效回传", value: review?.metrics.effectiveMetricReturns || 0, helper: "已有可用指标" },
        { label: "24h 存活", value: `${review?.metrics.survival24hPassed || 0}/${review?.metrics.survival24hEligible || 0}`, helper: "仅统计已到观察窗口的内容" },
        { label: "72h 存活", value: `${review?.metrics.survival72hPassed || 0}/${review?.metrics.survival72hEligible || 0}`, helper: "删除内容保留原发布事实" },
        { label: "AI 测试", value: review?.metrics.captureTasks || 0, helper: "本月单次采集任务" },
        { label: "待确认缺口", value: review?.metrics.pendingGaps || 0, helper: "仍由人工判断去向" }
      ]} />
      <Card title="问题表现" size="small" loading={!review && loading} extra={<Tag>计划 · 发布 · 指标 · AI 回答</Tag>}>
        {review?.questions.length ? <MonthlyQuestionReviewTable rows={review.questions} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前月份没有可关联的问题级数据；接入正式问题和 MonthlyPlan 后会自动聚合。" />}
      </Card>
      <Card title="下一月决策基线" size="small" style={{ marginTop: 16 }}>
        {review?.questions.length ? <div className="monthly-proposal-list">{review.questions.map((item) => <div key={item.id}><div><strong>{item.questionText}</strong><Tag color={item.dataStatus === "complete" ? "green" : "gold"}>{item.dataStatus}</Tag></div><p>{item.recommendation}</p><span>系统生成 · 仅作为下一月 MonthlyPlan 输入，不需要用户手工创建 Proposal</span></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="数据积累后系统会自动生成下一月决策基线" />}
      </Card>
    </>
  );
}
