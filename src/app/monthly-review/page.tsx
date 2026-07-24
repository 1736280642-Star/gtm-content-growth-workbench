"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Result, Select, Tag, message } from "antd";
import { useState } from "react";
import { MonthlyQuestionReviewDrawer } from "@/components/MonthlyQuestionReviewDrawer";
import { MonthlyQuestionReviewTable } from "@/components/MonthlyQuestionReviewTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { MonthlyQuestionReview } from "@/lib/v5/monthly-review-contracts";
import { useMonthlyObservationReview } from "@/lib/v5/use-monthly-observation-review";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

export default function MonthlyReviewPage() {
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();
  const [month, setMonth] = useState(currentMonth);
  const { review, loading, error, refresh, createProposal } = useMonthlyObservationReview(month, workspaceSetting.currentRole);
  const [selected, setSelected] = useState<MonthlyQuestionReview>();
  const [creating, setCreating] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  if (error && !review) return <Result status="error" title="月度复盘读取失败" subTitle={error} extra={<Button onClick={() => refresh()}>重试</Button>} />;

  return (
    <>
      {contextHolder}
      <PageHeader
        title="月度复盘"
        titleExtra={<Tag color="blue">问题级视图</Tag>}
        subtitle="按目标问题关联 MonthlyPlan、已发布内容、指标与 AI 前台测试；建议只生成待审批 Proposal。"
        actions={<><Select value={month} onChange={setMonth} style={{ width: 132 }} options={[{ value: month, label: month }]} /><Button icon={<ReloadOutlined />} loading={loading} onClick={() => refresh()}>刷新数据</Button></>}
      />
      {review?.source === "pending_config" ? <Alert showIcon type="warning" message="正式月度关联数据待同步" description={review.message} style={{ marginBottom: 16 }} /> : null}
      <V5StatusRail items={[
        { label: "计划成品", value: review?.metrics.plannedContent || 0, helper: "来自 MonthlyPlan 只读适配器" },
        { label: "已发布", value: review?.metrics.publishedContent || 0, helper: "按目标问题关联" },
        { label: "有效回传", value: review?.metrics.effectiveMetricReturns || 0, helper: "已有可用指标" },
        { label: "AI 测试", value: review?.metrics.captureTasks || 0, helper: "本月单次采集任务" },
        { label: "待确认缺口", value: review?.metrics.pendingGaps || 0, helper: "仍由人工判断去向" }
      ]} />
      <Card title="问题表现" size="small" loading={!review && loading} extra={<Tag>计划 · 发布 · 指标 · AI 回答</Tag>}>
        {review?.questions.length ? <MonthlyQuestionReviewTable rows={review.questions} onOpen={setSelected} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前月份没有可关联的问题级数据；接入正式问题和 MonthlyPlan 后会自动聚合。" />}
      </Card>
      {review?.proposals.length ? <Card title="下月 Proposal" size="small" style={{ marginTop: 16 }}><div className="monthly-proposal-list">{review.proposals.map((item) => <div key={item.id}><div><strong>{item.recommendation}</strong><Tag color="blue">{item.status}</Tag></div><span>{item.targetMonth} · 未创建月度任务 · 未修改配额</span><p>{item.rationale}</p></div>)}</div></Card> : null}
      <MonthlyQuestionReviewDrawer
        row={selected}
        proposals={review?.proposals || []}
        open={Boolean(selected)}
        creating={creating}
        onClose={() => setSelected(undefined)}
        onCreateProposal={async (row) => {
          setCreating(true);
          try {
            await createProposal(row.id, row.recommendation, `基于 ${row.month} 的发布、指标、AI 测试和已确认缺口形成。`);
            messageApi.success("下月 Proposal 已生成；未创建生产任务或修改配额");
          } catch (requestError) {
            messageApi.error(requestError instanceof Error ? requestError.message : "Proposal 创建失败");
          } finally {
            setCreating(false);
          }
        }}
      />
    </>
  );
}
