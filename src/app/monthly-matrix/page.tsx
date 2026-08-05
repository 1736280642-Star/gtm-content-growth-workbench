"use client";

import { BookOutlined, CheckOutlined, ReloadOutlined, SafetyCertificateOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, message, Space, Spin, Tag } from "antd";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { MonthlyFlowNav } from "@/components/MonthlyFlowNav";
import { MonthlyStrategyTable } from "@/components/MonthlyMatrixTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import type { ContentQuotaRule } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

const loadingPlan = { month: "", businessGoal: "", targetDeliverableCount: 0, questionVersionIds: [], quotaRules: [], groups: [] };

function MonthlyMatrixWorkspace() {
  const embedded = usePathname() === "/monthly-plan";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messageApi, messageContext] = message.useMessage();
  const [mutating, setMutating] = useState<"preview" | "approval">();
  const { workspace, loading, error, refresh, preflightStrategy, approveStrategy } = useMonthlyWorkspace();
  const config = workspace?.draftPlan || loadingPlan;
  const strategy = workspace?.strategyPackage;
  const tasks = workspace?.productionTasks || [];
  const allocated = (config.quotaRules || []).reduce((total, rule) => total + rule.expandedDeliverableCount, 0);
  const target = Number(config.targetDeliverableCount || 0);
  const awaitingMaterial = strategy?.preflightResults.filter((item) => item.status === "awaiting_material").reduce((total, item) => total + item.deliverableCount, 0) || 0;
  const generatable = strategy?.preflightResults.filter((item) => item.status === "generatable").reduce((total, item) => total + item.deliverableCount, 0) || 0;
  const strategyProducts = useMemo(() => {
    const packageByVersion = new Map((workspace?.rulePackages || []).map((item) => [item.id, item]));
    const questionProduct = new Map((workspace?.targetQuestions || []).map((item) => [item.questionVersionId, item.productId]));
    const groups = new Map<string, { productId: string; productName: string; rules: ContentQuotaRule[] }>();
    for (const rule of strategy?.quotaRules || []) {
      const snapshot = rule as ContentQuotaRule & { productId?: string; productNameSnapshot?: string };
      const rulePackage = packageByVersion.get(rule.rulePackageVersionId);
      const productId = snapshot.productId || rulePackage?.productId || questionProduct.get(rule.questionVersionId) || "unassigned";
      const productName = snapshot.productNameSnapshot || rulePackage?.productName || (productId === "unassigned" ? "待确认产品" : productId);
      const group = groups.get(productId) || { productId, productName, rules: [] };
      group.rules.push(rule);
      groups.set(productId, group);
    }
    return Array.from(groups.values()).sort((left, right) => left.productName.localeCompare(right.productName, "zh-CN"));
  }, [strategy?.quotaRules, workspace?.rulePackages, workspace?.targetQuestions]);
  const selectedProductId = searchParams.get("productId") || "all";
  const selectedProduct = strategyProducts.find((group) => group.productId === selectedProductId);
  const visibleStrategy = strategy && selectedProduct ? {
    ...strategy,
    quotaRules: selectedProduct.rules,
    preflightResults: strategy.preflightResults.filter((result) => selectedProduct.rules.some((rule) => rule.quotaRuleId === result.quotaRuleId))
  } : strategy;

  function selectProduct(productId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", "strategy");
    if (productId === "all") params.delete("productId"); else params.set("productId", productId);
    router.replace(`/monthly-plan?${params.toString()}`, { scroll: false });
  }

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

  async function deleteRule(rule: ContentQuotaRule) {
    if (!workspace?.plan) return;
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace.month)}/strategy-items/${encodeURIComponent(rule.quotaRuleId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: workspace.plan.version, auditReason: "用户从策略详情删除策略项" })
    });
    const body = await response.json() as { ok?: boolean; data?: { mode?: string; affectedTaskCount?: number }; error?: { message?: string; details?: string[] } };
    if (!response.ok || !body.ok) throw new Error([body.error?.message, ...(body.error?.details || [])].filter(Boolean).join(" ") || "策略项删除失败。");
    await refresh(workspace.month);
    messageApi.success(body.data?.mode === "next_version" ? `已创建新策略版本；${body.data.affectedTaskCount || 0} 篇受影响任务已保留审计。` : "策略项已删除。");
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title="内容策略包"
        titleExtra={<Space size={6}><Tag color="blue">{config.month || "读取中"}</Tag>{strategy ? <Tag>{`策略 v${strategy.version}`}</Tag> : null}</Space>}
        subtitle="配置、预检、批准并查看本月内容策略；任务、正文生产和排程分别在后续步骤处理。"
        actions={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void refresh().catch(() => undefined)}>刷新</Button>{!embedded ? <><Link href="/monthly-matrix/content-types"><Button icon={<BookOutlined />}>管理内容类型</Button></Link><Link href="/monthly-matrix/strategy"><Button type="primary" icon={<SettingOutlined />} disabled={!workspace}>策略包设置</Button></Link></> : null}</Space>}
      />
      <MonthlyFlowNav />

      {error ? <Alert showIcon type="error" message="月度工作区读取失败" description={error} /> : null}
      {!error && workspace?.source.referenceData === "seed_fallback" ? <Alert showIcon type="warning" message="目标问题与知识来源尚未接入" description="当前没有可用的正式接口适配数据，页面不会生成演示问题或伪造生产结果。" /> : null}
      {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取月度内容策略</span></div> : null}

      <V5StatusRail items={[
        { label: "渠道成品总数", value: target, helper: "按最终渠道文章计算" },
        { label: "已分配", value: allocated, helper: "每个渠道配额之和" },
        { label: "待分配", value: Math.max(0, target - allocated), helper: "批准前必须为 0" },
        { label: "可生产", value: generatable, helper: "资料快照一致" },
        { label: "待补资料", value: awaitingMaterial, helper: "仅关键事实缺失" }
      ]} />

      <section className="product-orchestration-switcher" aria-label="按产品查看内容策略">
        <button type="button" className={selectedProductId === "all" ? "is-active" : ""} onClick={() => selectProduct("all")}><span>全部产品</span><strong>{strategy?.targetDeliverableCount || 0} 篇</strong><small>{strategyProducts.length} 个产品</small></button>
        {strategyProducts.map((group) => {
          const deliverables = group.rules.reduce((sum, rule) => sum + rule.expandedDeliverableCount, 0);
          const blocked = strategy?.preflightResults.filter((result) => group.rules.some((rule) => rule.quotaRuleId === result.quotaRuleId) && result.status !== "generatable").length || 0;
          return <button key={group.productId} type="button" className={selectedProductId === group.productId ? "is-active" : ""} onClick={() => selectProduct(group.productId)}><span>{group.productName}</span><strong>{deliverables} 篇</strong><small>{blocked ? `${blocked} 个策略项待处理` : "生产条件正常"}</small></button>;
        })}
      </section>

      <section className="v5-strategy-workspace" aria-labelledby="strategy-heading">
        <div className="v5-section-heading">
          <div><span className="v5-kicker">{selectedProduct ? "当前产品策略" : "全部产品策略"}</span><h2 id="strategy-heading">{selectedProduct?.productName || config.businessGoal || "尚未配置月度业务目标"}</h2></div>
          <Space wrap>
            <Button icon={<SafetyCertificateOutlined />} disabled={!strategy || ["approved", "partially_approved"].includes(strategy.status)} loading={mutating === "preview"} onClick={() => void mutate("preview")}>运行生产预检</Button>
            <Button type="primary" icon={<CheckOutlined />} disabled={strategy?.status !== "preview_ready" || allocated !== target} loading={mutating === "approval"} onClick={() => void mutate("approval")}>人工确认当前版本</Button>
          </Space>
        </div>
        {selectedProduct && visibleStrategy ? <MonthlyStrategyTable strategyPackage={visibleStrategy} tasks={tasks.filter((task) => selectedProduct.rules.some((rule) => rule.quotaRuleId === task.quotaRuleId))} onDelete={deleteRule} /> : strategy ? <div className="product-orchestration-grid">{strategyProducts.map((group) => {
          const deliverables = group.rules.reduce((sum, rule) => sum + rule.expandedDeliverableCount, 0);
          const ready = strategy.preflightResults.filter((result) => group.rules.some((rule) => rule.quotaRuleId === result.quotaRuleId) && result.status === "generatable").reduce((sum, result) => sum + result.deliverableCount, 0);
          return <Card key={group.productId} bordered={false} className="product-orchestration-card"><div className="product-orchestration-card-heading"><div><span>产品内容策略</span><h3>{group.productName}</h3></div><Tag color={ready === deliverables ? "success" : "gold"}>{ready}/{deliverables} 篇可生产</Tag></div><div className="strategy-product-summary"><strong>{group.rules.length}</strong><span>个目标问题与内容类型组合</span></div><div className="product-orchestration-card-footer"><span>系统将按当前产品资料和 GEO 调研结果自动展开文章任务</span><Button type="link" onClick={() => selectProduct(group.productId)}>查看产品策略</Button></div></Card>;
        })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先配置目标问题、内容类型组合和渠道配额" />}
        {strategy?.status === "preview_ready" && allocated !== target ? <Alert showIcon type="warning" message={`当前已分配 ${allocated} 篇，月度目标 ${target} 篇；配额平衡后才能批准。`} /> : null}
      </section>
    </>
  );
}

export default function MonthlyMatrixPage() {
  return <Suspense fallback={<div className="v5-loading-row"><Spin /><span>正在读取产品内容策略</span></div>}><MonthlyMatrixWorkspace /></Suspense>;
}
