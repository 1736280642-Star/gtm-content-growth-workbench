"use client";

import { EditOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Drawer, Segmented, Space, message } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import MonthlyMatrixPage from "@/app/monthly-matrix/page";
import MonthlyMatrixTasksPage from "@/app/monthly-matrix/tasks/page";
import MonthlyBatchGenerationPage from "@/app/monthly-matrix/batch-generation/page";
import MonthlySchedulePage from "@/app/monthly-matrix/schedule/page";
import MonthlyStrategyWorkspacePage from "@/app/monthly-matrix/strategy/page";
import DailyExecutionPage from "@/app/daily-execution/page";

type StepKey = "strategy" | "tasks" | "generation" | "execution";

const stepOptions = [
  { label: "1 月度策略", value: "strategy" },
  { label: "2 内容任务", value: "tasks" },
  { label: "3 内容生成", value: "generation" },
  { label: "4 排程与执行", value: "execution" }
];

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

function MonthlyPlanWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [running, setRunning] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const requestedStep = searchParams.get("step");
  const step = stepOptions.some((item) => item.value === requestedStep) ? requestedStep as StepKey : "strategy";
  const executionView = searchParams.get("view") === "schedule" ? "schedule" : "today";
  const strategyDrawerOpen = searchParams.get("drawer") === "strategy";
  const month = searchParams.get("month") || currentMonth();

  async function runAutomation() {
    setRunning(true);
    try {
      const response = await fetch("/api/v5/automation/monthly", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, action: "all" })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "自动化运行失败");
      const strategy = payload.data.strategy;
      const schedule = payload.data.schedule;
      const issues = [...(strategy?.issues || []), ...(schedule?.issues || [])];
      if (issues.length) messageApi.warning(`${strategy?.message || schedule?.message} ${issues[0]}`);
      else messageApi.success(strategy?.message || schedule?.message || "自动化已运行");
      router.refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "自动化运行失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      {contextHolder}
      <div className="unified-workspace-nav">
        <Segmented
          block
          value={step}
          options={stepOptions}
          onChange={(value) => router.push(`/monthly-plan?step=${value}&month=${month}`)}
        />
        <Space wrap>
          <Button type="primary" icon={<RobotOutlined />} loading={running} onClick={runAutomation}>
            立即运行自动化
          </Button>
          <Button icon={<EditOutlined />} onClick={() => router.push(`/monthly-plan?step=strategy&month=${month}&drawer=strategy`)}>
            人工修改策略
          </Button>
        </Space>
      </div>

      {step === "strategy" ? <MonthlyMatrixPage /> : null}
      {step === "tasks" ? <MonthlyMatrixTasksPage /> : null}
      {step === "generation" ? <MonthlyBatchGenerationPage /> : null}
      {step === "execution" ? (
        <>
          <Space className="unified-workspace-subnav" wrap>
            <Button type={executionView === "today" ? "primary" : "default"} onClick={() => router.push(`/monthly-plan?step=execution&view=today&month=${month}`)}>当日执行</Button>
            <Button type={executionView === "schedule" ? "primary" : "default"} onClick={() => router.push(`/monthly-plan?step=execution&view=schedule&month=${month}`)}>发布排程</Button>
          </Space>
          {executionView === "schedule" ? <MonthlySchedulePage /> : <DailyExecutionPage />}
        </>
      ) : null}

      <Drawer
        title="人工修改月度策略"
        width="min(960px, 92vw)"
        open={strategyDrawerOpen}
        destroyOnClose
        onClose={() => router.replace(`/monthly-plan?step=strategy&month=${month}`)}
      >
        <MonthlyStrategyWorkspacePage />
      </Drawer>
    </>
  );
}

export default function MonthlyPlanPage() {
  return <Suspense fallback={null}><MonthlyPlanWorkspace /></Suspense>;
}
