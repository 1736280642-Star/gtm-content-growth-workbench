"use client";

import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { KnowledgeFetchProvider, KnowledgeSource } from "@/lib/types";

const authorityOptions = [
  { value: "A2", label: "A2 - 官方产品页面" },
  { value: "B1", label: "B1 - 经确认的业务页面" },
  { value: "B2", label: "B2 - 官方历史内容" }
];

interface ManagedImportResponse {
  message?: string;
  data?: { pipelineStatus: "queued" | "pending_config"; batchIds: string[]; generatedClaims: number; missingConfiguration: string[] };
}

interface ProductListResponse {
  products: Array<{ productId: string; displayName: string }>;
}

const fetchProviderLabels: Record<KnowledgeFetchProvider, string> = {
  cache: "历史缓存",
  xcrawl: "XCrawl",
  proxy_fetch: "代理抓取",
  local_fetch: "服务端直连",
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
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsedSources, setParsedSources] = useState<KnowledgeSource[]>([]);
  const [importResult, setImportResult] = useState<ManagedImportResponse["data"]>();
  const [productOptions, setProductOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    const requestedName = new URLSearchParams(window.location.search).get("name");
    if (requestedName && !form.getFieldValue("name")) form.setFieldValue("name", requestedName);
    callJsonApi<ProductListResponse>("/api/v5/products")
      .then((result) => {
        if (!active) return;
        const requestedProductId = new URLSearchParams(window.location.search).get("productId");
        const options = (result.products || []).map((item) => ({
          value: item.productId,
          label: item.displayName
        }));
        setProductOptions(options);
        const requested = options.find((option) => option.value === requestedProductId);
        if (!form.getFieldValue("productId") && (requested || options[0])) {
          form.setFieldValue("productId", (requested || options[0]).value);
        }
      })
      .catch((error) => {
        if (active) messageApi.error(error instanceof Error ? error.message : "产品列表加载失败");
      })
      .finally(() => {
        if (active) setProductsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form, messageApi]);

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
    const values = await form.validateFields();
    if (!parsedSources.some((source) => source.status === "parsed")) {
      messageApi.warning("请先解析 URL 并确认正文预览。");
      return;
    }
    setSaving(true);

    try {
      const result = await callJsonApi<ManagedImportResponse>("/api/v5/knowledge-imports/urls", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          urlsText: values.urlsText,
          productId: values.productId,
          authorityLevel: values.authorityLevel,
          publicUseConfirmed: values.publicUseConfirmed === true,
          idempotencyKey: idempotencyKey.current
        })
      });
      setImportResult(result.data);
      messageApi.success(formatApiMessage(result, "URL 正文已托管，治理与索引任务已创建。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "URL 导入失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="URL 导入"
        subtitle="服务端抓取并托管 URL 正文，随后自动进入 Claim、Snapshot、Embedding 与 OpenSearch 链路。"
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
        <Form form={form} layout="vertical" initialValues={{ authorityLevel: "A2", publicUseConfirmed: false }}>
          <div className="knowledge-detail-two-column">
            <div>
              <Typography.Title level={5}>基础信息</Typography.Title>
              <Form.Item label="知识库名称" name="name" rules={[{ required: true, message: "请填写知识库名称" }]}>
                <Input placeholder="例如：JOTO 官网博客资料" />
              </Form.Item>
              <Form.Item label="所属产品" name="productId" rules={[{ required: true, message: "请选择资料所属产品" }]}>
                <Select
                  options={productOptions}
                  loading={productsLoading}
                  notFoundContent={<Link href="/products/new">先新增产品</Link>}
                />
              </Form.Item>
              <Form.Item label="来源权威等级" name="authorityLevel" rules={[{ required: true, message: "请选择来源权威等级" }]}>
                <Select options={authorityOptions} />
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
              <Form.Item name="publicUseConfirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认公开内容生产权限")) }]}>
                <Checkbox>我确认页面内容可用于公开内容生产与证据引用</Checkbox>
              </Form.Item>
              <Alert
                showIcon
                type="info"
                message="服务端解析链路"
                description="系统按历史缓存、XCrawl、代理抓取、服务端直连的顺序获取正文；保存时会重新校验并把正文写入 MySQL。"
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
            <Input.TextArea rows={12} readOnly placeholder="点击解析后显示 Markdown 预览。" />
          </Form.Item>
          {importResult ? (
            <Alert
              showIcon
              type={importResult.pipelineStatus === "queued" ? "success" : "warning"}
              message={importResult.pipelineStatus === "queued" ? "治理与索引任务已排队" : "正文已托管，等待基础设施配置"}
              description={importResult.pipelineStatus === "queued"
                ? "SourceAsset 与 SourceRevision 已创建，Worker 将继续提取 Claim、生成 Snapshot、Embedding 和 OpenSearch 索引。"
                : `仍缺少：${importResult.missingConfiguration.join(", ")}`}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>托管并启动治理</Button>
          </Space>
        </Form>
      </Card>
    </>
  );
}
