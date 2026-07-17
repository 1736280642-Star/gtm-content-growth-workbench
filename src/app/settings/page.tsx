"use client";

import { Alert, Button, Card, Checkbox, Form, InputNumber, Radio, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, productLabels } from "@/lib/labels";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { getVisibleRoutesForRole, workspaceRoleLabels, workspaceRouteLabels } from "@/lib/permissions";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { useEffect, useMemo, useState } from "react";
import type { ChannelKey, ProductKey, ProductPlanConfig, WorkspaceRole } from "@/lib/types";

const finalReviewModeLabels = {
  default_final: "默认终稿",
  manual_review: "人工确认"
} as const;

const logModeLabels = {
  demo_csv: "样例数据",
  csv_import: "CSV 导入",
  nginx_log: "Nginx 日志",
  cdn_log: "CDN 日志"
} as const;

type SettingsRuleNextStep = "select_channels" | "select_products" | "reduce_volume" | "confirm_review" | "configure_real_log" | "configure_geo" | "ready";

interface SettingsRuleCheck {
  key: string;
  item: string;
  status: string;
  detail: string;
  action: string;
  nextStep: SettingsRuleNextStep;
}

const settingsRuleNextStepLabels: Record<SettingsRuleNextStep, string> = {
  select_channels: "选择渠道",
  select_products: "选择产品",
  reduce_volume: "降低产能",
  confirm_review: "确认终稿",
  configure_real_log: "配置日志",
  configure_geo: "配置 GEO",
  ready: "规则可用"
};

const settingsRuleNextStepColors: Record<SettingsRuleNextStep, string> = {
  select_channels: "red",
  select_products: "red",
  reduce_volume: "gold",
  confirm_review: "gold",
  configure_real_log: "blue",
  configure_geo: "gold",
  ready: "green"
};

function getDefaultProductWeeklyQuota(product: ProductKey) {
  return product === "joto_brand" ? 5 : 10;
}

function createDefaultProductPlans(products: ProductKey[], channels: ChannelKey[]): ProductPlanConfig[] {
  const fallbackChannels: ChannelKey[] = channels.length ? channels : ["wechat"];

  return products.map((product) => ({
    product,
    weeklyQuota: getDefaultProductWeeklyQuota(product),
    channels: fallbackChannels,
    enabled: true
  }));
}

function normalizeKnowledgeBaseIds(ids?: string[], legacyId?: string) {
  return Array.from(new Set([...(ids || []), legacyId].map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
}

function normalizeUiProductPlans(
  source: ProductPlanConfig[] | undefined,
  products: ProductKey[],
  channels: ChannelKey[]
): ProductPlanConfig[] {
  const defaults = createDefaultProductPlans(products, channels);

  return products.map((product) => {
    const existing = source?.find((item) => item.product === product);
    const fallback = defaults.find((item) => item.product === product) || {
      product,
      weeklyQuota: getDefaultProductWeeklyQuota(product),
      channels,
      enabled: true
    };

    return {
      product,
      weeklyQuota: existing?.weeklyQuota ?? fallback.weeklyQuota,
      channels: existing?.channels?.length ? existing.channels : fallback.channels,
      knowledgeBaseIds: normalizeKnowledgeBaseIds(existing?.knowledgeBaseIds, existing?.knowledgeBaseId),
      knowledgeBaseId: normalizeKnowledgeBaseIds(existing?.knowledgeBaseIds, existing?.knowledgeBaseId)[0],
      productExpressionRulePackageId: existing?.productExpressionRulePackageId,
      enabled: existing?.enabled ?? fallback.enabled
    };
  });
}

function createSettingsRuleChecks(input: {
  weeklyDays: number;
  dailyCount: number;
  channels: Array<keyof typeof channelLabels>;
  products: Array<keyof typeof productLabels>;
  currentRole: WorkspaceRole;
  finalReviewMode: keyof typeof finalReviewModeLabels;
  geoPlatforms: string[];
  logMode: keyof typeof logModeLabels;
}): SettingsRuleCheck[] {
  const weeklyCapacity = input.weeklyDays * input.dailyCount;

  return [
    input.channels.length
      ? {
          key: "channels",
          item: "渠道范围",
          status: `已选择 ${input.channels.length} 个渠道`,
          detail: input.channels.map((item) => channelLabels[item]).join("、"),
          action: "可以进入周计划生成。",
          nextStep: "ready"
        }
      : {
          key: "channels",
          item: "渠道范围",
          status: "未选择渠道",
          detail: "周计划无法稳定分配发布渠道。",
          action: "先选择至少一个首批渠道。",
          nextStep: "select_channels"
        },
    input.products.length
      ? {
          key: "products",
          item: "产品范围",
          status: `已选择 ${input.products.length} 个产品`,
          detail: input.products.map((item) => productLabels[item]).join("、"),
          action: "可以按产品轮转生成选题。",
          nextStep: "ready"
        }
      : {
          key: "products",
          item: "产品范围",
          status: "未选择产品",
          detail: "内容任务缺少产品方向，后续生成会失去判断边界。",
          action: "先选择至少一个产品方向。",
          nextStep: "select_products"
        },
    weeklyCapacity > 20
      ? {
          key: "capacity",
          item: "周产能",
          status: `每周 ${weeklyCapacity} 篇`,
          detail: "超过 20 篇会放大生成、审核和发布回填压力。",
          action: "建议先降低每周天数或每日篇数，完成一周试跑后再扩容。",
          nextStep: "reduce_volume"
        }
      : {
          key: "capacity",
          item: "周产能",
          status: `每周 ${weeklyCapacity} 篇`,
          detail: "当前产能适合本地试跑和人工复核。",
          action: "可以继续使用当前节奏。",
          nextStep: "ready"
        },
    input.finalReviewMode === "default_final"
      ? {
          key: "final_review",
          item: "终稿确认",
          status: "默认终稿",
          detail: "会减少人工确认环节，但更容易把质检警告带入发布队列。",
          action: "真实发布前建议切到人工确认。",
          nextStep: "confirm_review"
        }
      : {
          key: "final_review",
          item: "终稿确认",
          status: "人工确认",
          detail: "终稿进入发布队列前保留人工判断。",
          action: "可以继续走主流程。",
          nextStep: "ready"
        },
    input.logMode === "nginx_log" || input.logMode === "cdn_log"
      ? {
          key: "log_mode",
          item: "日志接入",
          status: logModeLabels[input.logMode],
          detail: "真实日志模式需要先确认文件路径和导出格式。",
          action: "先到连接管理页检查访问数据来源。",
          nextStep: "configure_real_log"
        }
      : {
          key: "log_mode",
          item: "日志接入",
          status: logModeLabels[input.logMode],
          detail: input.logMode === "demo_csv" ? "用于熟悉数据分析流程。" : "通过人工文件导入补充访问数据。",
          action: "可以继续在博客监控页导入日志。",
          nextStep: "ready"
        },
    input.geoPlatforms.length
      ? {
          key: "geo_platforms",
          item: "GEO 平台",
          status: `已选择 ${input.geoPlatforms.length} 个平台`,
          detail: input.geoPlatforms.join("、"),
          action: "可以进入 GEO 测试页运行。",
          nextStep: "ready"
        }
      : {
          key: "geo_platforms",
          item: "GEO 平台",
          status: "未选择 GEO 平台",
          detail: "GEO 测试无法判断应该调用哪些平台。",
          action: "先选择至少一个 GEO 平台。",
          nextStep: "configure_geo"
        }
  ];
}

function getSettingsRuleEntry(nextStep: SettingsRuleNextStep) {
  if (nextStep === "configure_real_log") {
    return { type: "link" as const, href: "/real-integration", label: "查看连接" };
  }

  if (nextStep === "configure_geo") {
    return { type: "link" as const, href: "/geo-test", label: "去 GEO 测试" };
  }

  if (nextStep === "ready") {
    return { type: "link" as const, href: "/weekly-plan", label: "去周计划" };
  }

  return { type: "save" as const, label: "保存设置" };
}

export default function SettingsPage() {
  const {
    state: { workspaceSetting, knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);
  const [productPlans, setProductPlans] = useState<ProductPlanConfig[]>([]);
  const previewWeeklyDays = Form.useWatch("defaultWeeklyDays", form) ?? workspaceSetting.defaultWeeklyDays;
  const previewDailyCount = Form.useWatch("defaultDailyCount", form) ?? workspaceSetting.defaultDailyCount;
  const previewChannels = (Form.useWatch("enabledChannels", form) ?? workspaceSetting.enabledChannels) as Array<keyof typeof channelLabels>;
  const previewProducts = (Form.useWatch("enabledProducts", form) ?? workspaceSetting.enabledProducts) as Array<keyof typeof productLabels>;
  const previewCurrentRole = (Form.useWatch("currentRole", form) ?? workspaceSetting.currentRole) as WorkspaceRole;
  const previewFinalReviewMode = (Form.useWatch("finalReviewMode", form) ?? workspaceSetting.finalReviewMode) as keyof typeof finalReviewModeLabels;
  const previewGeoPlatforms = (Form.useWatch("geoPlatforms", form) ?? workspaceSetting.geoPlatforms) as string[];
  const previewLogMode = (Form.useWatch("logMode", form) ?? workspaceSetting.logMode) as keyof typeof logModeLabels;
  const settingsRuleChecks = createSettingsRuleChecks({
    weeklyDays: Number(previewWeeklyDays) || 0,
    dailyCount: Number(previewDailyCount) || 0,
    channels: previewChannels,
    products: previewProducts,
    currentRole: previewCurrentRole,
    finalReviewMode: previewFinalReviewMode,
    geoPlatforms: previewGeoPlatforms,
    logMode: previewLogMode
  });
  const blockingRuleChecks = settingsRuleChecks.filter((item) => item.nextStep !== "ready");
  const firstBlockingRule = blockingRuleChecks[0];
  const productPlanTotal = productPlans.filter((item) => item.enabled).reduce((sum, item) => sum + item.weeklyQuota, 0);
  const knowledgeBaseOptions = useMemo(
    () => knowledgeBases.filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name })),
    [knowledgeBases]
  );
  const rulePackageOptions = useMemo(
    () =>
      knowledgeBases
        .filter((item) => item.productExpressionSource && item.productExpressionRuleDraft)
        .map((item) => ({ value: item.id, label: `${item.name} ${item.productExpressionRuleDraft?.version || ""}`.trim() })),
    [knowledgeBases]
  );

  useEffect(() => {
    form.setFieldsValue(workspaceSetting);
    setProductPlans(normalizeUiProductPlans(workspaceSetting.productPlans, workspaceSetting.enabledProducts, workspaceSetting.enabledChannels));
  }, [form, workspaceSetting]);

  useEffect(() => {
    setProductPlans((current) => normalizeUiProductPlans(current.length ? current : workspaceSetting.productPlans, previewProducts, previewChannels));
  }, [previewChannels, previewProducts, workspaceSetting.productPlans]);

  function handleResetForm() {
    form.setFieldsValue(workspaceSetting);
    setProductPlans(normalizeUiProductPlans(workspaceSetting.productPlans, workspaceSetting.enabledProducts, workspaceSetting.enabledChannels));
    messageApi.info("已恢复当前保存配置");
  }

  function updateProductPlan(product: ProductKey, patch: Partial<ProductPlanConfig>) {
    setProductPlans((current) =>
      current.map((item) =>
        item.product === product
          ? {
              ...item,
              ...patch,
              channels: patch.channels?.length ? patch.channels : patch.channels ? item.channels : item.channels
            }
          : item
      )
    );
  }

  async function handleSave() {
    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const result = await callJsonApi("/api/workspace-settings", {
        method: "PATCH",
        body: JSON.stringify({
          ...values,
          productPlans
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "设置已保存"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSaving(false);
    }
  }

  function renderSettingsRuleEntry(record: SettingsRuleCheck) {
    const entry = getSettingsRuleEntry(record.nextStep);

    if (entry.type === "link") {
      return (
        <Link href={entry.href}>
          <Button size="small">{entry.label}</Button>
        </Link>
      );
    }

    return (
      <Button size="small" type="primary" loading={saving} onClick={handleSave}>
        {entry.label}
      </Button>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="工作台设置"
        subtitle="管理默认发布规则、终稿规则和日志模式。"
        actions={
          <Space>
            <Button onClick={handleResetForm}>恢复当前保存配置</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存设置
            </Button>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="当前规则概览"
        description={
          <Space direction="vertical" size={8}>
            <Space wrap>
              <Tag color="geekblue">{workspaceRoleLabels[previewCurrentRole]}</Tag>
              <Tag color="blue">每周 {previewWeeklyDays} 天</Tag>
              <Tag color="blue">每天 {previewDailyCount} 篇</Tag>
              <Tag color={previewFinalReviewMode === "manual_review" ? "gold" : "green"}>{finalReviewModeLabels[previewFinalReviewMode]}</Tag>
              <Tag color={previewLogMode === "demo_csv" ? "default" : "processing"}>{logModeLabels[previewLogMode]}</Tag>
            </Space>
            <div>
              渠道：
              <Space wrap>
                {previewChannels.length ? previewChannels.map((item) => <Tag key={item}>{channelLabels[item]}</Tag>) : <Tag>未选择渠道</Tag>}
              </Space>
            </div>
            <div>
              产品：
              <Space wrap>
                {previewProducts.length ? previewProducts.map((item) => <Tag color="purple" key={item}>{productLabels[item]}</Tag>) : <Tag>未选择产品</Tag>}
              </Space>
            </div>
            <div>
              GEO 平台：
              <Space wrap>
                {previewGeoPlatforms.length ? previewGeoPlatforms.map((item) => <Tag color="cyan" key={item}>{item}</Tag>) : <Tag>未选择平台</Tag>}
              </Space>
            </div>
          </Space>
        }
      />
      <Alert
        type={blockingRuleChecks.length ? "warning" : "success"}
        showIcon
        style={{ marginBottom: 16 }}
        message={blockingRuleChecks.length ? `规则检查发现 ${blockingRuleChecks.length} 个待处理项` : "当前规则可进入主流程"}
        description={firstBlockingRule ? `${firstBlockingRule.item}：${firstBlockingRule.action}` : "渠道、产品、产能、终稿、日志和 GEO 平台都已具备可执行入口。"}
      />
      <Card title="规则检查" style={{ marginBottom: 16 }}>
        <Table
          rowKey="key"
          dataSource={settingsRuleChecks}
          pagination={false}
          columns={[
            { title: "检查项", dataIndex: "item" },
            {
              title: "当前状态",
              render: (_, record: SettingsRuleCheck) => (
                <Space direction="vertical" size={0}>
                  <span>{record.status}</span>
                  <span className="muted">{record.detail}</span>
                </Space>
              )
            },
            {
              title: "下一步",
              render: (_, record: SettingsRuleCheck) => <Tag color={settingsRuleNextStepColors[record.nextStep]}>{settingsRuleNextStepLabels[record.nextStep]}</Tag>
            },
            { title: "处理动作", dataIndex: "action" },
            {
              title: "可执行入口",
              render: (_, record: SettingsRuleCheck) => renderSettingsRuleEntry(record)
            }
          ]}
        />
      </Card>
      <Form form={form} layout="vertical">
        <div className="two-column">
          <Card title="发布节奏与范围">
            <Form.Item label="默认每周发布天数" name="defaultWeeklyDays">
              <InputNumber min={1} max={7} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="默认每日篇数" name="defaultDailyCount">
              <InputNumber min={1} max={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="默认渠道" name="enabledChannels">
              <Checkbox.Group options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item label="默认产品" name="enabledProducts">
              <Checkbox.Group options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
          </Card>
          <Card title="角色与可见范围">
            <Form.Item label="当前使用角色" name="currentRole">
              <Radio.Group
                options={Object.entries(workspaceRoleLabels).map(([value, label]) => ({
                  value,
                  label
                }))}
              />
            </Form.Item>
            <Alert
              showIcon
              type="info"
              message="角色用于控制工作台可见入口"
              description="不同角色看到不同页面和操作；切换角色后，可见范围会立即更新。"
              style={{ marginBottom: 16 }}
            />
            <Table
              rowKey="route"
              size="small"
              pagination={false}
              dataSource={getVisibleRoutesForRole(previewCurrentRole).map((route) => ({
                route,
                page: workspaceRouteLabels[route] || route
              }))}
              columns={[
                { title: "可见页面", dataIndex: "page" },
                { title: "路径", dataIndex: "route", render: (value) => <Tag>{value}</Tag> }
              ]}
            />
          </Card>
        </div>
        <div className="two-column" style={{ marginTop: 16 }}>
          <Card title="执行与采集规则">
            <Form.Item label="终稿模式" name="finalReviewMode">
              <Radio.Group
                options={[
                  { label: "默认终稿", value: "default_final" },
                  { label: "人工确认", value: "manual_review" }
                ]}
              />
            </Form.Item>
            <Form.Item label="GEO 平台" name="geoPlatforms">
              <Checkbox.Group options={["DeepSeek", "豆包", "通义千问"]} />
            </Form.Item>
            <Form.Item label="日志模式" name="logMode">
              <Radio.Group
                options={[
                  { label: "样例数据", value: "demo_csv" },
                  { label: "CSV 导入", value: "csv_import" },
                  { label: "Nginx 日志", value: "nginx_log" },
                  { label: "CDN 日志", value: "cdn_log" }
                ]}
              />
            </Form.Item>
          </Card>
          <Card
            title="默认产品/品牌计划"
            extra={<Tag color={productPlanTotal ? "purple" : "default"}>{`默认周配额 ${productPlanTotal} 篇`}</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {productPlans.map((plan) => (
                <div className="settings-product-plan-card" key={plan.product}>
                  <div className="settings-product-plan-header">
                    <Space size={8} wrap>
                      <Tag color={plan.enabled ? "purple" : "default"}>{productLabels[plan.product]}</Tag>
                      <Tag>{`${plan.weeklyQuota} 篇/周`}</Tag>
                    </Space>
                    <Checkbox checked={plan.enabled} onChange={(event) => updateProductPlan(plan.product, { enabled: event.target.checked })}>
                      启用
                    </Checkbox>
                  </div>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <InputNumber
                      min={0}
                      max={50}
                      value={plan.weeklyQuota}
                      addonAfter="篇/周"
                      disabled={!plan.enabled}
                      onChange={(value) => updateProductPlan(plan.product, { weeklyQuota: Number(value || 0) })}
                      style={{ width: "100%" }}
                    />
                    <Select
                      mode="multiple"
                      value={plan.channels}
                      disabled={!plan.enabled}
                      options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
                      onChange={(value) => updateProductPlan(plan.product, { channels: value as ChannelKey[] })}
                      placeholder="默认渠道"
                    />
                    <Select
                      mode="multiple"
                      allowClear
                      value={normalizeKnowledgeBaseIds(plan.knowledgeBaseIds, plan.knowledgeBaseId)}
                      disabled={!plan.enabled}
                      options={knowledgeBaseOptions}
                      onChange={(value) => updateProductPlan(plan.product, { knowledgeBaseIds: value, knowledgeBaseId: value[0] })}
                      placeholder="默认绑定知识库，可多选"
                    />
                    <Select
                      allowClear
                      value={plan.productExpressionRulePackageId}
                      disabled={!plan.enabled}
                      options={rulePackageOptions}
                      onChange={(value) => updateProductPlan(plan.product, { productExpressionRulePackageId: value })}
                      placeholder="默认表达规则包"
                    />
                  </Space>
                </div>
              ))}
              <Alert
                showIcon
                type="info"
                message="这里保存长期默认值"
                description="周计划页可以基于默认值做本周微调；本周临时配额不会反向污染长期默认配置。"
              />
            </Space>
          </Card>
        </div>
        <Card size="small" style={{ marginTop: 16 }}>
          <span className="muted">最近保存：{workspaceSetting.updatedAt || "-"}</span>
        </Card>
      </Form>
    </>
  );
}
