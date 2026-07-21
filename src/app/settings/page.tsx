"use client";

import { Alert, Button, Card, Checkbox, Form, InputNumber, Radio, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, productLabels } from "@/lib/labels";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { useEffect, useState } from "react";

const finalReviewModeLabels = {
  default_final: "默认终稿",
  manual_review: "人工确认"
} as const;

const logModeLabels = {
  demo_csv: "Demo CSV",
  csv_import: "CSV 导入",
  nginx_log: "Nginx 日志",
  cdn_log: "CDN 日志"
} as const;

type SettingsRuleNextStep = "select_channels" | "select_products" | "reduce_volume" | "confirm_review" | "configure_real_log" | "ready";

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
  ready: "规则可用"
};

const settingsRuleNextStepColors: Record<SettingsRuleNextStep, string> = {
  select_channels: "red",
  select_products: "red",
  reduce_volume: "gold",
  confirm_review: "gold",
  configure_real_log: "blue",
  ready: "green"
};

function createSettingsRuleChecks(input: {
  publishDays: number;
  dailyCount: number;
  channels: Array<keyof typeof channelLabels>;
  products: Array<keyof typeof productLabels>;
  finalReviewMode: keyof typeof finalReviewModeLabels;
  logMode: keyof typeof logModeLabels;
}): SettingsRuleCheck[] {
  const monthlyCapacity = input.publishDays * input.dailyCount;

  return [
    input.channels.length
      ? {
          key: "channels",
          item: "渠道范围",
          status: `已选择 ${input.channels.length} 个渠道`,
          detail: input.channels.map((item) => channelLabels[item]).join("、"),
          action: "可以进入月度计划生成。",
          nextStep: "ready"
        }
      : {
          key: "channels",
          item: "渠道范围",
          status: "未选择渠道",
          detail: "月度计划无法稳定分配发布渠道。",
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
    monthlyCapacity > 20
      ? {
          key: "capacity",
          item: "周产能",
          status: `每月 ${monthlyCapacity} 篇`,
          detail: "超过 20 篇会放大生成、审核和发布回填压力。",
          action: "建议先降低每月天数或每日篇数，完成一个月试跑后再扩容。",
          nextStep: "reduce_volume"
        }
      : {
          key: "capacity",
          item: "周产能",
          status: `每月 ${monthlyCapacity} 篇`,
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
          action: "先到真实接入页检查 Nginx/CDN 路径配置。",
          nextStep: "configure_real_log"
        }
      : {
          key: "log_mode",
          item: "日志接入",
          status: logModeLabels[input.logMode],
          detail: input.logMode === "demo_csv" ? "适合演示和本地 smoke。" : "适合先用人工文件导入验证指标链路。",
          action: "可以继续在博客监控页导入日志。",
          nextStep: "ready"
        }
  ];
}

function getSettingsRuleEntry(nextStep: SettingsRuleNextStep) {
  if (nextStep === "configure_real_log") {
    return { type: "link" as const, href: "/real-integration", label: "看真实接入" };
  }

  if (nextStep === "ready") {
    return { type: "link" as const, href: "/monthly-plan", label: "去月度计划" };
  }

  return { type: "save" as const, label: "保存设置" };
}

export default function SettingsPage() {
  const {
    state: { workspaceSetting },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);
  const previewMonthlyDays = Form.useWatch("defaultPublishDays", form) ?? workspaceSetting.defaultPublishDays;
  const previewDailyCount = Form.useWatch("defaultDailyCount", form) ?? workspaceSetting.defaultDailyCount;
  const previewChannels = (Form.useWatch("enabledChannels", form) ?? workspaceSetting.enabledChannels) as Array<keyof typeof channelLabels>;
  const previewProducts = (Form.useWatch("enabledProducts", form) ?? workspaceSetting.enabledProducts) as Array<keyof typeof productLabels>;
  const previewFinalReviewMode = (Form.useWatch("finalReviewMode", form) ?? workspaceSetting.finalReviewMode) as keyof typeof finalReviewModeLabels;
  const previewLogMode = (Form.useWatch("logMode", form) ?? workspaceSetting.logMode) as keyof typeof logModeLabels;
  const settingsRuleChecks = createSettingsRuleChecks({
    publishDays: Number(previewMonthlyDays) || 0,
    dailyCount: Number(previewDailyCount) || 0,
    channels: previewChannels,
    products: previewProducts,
    finalReviewMode: previewFinalReviewMode,
    logMode: previewLogMode
  });
  const blockingRuleChecks = settingsRuleChecks.filter((item) => item.nextStep !== "ready");
  const firstBlockingRule = blockingRuleChecks[0];

  useEffect(() => {
    form.setFieldsValue(workspaceSetting);
  }, [form, workspaceSetting]);

  function handleResetForm() {
    form.setFieldsValue(workspaceSetting);
    messageApi.info("已恢复当前保存配置");
  }

  async function handleSave() {
    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const result = await callJsonApi("/api/workspace-settings", {
        method: "PATCH",
        body: JSON.stringify(values)
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
              <Tag color="blue">每月 {previewMonthlyDays} 天</Tag>
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
          </Space>
        }
      />
      <Alert
        type={blockingRuleChecks.length ? "warning" : "success"}
        showIcon
        style={{ marginBottom: 16 }}
        message={blockingRuleChecks.length ? `规则检查发现 ${blockingRuleChecks.length} 个待处理项` : "当前规则可进入主流程"}
        description={firstBlockingRule ? `${firstBlockingRule.item}：${firstBlockingRule.action}` : "渠道、产品、产能、终稿和日志都已具备可执行入口。"}
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
            <Form.Item label="默认每月发布天数" name="defaultPublishDays">
              <InputNumber min={1} max={31} style={{ width: "100%" }} />
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
                  { label: "Demo CSV", value: "demo_csv" },
                  { label: "CSV 导入", value: "csv_import" },
                  { label: "Nginx 日志", value: "nginx_log" },
                  { label: "CDN 日志", value: "cdn_log" }
                ]}
              />
            </Form.Item>
          </Card>
        </div>
        <Card size="small" style={{ marginTop: 16 }}>
          <span className="muted">最近保存：{workspaceSetting.updatedAt || "-"}</span>
        </Card>
      </Form>
    </>
  );
}
