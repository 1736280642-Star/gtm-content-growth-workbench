"use client";

import { Alert, Button, Card, Checkbox, Form, Input, Radio, Segmented, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, productLabels } from "@/lib/labels";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { getVisibleRoutesForRole, workspaceRoleLabels, workspaceRouteLabels } from "@/lib/permissions";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { ChannelKey, ProductKey, ProductPlanConfig, WorkspaceRole } from "@/lib/types";
import ConfigurationPage from "@/app/configuration/page";
import OperationsPage from "@/app/operations/page";

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

type SettingsRuleNextStep = "select_channels" | "select_products" | "confirm_review" | "configure_real_log" | "configure_geo" | "ready";

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
  confirm_review: "确认终稿",
  configure_real_log: "配置日志",
  configure_geo: "配置 GEO",
  ready: "规则可用"
};

const settingsRuleNextStepColors: Record<SettingsRuleNextStep, string> = {
  select_channels: "red",
  select_products: "red",
  confirm_review: "gold",
  configure_real_log: "blue",
  configure_geo: "gold",
  ready: "green"
};

function createDefaultProductPlans(products: ProductKey[], channels: ChannelKey[]): ProductPlanConfig[] {
  const fallbackChannels: ChannelKey[] = channels.length ? channels : ["wechat"];

  return products.map((product) => ({
    product,
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
      channels,
      enabled: true
    };

    return {
      product,
      channels: existing?.channels?.length ? existing.channels : fallback.channels,
      knowledgeBaseIds: normalizeKnowledgeBaseIds(existing?.knowledgeBaseIds, existing?.knowledgeBaseId),
      knowledgeBaseId: normalizeKnowledgeBaseIds(existing?.knowledgeBaseIds, existing?.knowledgeBaseId)[0],
      productExpressionRulePackageId: existing?.productExpressionRulePackageId,
      enabled: existing?.enabled ?? fallback.enabled
    };
  });
}

function createSettingsRuleChecks(input: {
  channels: Array<keyof typeof channelLabels>;
  products: Array<keyof typeof productLabels>;
  currentRole: WorkspaceRole;
  finalReviewMode: keyof typeof finalReviewModeLabels;
  logMode: keyof typeof logModeLabels;
}): SettingsRuleCheck[] {
  return [
    input.channels.length
      ? {
          key: "channels",
          item: "渠道范围",
          status: `已选择 ${input.channels.length} 个渠道`,
          detail: input.channels.map((item) => channelLabels[item]).join("、"),
          action: "可以进入 GEO 内容中心。",
          nextStep: "ready"
        }
      : {
          key: "channels",
          item: "渠道范围",
          status: "未选择渠道",
          detail: "月度内容矩阵无法稳定分配发布渠道。",
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
          action: "先到设置的连接页检查访问数据来源。",
          nextStep: "configure_real_log"
        }
      : {
          key: "log_mode",
          item: "日志接入",
          status: logModeLabels[input.logMode],
          detail: input.logMode === "demo_csv" ? "用于熟悉数据分析流程。" : "通过人工文件导入补充访问数据。",
          action: "可以继续在 GEO 监控塔的官网监控中导入日志。",
          nextStep: "ready"
        },
  ];
}

function getSettingsRuleEntry(nextStep: SettingsRuleNextStep) {
  if (nextStep === "configure_real_log") {
    return { type: "link" as const, href: "/settings?tab=connections", label: "查看连接" };
  }

  if (nextStep === "ready") {
    return { type: "link" as const, href: "/monthly-plan?step=strategy", label: "去 GEO 内容中心" };
  }

  return { type: "save" as const, label: "保存设置" };
}

function WorkspaceRulesSettings({ section }: { section: "rules" | "permissions" }) {
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
  const previewChannels = (Form.useWatch("enabledChannels", form) ?? workspaceSetting.enabledChannels) as Array<keyof typeof channelLabels>;
  const previewProducts = (Form.useWatch("enabledProducts", form) ?? workspaceSetting.enabledProducts) as Array<keyof typeof productLabels>;
  const previewCurrentRole = (Form.useWatch("currentRole", form) ?? workspaceSetting.currentRole) as WorkspaceRole;
  const previewFinalReviewMode = (Form.useWatch("finalReviewMode", form) ?? workspaceSetting.finalReviewMode) as keyof typeof finalReviewModeLabels;
  const previewLogMode = (Form.useWatch("logMode", form) ?? workspaceSetting.logMode) as keyof typeof logModeLabels;
  const settingsRuleChecks = createSettingsRuleChecks({
    channels: previewChannels,
    products: previewProducts,
    currentRole: previewCurrentRole,
    finalReviewMode: previewFinalReviewMode,
    logMode: previewLogMode
  });
  const blockingRuleChecks = settingsRuleChecks.filter((item) => item.nextStep !== "ready");
  const firstBlockingRule = blockingRuleChecks[0];
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
        body: JSON.stringify(section === "permissions"
          ? { currentRole: values.currentRole }
          : { ...values, productPlans })
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
        title={section === "permissions" ? "权限" : "默认规则"}
        subtitle={section === "permissions"
          ? "按角色控制可见入口；系统状态仅向管理员或异常处理场景开放。"
          : "管理自动生产、发布排程与产品绑定的长期默认值，人工只修正例外。"}
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
      {section === "rules" ? <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="当前规则概览"
        description={
          <Space direction="vertical" size={8}>
            <Space wrap>
              <Tag color="geekblue">{workspaceRoleLabels[previewCurrentRole]}</Tag>
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
          </Space>
        }
      />
      <Alert
        type={blockingRuleChecks.length ? "warning" : "success"}
        showIcon
        style={{ marginBottom: 16 }}
        message={blockingRuleChecks.length ? `规则检查发现 ${blockingRuleChecks.length} 个待处理项` : "当前规则可进入主流程"}
        description={firstBlockingRule ? `${firstBlockingRule.item}：${firstBlockingRule.action}` : "渠道、产品、终稿和日志都已具备可执行入口。"}
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
      </> : null}
      <Form form={form} layout="vertical">
        <div className="two-column settings-section-single">
          {section === "rules" ? (
          <Card title="默认发布范围">
            <Form.Item label="默认渠道" name="enabledChannels">
              <Checkbox.Group options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item label="默认产品" name="enabledProducts">
              <Checkbox.Group options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Alert
              showIcon
              type="info"
              message="自动排程需要默认发布账号"
              description="系统仅会为已配置账号的渠道创建排程；未配置的渠道保留为待配置，不会误发。"
              style={{ marginBottom: 16 }}
            />
            {previewChannels.map((channel) => (
              <Form.Item
                key={channel}
                label={`${channelLabels[channel]}默认发布账号`}
                name={["publishAccountByChannel", channel]}
              >
                <Input placeholder="填写平台账号 ID 或连接别名" maxLength={120} />
              </Form.Item>
            ))}
          </Card>
          ) : null}
          {section === "permissions" ? (
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
          ) : null}
        </div>
        {section === "rules" ? <div className="two-column" style={{ marginTop: 16 }}>
          <Card title="执行与采集规则">
            <Form.Item label="终稿模式" name="finalReviewMode">
              <Radio.Group
                options={[
                  { label: "默认终稿", value: "default_final" },
                  { label: "人工确认", value: "manual_review" }
                ]}
              />
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
          <Card title="默认产品/品牌映射">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {productPlans.map((plan) => (
                <div className="settings-product-plan-card" key={plan.product}>
                  <div className="settings-product-plan-header">
                    <Space size={8} wrap>
                      <Tag color={plan.enabled ? "purple" : "default"}>{productLabels[plan.product]}</Tag>
                    </Space>
                    <Checkbox checked={plan.enabled} onChange={(event) => updateProductPlan(plan.product, { enabled: event.target.checked })}>
                      启用
                    </Checkbox>
                  </div>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
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
                description="GEO 内容中心可以基于默认值做当月调整；当月临时配额不会反向污染长期默认配置。"
              />
            </Space>
          </Card>
        </div> : null}
        <Card size="small" style={{ marginTop: 16 }}>
          <span className="muted">最近保存：{workspaceSetting.updatedAt || "-"}</span>
        </Card>
      </Form>
    </>
  );
}

type SettingsTab = "models" | "connections" | "rules" | "permissions" | "logs";

const settingsTabs = [
  { label: "模型", value: "models" },
  { label: "连接", value: "connections" },
  { label: "默认规则", value: "rules" },
  { label: "权限", value: "permissions" },
  { label: "日志", value: "logs" }
];

function SettingsHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab = settingsTabs.some((item) => item.value === requestedTab)
    ? requestedTab as SettingsTab
    : "models";
  const showSystemStatus = searchParams.get("system") === "1" || searchParams.get("view") === "system-status";

  return (
    <>
      <div className="unified-workspace-nav is-monitor">
        <Segmented
          block
          value={tab}
          options={settingsTabs}
          onChange={(value) => router.push(`/settings?tab=${value}`)}
        />
      </div>
      {showSystemStatus ? <OperationsPage /> : null}
      {!showSystemStatus && tab === "models" ? <ConfigurationPage /> : null}
      {!showSystemStatus && tab === "connections" ? <ConfigurationPage /> : null}
      {!showSystemStatus && tab === "rules" ? (
        <>
          <WorkspaceRulesSettings section="rules" />
          <ConfigurationPage />
        </>
      ) : null}
      {!showSystemStatus && tab === "permissions" ? <WorkspaceRulesSettings section="permissions" /> : null}
      {!showSystemStatus && tab === "logs" ? (
        <>
          <Space style={{ marginBottom: 12 }} wrap>
            <Button onClick={() => router.push("/settings?tab=logs&system=1")}>管理员查看系统状态</Button>
          </Space>
          <ConfigurationPage />
        </>
      ) : null}
    </>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={null}><SettingsHub /></Suspense>;
}
