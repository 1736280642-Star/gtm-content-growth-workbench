"use client";

import { ExperimentOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Result, Space, Tabs, Tag, message } from "antd";
import Link from "next/link";
import { useState } from "react";
import { CapturedAnswerWorkspace } from "@/components/CapturedAnswerWorkspace";
import { CaptureComparisonWorkspace } from "@/components/CaptureComparisonWorkspace";
import { FrontendCaptureTaskTable } from "@/components/FrontendCaptureTaskTable";
import { NewCaptureTaskDialog } from "@/components/NewCaptureTaskDialog";
import { PageHeader } from "@/components/PageHeader";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { CaptureComparison, CapturedAnswer, ObservationGapDestination } from "@/lib/v5/observation-contracts";
import { useFrontendCapture } from "@/lib/v5/use-frontend-capture";

export default function AiFrontTestPage() {
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();
  const { workspace, loading, error, refresh, createTasks, analyzeGaps, reviewAnswer, compareTasks } = useFrontendCapture(workspaceSetting.currentRole);
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState("tasks");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedAnswerId, setSelectedAnswerId] = useState<string>();
  const [comparison, setComparison] = useState<CaptureComparison>();
  const [comparing, setComparing] = useState(false);

  if (error && !workspace) return <Result status="error" title="AI 前台测试读取失败" subTitle={error} extra={<Button onClick={() => refresh()}>重试</Button>} />;
  if (!workspace) return <Card loading={loading} />;

  async function handleCompare(baselineTaskId: string, comparisonTaskId: string) {
    setComparing(true);
    try {
      const next = await compareTasks(baselineTaskId, comparisonTaskId);
      setComparison(next);
      setSelectedTaskIds([baselineTaskId, comparisonTaskId]);
      messageApi.success("已生成两次采集样本的差异");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "任务对比失败");
    } finally {
      setComparing(false);
    }
  }

  const taskTab = workspace.tasks.length ? (
    <FrontendCaptureTaskTable
      tasks={workspace.tasks}
      selectedTaskIds={selectedTaskIds}
      onSelectionChange={setSelectedTaskIds}
      onViewAnswer={(task) => { setSelectedAnswerId(task.answerId); setActiveTab("answers"); }}
      onCompare={() => setActiveTab("comparison")}
    />
  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有采集任务。启动一次真实前台测试，任务状态和恢复路径会显示在这里。"><Button type="primary" icon={<PlusOutlined />} onClick={() => setDialogOpen(true)}>新建单次任务</Button></Empty>;

  return (
    <>
      {contextHolder}
      <PageHeader
        title="AI 前台测试"
        titleExtra={<Tag color={workspace.environment.source === "local_runner" ? "green" : "orange"}>{workspace.environment.source === "local_runner" ? "环境正常" : "待连接环境"}</Tag>}
        subtitle="对已定义问题执行单次前台采集；每条结果都保留采集条件、适配器版本、截图和 SHA-256。"
        actions={<Space wrap><Link href="/ai-front-test/environment"><Button icon={<SafetyCertificateOutlined />}>采集环境</Button></Link><Button type="primary" icon={<PlusOutlined />} onClick={() => setDialogOpen(true)}>新建单次任务</Button></Space>}
      />
      {workspace.reference.source === "pending_config" ? <Alert className="observation-source-alert" showIcon type="warning" message="正式上游契约待同步" description={workspace.reference.message} /> : null}
      <div className="observation-assurance-strip">
        <span><ExperimentOutlined /> 立即执行一次</span>
        <span>原始采集包不可变</span>
        <span>人工确认缺口去向</span>
        <span>不自动创建月度任务</span>
      </div>
      <Card className="observation-workbench-card" size="small">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: "tasks", label: `采集任务 ${workspace.tasks.length}`, children: taskTab },
            {
              key: "answers",
              label: `回答与引用证据 ${workspace.answers.length}`,
              children: <CapturedAnswerWorkspace
                answers={workspace.answers}
                artifacts={workspace.artifacts}
                gaps={workspace.gaps}
                reviews={workspace.reviews}
                selectedAnswerId={selectedAnswerId}
                onSelectAnswer={setSelectedAnswerId}
                onAnalyzeGaps={async (answer: CapturedAnswer) => { await analyzeGaps(answer.id, answer.reviewVersion); messageApi.success("候选缺口已生成，等待人工判断"); }}
                onReviewGaps={async (answer: CapturedAnswer, gapIds: string[], destinations: ObservationGapDestination[], note: string) => { await reviewAnswer(answer.id, answer.reviewVersion, gapIds, destinations, note); messageApi.success("业务去向已确认；未创建月度任务"); }}
              />
            },
            {
              key: "comparison",
              label: "任务对比",
              children: <CaptureComparisonWorkspace key={selectedTaskIds.join("-")} tasks={workspace.tasks} initialTaskIds={selectedTaskIds} result={comparison} loading={comparing} onCompare={handleCompare} />
            }
          ]}
        />
      </Card>
      <NewCaptureTaskDialog
        open={dialogOpen}
        questions={workspace.reference.questions}
        environment={workspace.environment}
        submitting={submitting}
        onCancel={() => setDialogOpen(false)}
        onSubmit={async (input) => {
          setSubmitting(true);
          try {
            await createTasks(input);
            setDialogOpen(false);
            setActiveTab("tasks");
            messageApi.success(workspace.environment.runner.status === "ready" ? "单次采集任务已进入 Runner 队列" : "任务已保存，等待本地 Runner 连接");
          } catch (requestError) {
            messageApi.error(requestError instanceof Error ? requestError.message : "单次采集任务创建失败");
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </>
  );
}
