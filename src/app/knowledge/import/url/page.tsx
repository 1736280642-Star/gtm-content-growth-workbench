"use client";

import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { KnowledgeBase, KnowledgeFetchProvider, KnowledgeSource } from "@/lib/types";

const knowledgeTypeOptions: Array<{ value: KnowledgeBase["type"]; label: string }> = [
  { value: "brand", label: "品牌事实" },
  { value: "product", label: "产品知识" },
  { value: "official_blog", label: "官网博客" },
  { value: "channel_history", label: "渠道历史" },
  { value: "competitor", label: "竞品参考" },
  { value: "custom", label: "用户自定义" }
];

const fetchProviderLabels: Record<KnowledgeFetchProvider, string> = {
  cache: "历史缓存",
  xcrawl: "XCrawl",
  proxy_fetch: "代理抓取",
  local_fetch: "本地兜底",
  manual: "手动文本",
  site_import: "后台全量导入"
};

const fetchProviderColors: Record<KnowledgeFetchProvider, string> = {
  cache: "blue",
  xcrawl: "green",
  proxy_fetch: "green",
  local_fetch: "gold",
  manual: "default",
  site_import: "blue"
};

function getSourceStatusLabel(source: KnowledgeSource) {
  if (source.fetchProvider === "site_import") {
    return "已识别";
  }

  return source.status === "parsed" ? "已解析" : source.status === "failed" ? "解析失败" : "待处理";
}

function getSourceStatusColor(source: KnowledgeSource) {
  if (source.fetchProvider === "site_import") {
    return "blue";
  }

  return source.status === "parsed" ? "green" : source.status === "failed" ? "red" : "gold";
}

export default function KnowledgeUrlImportPage() {
  const {
    state: { knowledgeBases }
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsedSources, setParsedSources] = useState<KnowledgeSource[]>([]);
  const rulePackageOptions = knowledgeBases
    .filter((item) => item.productExpressionRuleDraft)
    .map((item) => ({
      value: item.id,
      label: `${item.name}（${item.productExpressionRuleDraft?.version || "草稿"}）`
    }));

  async function handleParse() {
    const values = form.getFieldsValue();
    setParsing(true);

    try {
      const result = await callJsonApi<{ data?: { sources?: KnowledgeSource[]; contentPreview?: string } }>("/api/knowledge-bases/parse-sources", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          title: values.name,
          urlsText: values.urlsText
        })
      });
      const sources = result.data?.sources || [];
      const contentPreview = result.data?.contentPreview || "";
      setParsedSources(sources);
      form.setFieldsValue({ contentPreview });
      messageApi.success(formatApiMessage(result, "URL 已解析为 Markdown 预览。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "URL 解析失败");
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const result = await callJsonApi<{ data?: { knowledgeBase?: KnowledgeBase } }>("/api/knowledge-bases", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          sourceType: values.autoCrawlEnabled ? "auto_crawl" : "url",
          status: "enabled",
          sources: parsedSources,
          productExpressionSource: Boolean(values.productExpressionSource),
          productExpressionRulePackageMode: values.productExpressionSource ? values.rulePackageMode || "new" : "none",
          linkedProductExpressionRulePackageId: values.rulePackageMode === "existing" ? values.linkedProductExpressionRulePackageId : undefined,
          crawlWeekday: values.crawlWeekday,
          crawlHour: values.crawlHour
        })
      });
      const id = result.data?.knowledgeBase?.id;
      messageApi.success(formatApiMessage(result, values.autoCrawlEnabled ? "知识库已创建，后台导入任务已启动。" : "知识库已保存为待向量化。"));
      if (id) {
        window.location.href = `/knowledge/${id}`;
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存知识库失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="URL 导入"
        subtitle="粘贴一个或多个 URL，解析成 Markdown 预览后保存为待向量化知识库。"
        actions={
          <Space>
            <Link href="/knowledge/import">
              <Button>返回内容导入</Button>
            </Link>
            <Link href="/knowledge">
              <Button>知识库列表</Button>
            </Link>
          </Space>
        }
      />

      <Card>
        <Form form={form} layout="vertical" initialValues={{ type: "official_blog", productExpressionSource: false, rulePackageMode: "new", autoCrawlEnabled: false, crawlWeekday: 1, crawlHour: 9 }}>
          <div className="knowledge-detail-two-column">
            <div>
              <Typography.Title level={5}>基础信息</Typography.Title>
              <Form.Item label="知识库名称" name="name" rules={[{ required: true, message: "请填写知识库名称" }]}>
                <Input placeholder="例如：JOTO 官网博客资料" />
              </Form.Item>
              <Form.Item label="知识库类型" name="type">
                <Select options={knowledgeTypeOptions} />
              </Form.Item>
              <Form.Item label="资料用途" name="usageScope">
                <Input.TextArea rows={3} placeholder="例如：官网博客证据、产品表达、GEO 诊断信源" />
              </Form.Item>
              <Form.Item label="URL 列表" name="urlsText" rules={[{ required: true, message: "请填写至少一个 URL" }]} extra="一行一个 URL；系统会拒绝本机、内网和无法解析的地址。">
                <Input.TextArea rows={8} placeholder="https://jotoai.com/..." />
              </Form.Item>
              <Space wrap>
                <Button type="primary" loading={parsing} onClick={handleParse}>解析</Button>
                <Tag color={parsedSources.length ? "green" : "gold"}>{parsedSources.length ? `已解析 ${parsedSources.length} 个来源` : "待解析"}</Tag>
              </Space>
            </div>

            <div>
              <Typography.Title level={5}>导入设置</Typography.Title>
              <Form.Item name="productExpressionSource" valuePropName="checked">
                <Checkbox>作为产品表达规则包来源</Checkbox>
              </Form.Item>
              <Form.Item shouldUpdate={(prev, next) => prev.productExpressionSource !== next.productExpressionSource || prev.rulePackageMode !== next.rulePackageMode}>
                {({ getFieldValue }) =>
                  getFieldValue("productExpressionSource") ? (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Form.Item label="规则包处理方式" name="rulePackageMode" style={{ marginBottom: 0 }}>
                        <Select
                          options={[
                            { value: "new", label: "新建产品表达规则包" },
                            { value: "existing", label: "关联已有规则包" }
                          ]}
                        />
                      </Form.Item>
                      {getFieldValue("rulePackageMode") === "existing" ? (
                        <Form.Item
                          label="选择已有规则包"
                          name="linkedProductExpressionRulePackageId"
                          rules={[{ required: true, message: "请选择要关联的产品表达规则包" }]}
                        >
                          <Select options={rulePackageOptions} placeholder="选择已有规则包" />
                        </Form.Item>
                      ) : null}
                    </Space>
                  ) : null
                }
              </Form.Item>
              <Form.Item name="autoCrawlEnabled" valuePropName="checked">
                <Checkbox>启用自动化导入</Checkbox>
              </Form.Item>
              <Space wrap>
                <Form.Item label="周几" name="crawlWeekday">
                  <InputNumber min={1} max={7} />
                </Form.Item>
                <Form.Item label="几点" name="crawlHour">
                  <InputNumber min={0} max={23} />
                </Form.Item>
              </Space>
              <Alert
                showIcon
                type="info"
                message="解析链路"
                description="普通 URL 按 历史缓存 -> XCrawl -> 代理抓取 -> 本地兜底 的顺序解析正文。博客聚合页会先识别 sitemap 和文章数量，保存后创建后台任务，再逐篇按配置抓取真实正文。"
              />
            </div>
          </div>

          {parsedSources.length ? (
            <Table
              rowKey="id"
              size="small"
              style={{ marginTop: 24 }}
              dataSource={parsedSources}
              pagination={false}
              columns={[
                { title: "来源", dataIndex: "title" },
                {
                  title: "抓取方式",
                  dataIndex: "fetchProvider",
                  width: 120,
                  render: (value: KnowledgeFetchProvider) => <Tag color={fetchProviderColors[value] || "default"}>{fetchProviderLabels[value] || value}</Tag>
                },
                {
                  title: "状态",
                  width: 120,
                  render: (_, record) => <Tag color={getSourceStatusColor(record)}>{getSourceStatusLabel(record)}</Tag>
                },
                { title: "链路说明 / 失败原因", dataIndex: "errorMessage", render: (value, record) => value || record.errorCode || "-" }
              ]}
            />
          ) : null}

          <Form.Item label="Markdown 解析预览" name="contentPreview" style={{ marginTop: 24 }}>
            <Input.TextArea rows={12} placeholder="点击解析后显示 Markdown 预览。" />
          </Form.Item>
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>保存并启动导入</Button>
            <Link href="/knowledge/vectorize">
              <Button>去切片与向量化</Button>
            </Link>
          </Space>
        </Form>
      </Card>
    </>
  );
}
