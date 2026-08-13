"use client";

import { CheckCircleFilled, EyeOutlined, ReloadOutlined, SettingOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Drawer, Empty, Space, Spin, Statistic, Table, Tag, Typography, message } from "antd";
import type { TableProps } from "antd";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ProductGeoOverview } from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";
import { classifyProductionResponsibility } from "@/lib/v5/responsibility";

interface ProductsResponse { ok: true; products: ProductRegistryItem[]; overviews: ProductGeoOverview[] }

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

function taskStatus(task: ProductionMatrixTask) {
  if (task.status === "published") return { label: "已发布", color: "green" };
  if (task.scheduledAt || task.status === "scheduled") return { label: "待发布", color: "blue" };
  if (task.status === "available") return { label: "正文已就绪", color: "cyan" };
  if (task.status === "generating") return { label: "正在生成", color: "processing" };
  if (task.status === "awaiting_material") return { label: "等待资料", color: "gold" };
  if (task.status === "system_recovering") return { label: "系统处理中", color: "orange" };
  return { label: task.status, color: "default" };
}

function taskActivityRank(task: ProductionMatrixTask) {
  if (task.failureReason || task.ctaValidationStatus === "failed") return 0;
  if (classifyProductionResponsibility(task.status).userActionRequired || task.status === "awaiting_material") return 1;
  if (["generating", "system_recovering"].includes(task.status)) return 2;
  if (["ready_for_generation", "available"].includes(task.status)) return 3;
  return 4;
}

function taskTime(task: ProductionMatrixTask) {
  const value = task.scheduledAt || task.updatedAt;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ContentAutomationWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const month = searchParams.get("month") || currentMonth();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace(month);
  const [products, setProducts] = useState<ProductRegistryItem[]>([]);
  const [overviews, setOverviews] = useState<ProductGeoOverview[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [strategyProductId, setStrategyProductId] = useState<string>();
  const [savingProductId, setSavingProductId] = useState<string>();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (pathname !== "/monthly-plan") return;
    const query = searchParams.toString();
    router.replace(`/content-automation${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const refreshProducts = useCallback(async () => {
    const response = await fetch("/api/v5/products", { cache: "no-store" });
    const body = await response.json() as ProductsResponse;
    if (!response.ok || !body.ok) throw new Error("推广产品读取失败");
    setProducts(body.products || []);
    setOverviews(body.overviews || []);
  }, []);

  useEffect(() => { void refreshProducts().catch((reason) => messageApi.error(reason.message)); }, [messageApi, refreshProducts]);

  const tasks = useMemo(() => workspace?.productionTasks || [], [workspace?.productionTasks]);
  const packages = useMemo(() => workspace?.rulePackages || [], [workspace?.rulePackages]);
  const questionProduct = useMemo(() => new Map((workspace?.targetQuestions || []).map((item) => [item.questionVersionId, item.productId])), [workspace?.targetQuestions]);
  const packageById = useMemo(() => new Map(packages.map((item) => [item.id, item])), [packages]);
  const productGroups = useMemo(() => {
    const groups = new Map<string, { productId: string; productName: string; tasks: ProductionMatrixTask[] }>();
    for (const task of tasks) {
      const pack = packageById.get(task.rulePackageVersionId);
      const productId = task.productId || pack?.productId || questionProduct.get(task.questionVersionId) || "unassigned";
      const productName = task.productNameSnapshot || pack?.productName || products.find((item) => item.productId === productId)?.displayName || "待确认产品";
      const group = groups.get(productId) || { productId, productName, tasks: [] };
      group.tasks.push(task);
      groups.set(productId, group);
    }
    for (const overview of overviews.filter((item) => item.isPromoting)) {
      if (!groups.has(overview.productId)) groups.set(overview.productId, { productId: overview.productId, productName: products.find((item) => item.productId === overview.productId)?.displayName || overview.productId, tasks: [] });
    }
    return Array.from(groups.values());
  }, [overviews, packageById, products, questionProduct, tasks]);
  const promoting = overviews.filter((item) => item.isPromoting);
  const published = tasks.filter((item) => item.status === "published").length;
  const generating = tasks.filter((item) => item.status === "generating" || item.status === "ready_for_generation").length;
  const pendingPublish = tasks.filter((item) => Boolean(item.scheduledAt) && item.status !== "published").length;
  const failureAlerts = tasks.filter((item) => classifyProductionResponsibility(item.status).userActionRequired);
  const taskProductById = useMemo(() => new Map(productGroups.flatMap((group) => group.tasks.map((task) => [task.taskId, { productId: group.productId, productName: group.productName }] as const))), [productGroups]);
  const activeTasks = useMemo(() => tasks
    .filter((task) => task.status !== "published")
    .sort((left, right) => taskActivityRank(left) - taskActivityRank(right) || taskTime(left) - taskTime(right)), [tasks]);
  const publishedTasks = useMemo(() => tasks
    .filter((task) => task.status === "published")
    .sort((left, right) => taskTime(right) - taskTime(left)), [tasks]);
  const selectedGroup = productGroups.find((item) => item.productId === strategyProductId);
  const selectedPack = selectedGroup ? packages.find((item) => item.productId === selectedGroup.productId) : undefined;

  const taskColumns: NonNullable<TableProps<ProductionMatrixTask>["columns"]> = [
    { title: "文章", dataIndex: "title", ellipsis: true },
    { title: "产品", render: (_, task) => taskProductById.get(task.taskId)?.productName || "待确认" },
    { title: "渠道", dataIndex: "channel" },
    { title: "预计发布时间", dataIndex: "scheduledAt", render: (value?: string) => value ? new Date(value).toLocaleString("zh-CN") : "系统计算中" },
    { title: "状态", render: (_, task) => { const status = taskStatus(task); return <Tag color={status.color}>{status.label}</Tag>; } },
    { title: "结果", render: (_, task) => {
      const taskProduct = taskProductById.get(task.taskId);
      return task.formalDraftId
        ? <Link href={`/v5/drafts/${encodeURIComponent(task.formalDraftId)}`}>查看正文</Link>
        : classifyProductionResponsibility(task.status).userActionRequired && taskProduct?.productId !== "unassigned"
          ? <Link href={`/products/${encodeURIComponent(taskProduct?.productId || "")}?tab=materials`}><Button danger size="small" icon={<WarningOutlined />}>补充资料</Button></Link>
          : <Typography.Text type="secondary">系统自动处理</Typography.Text>;
    } }
  ];

  async function togglePromotion(productId: string, checked: boolean) {
    setSavingProductId(productId);
    try {
      const response = await fetch(`/api/v5/products/${encodeURIComponent(productId)}/promotion`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ isPromoting: checked }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "推广范围保存失败");
      await Promise.all([refreshProducts(), refresh(month)]);
      messageApi.success(checked ? "已纳入自动推广" : "已暂停自动推广");
    } catch (reason) {
      messageApi.error(reason instanceof Error ? reason.message : "推广范围保存失败");
    } finally { setSavingProductId(undefined); }
  }

  return <>
    {contextHolder}
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 20 }}>
      <div><Typography.Title level={2} style={{ margin: 0 }}>内容自动化</Typography.Title><Typography.Text type="secondary">系统按已批准策略持续生成、排程和发布；这里只查看结果与处理无法自动恢复的事项。</Typography.Text></div>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void Promise.all([refresh(month), refreshProducts()])}>刷新</Button>
    </div>
    {error ? <Alert showIcon type="error" message="内容自动化读取失败" description={error} /> : null}
    {loading && !workspace ? <Card><Spin /> 正在读取自动化状态</Card> : null}

    <Card title="推广范围" extra={<Button icon={<SettingOutlined />} onClick={() => setScopeOpen(true)}>选择推广产品</Button>} style={{ marginBottom: 16 }}>
      <Space wrap>{promoting.length ? promoting.map((item) => <Tag color="green" icon={<CheckCircleFilled />} key={item.productId}>{products.find((product) => product.productId === item.productId)?.displayName || item.productId}</Tag>) : <Typography.Text type="secondary">尚未选择推广产品</Typography.Text>}</Space>
    </Card>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
      <Card><Statistic title="已发布" value={published} suffix="篇" /></Card>
      <Card><Statistic title="正在生成" value={generating} suffix="篇" /></Card>
      <Card><Statistic title="待发布" value={pendingPublish} suffix="篇" /></Card>
      <Card><Statistic title="失败告警" value={failureAlerts.length} suffix="项" valueStyle={{ color: failureAlerts.length ? "#cf1322" : undefined }} /></Card>
    </div>

    <Card title="产品运行状态" style={{ marginBottom: 16 }}>
      <Table rowKey="productId" pagination={false} dataSource={productGroups} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="推广产品形成策略后会显示在这里" /> }} columns={[
        { title: "产品", dataIndex: "productName" },
        { title: "策略包", render: (_, row) => packages.some((item) => item.productId === row.productId) ? <Tag color="green">已就绪</Tag> : <Tag color="gold">等待编译</Tag> },
        { title: "已生成", render: (_, row) => row.tasks.filter((item) => ["available", "scheduled", "published"].includes(item.status)).length },
        { title: "已发布", render: (_, row) => row.tasks.filter((item) => item.status === "published").length },
        { title: "异常", render: (_, row) => row.tasks.filter((item) => classifyProductionResponsibility(item.status).userActionRequired).length },
        { title: "", render: (_, row) => <Button type="link" icon={<EyeOutlined />} onClick={() => setStrategyProductId(row.productId)}>查看策略包</Button> }
      ]} />
    </Card>

    <Card
      title="文章与排程队列"
      extra={<Space size={8}><Tag color="blue">流转中 {activeTasks.length}</Tag><Tag>已归档 {publishedTasks.length}</Tag></Space>}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>默认只展示仍在生成、排程或等待处理的文章；发布完成后自动移入下方归档。</Typography.Paragraph>
      {activeTasks.length ? (
        <Table rowKey="taskId" dataSource={activeTasks} pagination={activeTasks.length > 8 ? { pageSize: 8, hideOnSinglePage: true } : false} columns={taskColumns} />
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有流转中的文章" />}
      {publishedTasks.length ? (
        <Collapse
          ghost
          style={{ marginTop: 12 }}
          items={[{
            key: "published-archive",
            label: <Space><Typography.Text strong>已发布归档</Typography.Text><Tag color="green">{publishedTasks.length} 篇</Tag><Typography.Text type="secondary">按最近发布排序，默认收起</Typography.Text></Space>,
            children: <Table rowKey="taskId" size="small" dataSource={publishedTasks} pagination={publishedTasks.length > 8 ? { pageSize: 8, hideOnSinglePage: true } : false} columns={taskColumns} />
          }]}
        />
      ) : null}
    </Card>

    <Drawer title="选择推广产品" open={scopeOpen} onClose={() => setScopeOpen(false)} width={520}>
      <Space direction="vertical" size={14} style={{ width: "100%" }}>{products.map((product) => { const checked = Boolean(overviews.find((item) => item.productId === product.productId)?.isPromoting); return <Card size="small" key={product.productId}><Checkbox checked={checked} disabled={savingProductId === product.productId} onChange={(event) => void togglePromotion(product.productId, event.target.checked)}>{product.displayName}</Checkbox></Card>; })}</Space>
    </Drawer>
    <Drawer title="产品策略包" open={Boolean(strategyProductId)} onClose={() => setStrategyProductId(undefined)} width={720}>
      {selectedGroup && selectedPack ? <Descriptions bordered column={1}>
        <Descriptions.Item label="产品">{selectedGroup.productName}</Descriptions.Item>
        <Descriptions.Item label="策略状态">只读 · 已通过系统门禁</Descriptions.Item>
        <Descriptions.Item label="重点问题">{selectedGroup.tasks.map((item) => item.title).slice(0, 8).join("；") || "等待任务编译"}</Descriptions.Item>
        <Descriptions.Item label="推荐渠道">{selectedPack.allowedChannels.join("、")}</Descriptions.Item>
        <Descriptions.Item label="文章数量与原因">{selectedGroup.tasks.length} 篇；来自已批准问题、内容类型匹配与资料快照</Descriptions.Item>
        <Descriptions.Item label="资料快照">{selectedPack.sourceSnapshotHash || "等待正式快照"}</Descriptions.Item>
        <Descriptions.Item label="规则包版本">{selectedPack.version}</Descriptions.Item>
      </Descriptions> : <Empty description="产品策略包尚未编译；系统会在蓝图和资料快照都就绪后自动生成。" />}
    </Drawer>
  </>;
}

export default function MonthlyPlanPage() {
  return <Suspense fallback={<Spin />}><ContentAutomationWorkspace /></Suspense>;
}
