"use client";

import { ArrowRightOutlined, CheckOutlined, ReloadOutlined, SafetyCertificateOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, message, Space, Spin, Table, Tabs, Tag } from "antd";
import Link from "next/link";
import { useState } from "react";
import { MonthlyPlanConfigPanel } from "@/components/MonthlyPlanConfigPanel";
import { MonthlyStrategyTable } from "@/components/MonthlyMatrixTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";

const loadingPlan = { month: "", businessGoal: "", targetDeliverableCount: 0, questionVersionIds: [], quotaRules: [], groups: [] };

export default function MonthlyMatrixPage() {
  const [messageApi, messageContext] = message.useMessage();
  const [configOpen, setConfigOpen] = useState(false);
  const [mutating, setMutating] = useState<"preview" | "approval">();
  const { workspace, loading, error, refresh, saveMonthlyPlan, preflightStrategy, approveStrategy } = useMonthlyWorkspace();
  const config = workspace?.draftPlan || loadingPlan;
  const strategy = workspace?.strategyPackage;
  const tasks = workspace?.productionTasks || [];
  const allocated = (config.quotaRules || []).reduce((total, rule) => total + rule.expandedDeliverableCount, 0);
  const target = Number(config.targetDeliverableCount || 0);
  const awaitingMaterial = strategy?.preflightResults.filter((item) => item.status === "awaiting_material").reduce((total, item) => total + item.deliverableCount, 0) || 0;
  const generatable = strategy?.preflightResults.filter((item) => item.status === "generatable").reduce((total, item) => total + item.deliverableCount, 0) || 0;
  const locked = strategy?.status === "approved" || strategy?.status === "partially_approved";

  async function mutate(type: "preview" | "approval") {
    setMutating(type);
    try {
      if (type === "preview") await preflightStrategy();
      else await approveStrategy();
      messageApi.success(type === "preview" ? "生产预检已完成。" : "内容策略包已批准并展开为矩阵任务。");
    } catch (reason) {
      messageApi.error(reason instanceof Error ? reason.message : "内容策略操作失败。");
    } finally {
      setMutating(undefined);
    }
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title="月度内容矩阵"
        titleExtra={<Space size={6}><Tag color="blue">{config.month || "读取中"}</Tag>{strategy ? <Tag>{`策略 v${strategy.version}`}</Tag> : null}</Space>}
        subtitle="创建、配置、预检并批准本月内容策略；批准后生成中心只负责生产和排程。"
        actions={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void refresh().catch(() => undefined)}>刷新</Button><Button type="primary" icon={<SettingOutlined />} disabled={!workspace} onClick={() => setConfigOpen(true)}>{locked ? "查看策略" : "配置月度策略"}</Button></Space>}
      />

      {error ? <Alert showIcon type="error" message="月度工作区读取失败" description={error} /> : null}
      {!error && workspace?.source.referenceData === "seed_fallback" ? <Alert showIcon type="warning" message="目标问题与知识来源尚未接入" description="当前没有可用的正式接口适配数据，页面不会生成演示问题或伪造生产结果。" /> : null}
      {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取月度内容策略</span></div> : null}

      <div className="v5-monthly-flow-rail" aria-label="月度生产流程"><span className="is-active">1 内容策略包</span><span>2 矩阵任务</span><span>3 内容生成</span><span>4 人工排程</span></div>
      <V5StatusRail items={[
        { label: "渠道成品总数", value: target, helper: "按最终渠道文章计算" },
        { label: "已分配", value: allocated, helper: "每渠道配额之和" },
        { label: "待分配", value: Math.max(0, target - allocated), helper: "批准前必须为 0" },
        { label: "可生产", value: generatable, helper: "资料快照一致" },
        { label: "待补资料", value: awaitingMaterial, helper: "仅关键事实缺失" }
      ]} />

      <section className="v5-strategy-workspace" aria-labelledby="strategy-heading">
        <div className="v5-section-heading">
          <div><span className="v5-kicker">内容策略包</span><h2 id="strategy-heading">{config.businessGoal || "尚未配置月度业务目标"}</h2></div>
          <Space wrap>
            <Button icon={<SafetyCertificateOutlined />} disabled={!strategy || locked} loading={mutating === "preview"} onClick={() => void mutate("preview")}>运行生产预检</Button>
            <Button type="primary" icon={<CheckOutlined />} disabled={strategy?.status !== "preview_ready" || allocated !== target} loading={mutating === "approval"} onClick={() => void mutate("approval")}>批准内容策略包</Button>
          </Space>
        </div>
        {strategy ? <MonthlyStrategyTable strategyPackage={strategy} onEdit={() => setConfigOpen(true)} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先配置目标问题、文章类型和渠道配额" />}
        {strategy?.status === "preview_ready" && allocated !== target ? <Alert showIcon type="warning" message={`当前已分配 ${allocated} 篇，月度目标 ${target} 篇；配额平衡后才能批准。`} /> : null}
      </section>

      <Tabs className="v5-matrix-tabs" items={[
        {
          key: "tasks",
          label: `矩阵任务 ${tasks.length}`,
          children: tasks.length ? <Table<ProductionMatrixTask> rowKey="taskId" size="small" pagination={{ pageSize: 10 }} dataSource={tasks} columns={[
            { title: "基础选题 / 渠道版本", dataIndex: "title", render: (value: string, record) => <div className="v5-table-stack"><strong>{value}</strong><span>{record.question}</span></div> },
            { title: "文章类型", dataIndex: "contentType", width: 140 },
            { title: "渠道", dataIndex: "channel", width: 100, render: (value: string) => <Tag>{value}</Tag> },
            { title: "状态", dataIndex: "status", width: 130, render: (value: ProductionMatrixTask["status"]) => <Tag color={value === "awaiting_material" ? "gold" : "blue"}>{value === "awaiting_material" ? "待补资料" : "待生成"}</Tag> }
          ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="策略批准后，系统会按渠道配额展开矩阵任务" />
        },
        {
          key: "production",
          label: "批量生成中心",
          children: <div className="v5-inline-entry"><div><strong>已批准策略的内容生产与人工排程</strong><span>生成中心不会反向修改目标问题、文章类型、渠道配额或资料绑定。</span></div><Link href="/monthly-matrix/batch-generation"><Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" disabled={!locked}>进入批量生成中心</Button></Link></div>
        }
      ]} />

      <MonthlyPlanConfigPanel
        open={configOpen}
        locked={locked}
        value={config}
        rulePackages={workspace?.rulePackages || []}
        channels={workspace?.channels || []}
        targetQuestions={workspace?.targetQuestions || []}
        knowledgeBases={workspace?.knowledgeBases || []}
        articleExpressionPresets={workspace?.articleExpressionPresets || []}
        onClose={() => setConfigOpen(false)}
        onSave={saveMonthlyPlan}
      />
    </>
  );
}
