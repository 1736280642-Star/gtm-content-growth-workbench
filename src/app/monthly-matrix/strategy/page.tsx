"use client";

import { ArrowLeftOutlined, BookOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Spin, Tag } from "antd";
import Link from "next/link";
import { MonthlyPlanConfigPanel } from "@/components/MonthlyPlanConfigPanel";
import { PageHeader } from "@/components/PageHeader";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

const loadingPlan = { month: "", businessGoal: "", targetDeliverableCount: 0, questionVersionIds: [], quotaRules: [], groups: [] };

export default function MonthlyStrategyWorkspacePage() {
  const { workspace, loading, error, saveMonthlyPlan, runTypeMatch, confirmTypeMatch } = useMonthlyWorkspace();
  const strategy = workspace?.strategyPackage;
  const locked = strategy?.status === "approved" || strategy?.status === "partially_approved";

  return (
    <>
      <PageHeader
        title="月度策略工作区"
        titleExtra={<Space size={6}><Tag color="blue">{workspace?.month || "读取中"}</Tag>{strategy ? <Tag>{`策略 v${strategy.version}`}</Tag> : null}</Space>}
        subtitle="确认目标问题、内容类型组合、渠道配额和资料版本；保存后回到矩阵运行生产预检。"
        actions={<Space wrap><Link href="/monthly-matrix"><Button icon={<ArrowLeftOutlined />}>返回月度内容矩阵</Button></Link><Link href="/monthly-matrix/content-types"><Button icon={<BookOutlined />}>管理内容类型</Button></Link></Space>}
      />
      {error ? <Alert showIcon type="error" message="月度策略工作区读取失败" description={error} /> : null}
      {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取月度策略配置</span></div> : null}
      <MonthlyPlanConfigPanel
        locked={locked}
        value={workspace?.draftPlan || loadingPlan}
        rulePackages={workspace?.rulePackages || []}
        channels={workspace?.channels || []}
        targetQuestions={workspace?.targetQuestions || []}
        knowledgeBases={workspace?.knowledgeBases || []}
        articleTypeProfiles={workspace?.articleTypeProfiles || []}
        typeMatchRun={workspace?.typeMatchRun}
        onSave={saveMonthlyPlan}
        onRunMatch={runTypeMatch}
        onConfirmMatch={confirmTypeMatch}
      />
    </>
  );
}
