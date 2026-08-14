"use client";

import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Input, Space, Statistic, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import type { MonthlyReview } from "@/lib/v5/monthly-review-contracts";
import type { V5QuestionView } from "@/lib/v5/question-contracts";

type QuestionsResponse = { ok: true; data: { questions: V5QuestionView[] } };
type ReviewResponse = { ok: true; data: MonthlyReview };

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未复测";
}

export default function QuestionsKeywordsPage() {
  const [questions, setQuestions] = useState<V5QuestionView[]>([]);
  const [review, setReview] = useState<MonthlyReview>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const [questionResult, reviewResult] = await Promise.allSettled([
      callJsonApi<QuestionsResponse>("/api/v5/questions", { cache: "no-store" }),
      callJsonApi<ReviewResponse>(`/api/v5/monthly-reviews/${currentMonth()}`, { cache: "no-store" })
    ]);
    if (questionResult.status === "fulfilled") {
      setQuestions(questionResult.value.data.questions.filter((item) => item.geoMonitoringApproval?.status === "approved"));
    } else {
      setError(questionResult.reason instanceof Error ? questionResult.reason.message : "GEO 问题监控列表加载失败");
    }
    if (reviewResult.status === "fulfilled") setReview(reviewResult.value.data);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => questions
    .filter((item) => `${item.currentVersion.text} ${item.currentVersion.product || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .map((item) => ({
      ...item,
      review: review?.questions.find((row) => row.questionKey === item.questionId)
    })), [questions, review?.questions, search]);

  if (error && !questions.length) return <PageErrorState title="GEO 问题监控列表加载失败" description={error} onRetry={() => void refresh()} />;

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    <PageHeader
      title="GEO 问题监控"
      subtitle="这里只展示经 GEO 调研结果人工确认的问题；确认即入池并进入后续 GEO 监控，不再设置第二次人工治理。"
      actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>刷新</Button>}
    />
    {error ? <Alert showIcon type="warning" message="部分监控数据暂不可用" description={error} /> : null}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
      <Card><Statistic title="已确认监控问题" value={questions.length} /></Card>
      <Card><Statistic title="已完成至少一次复测" value={rows.filter((item) => item.review?.lastRetestedAt).length} /></Card>
    </div>
    <Card
      title="问题监控列表"
      extra={<Input allowClear prefix={<SearchOutlined />} placeholder="搜索问题或产品" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 260 }} />}
    >
      <Table
        rowKey="questionId"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="暂无已确认问题，请先在产品 GEO 调研结果中选择问题并确认入池。" /> }}
        columns={[
          { title: "监控问题", dataIndex: ["currentVersion", "text"] },
          { title: "产品", dataIndex: ["currentVersion", "product"], render: (value?: string) => value || "-" },
          { title: "人工确认时间", render: (_, row) => formatTime(row.geoMonitoringApproval?.approvedAt) },
          { title: "最近复测时间", render: (_, row) => formatTime(row.review?.lastRetestedAt) },
          { title: "AI 回答与引用", render: (_, row) => row.review?.captureSummary || "尚未产生复测结果" },
          { title: "监控状态", render: (_, row) => <Tag color={row.review?.lastRetestedAt ? "green" : "gold"}>{row.review?.lastRetestedAt ? "已复测" : "待首次复测"}</Tag> }
        ]}
      />
    </Card>
    <Typography.Text type="secondary">问题的唯一人工入口是 GEO 调研结果确认；MonthlyPlan 和 GEO 监控仅读取这份已确认清单。</Typography.Text>
  </Space>;
}
