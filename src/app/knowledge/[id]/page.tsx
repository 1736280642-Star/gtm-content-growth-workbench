"use client";

import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { KnowledgeBase, KnowledgeChunk, KnowledgeEmbeddingStatus, KnowledgeSource, KnowledgeSourceStatus, KnowledgeSourceType } from "@/lib/types";

const knowledgeTypeLabels: Record<KnowledgeBase["type"], string> = {
  brand: "品牌事实",
  product: "产品知识",
  official_blog: "官网博客",
  channel_history: "渠道历史",
  competitor: "竞品参考",
  custom: "自定义"
};

const statusLabels: Record<KnowledgeBase["status"], string> = {
  enabled: "启用",
  disabled: "停用"
};

const sourceTypeLabels: Record<KnowledgeSourceType, string> = {
  url: "URL",
  markdown: "Markdown",
  pdf: "PDF",
  docx: "Word",
  manual: "补充文本",
  auto_crawl: "自动抓取"
};

const sourceStatusLabels: Record<KnowledgeSourceStatus, string> = {
  pending: "待处理",
  fetching: "抓取中",
  parsed: "已解析",
  failed: "解析失败"
};

const sourceStatusColors: Record<KnowledgeSourceStatus, string> = {
  pending: "gold",
  fetching: "blue",
  parsed: "green",
  failed: "red"
};

const embeddingStatusLabels: Record<KnowledgeEmbeddingStatus, string> = {
  not_required: "未启用",
  pending_config: "待向量化",
  fallback_hash: "待向量化",
  real_embedding: "已向量化",
  failed: "失败"
};

const embeddingStatusColors: Record<KnowledgeEmbeddingStatus, string> = {
  not_required: "default",
  pending_config: "gold",
  fallback_hash: "gold",
  real_embedding: "green",
  failed: "red"
};

const knowledgeTypeOptions = Object.entries(knowledgeTypeLabels).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));
const sourceTypeOptions = Object.entries(sourceTypeLabels).map(([value, label]) => ({ value, label }));
const KNOWLEDGE_PREVIEW_DISPLAY_LIMIT = 2400;

const chunkingStrategyOptions = [
  { value: "rule", label: "规则切片" },
  { value: "auto", label: "自动切片" },
  { value: "semantic_llm", label: "AI 语义切片" }
];

function getSourceTypeLabel(value?: KnowledgeSourceType) {
  return sourceTypeLabels[value || "manual"] || value || "-";
}

function getDisplayContentPreview(content?: string) {
  const normalized = (content || "").trim();

  if (!normalized) {
    return "暂无内容预览。";
  }

  if (normalized.length <= KNOWLEDGE_PREVIEW_DISPLAY_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, KNOWLEDGE_PREVIEW_DISPLAY_LIMIT).trim()}\n\n[内容预览仅展示前 ${KNOWLEDGE_PREVIEW_DISPLAY_LIMIT} 字，完整内容已保留在来源资料和切片中。]`;
}

function getVectorStatus(knowledgeBase: KnowledgeBase) {
  return (knowledgeBase.vectorizationStatus || "pending_config") as KnowledgeEmbeddingStatus;
}

function getRulePackageModeLabel(knowledgeBase: KnowledgeBase, allKnowledgeBases: KnowledgeBase[]) {
  if (!knowledgeBase.productExpressionSource) {
    return "未作为规则包来源";
  }

  if (knowledgeBase.productExpressionRulePackageMode === "existing" && knowledgeBase.linkedProductExpressionRulePackageId) {
    const linkedPackage = allKnowledgeBases.find((item) => item.id === knowledgeBase.linkedProductExpressionRulePackageId);
    return linkedPackage ? `关联已有：${linkedPackage.name}` : "关联已有：来源已缺失";
  }

  return "新建规则包来源";
}

function getSourceTitle(source: KnowledgeSource) {
  return source.title || source.url || "未命名来源";
}

function buildUpdateRows(knowledgeBase: KnowledgeBase) {
  const rows = [
    {
      id: `${knowledgeBase.id}-base`,
      time: knowledgeBase.lastSyncedAt || "-",
      type: "知识库更新",
      title: knowledgeBase.name,
      status: embeddingStatusLabels[getVectorStatus(knowledgeBase)]
    }
  ];

  for (const source of knowledgeBase.sources || []) {
    rows.push({
      id: source.id,
      time: source.parsedAt || source.addedAt || "-",
      type: source.type === "url" ? "URL 解析" : source.type === "manual_text" ? "补充文本" : "历史资料",
      title: getSourceTitle(source),
      status: sourceStatusLabels[source.status]
    });
  }

  const ruleDraft = knowledgeBase.productExpressionRuleDraft;
  if (ruleDraft?.generatedAt) {
    rows.push({
      id: ruleDraft.id,
      time: ruleDraft.activatedAt || ruleDraft.generatedAt,
      type: "产品表达规则包",
      title: ruleDraft.version,
      status: ruleDraft.status === "active" ? "已生效" : ruleDraft.status === "draft" ? "草稿" : "已归档"
    });
  }

  return rows.sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
}

export default function KnowledgeDetailPage({ params }: { params: { id: string } }) {
  const {
    state: { knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [appendForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [appending, setAppending] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);

  const knowledgeBase = knowledgeBases.find((item) => item.id === params.id);
  const sources = useMemo(() => knowledgeBase?.sources || [], [knowledgeBase?.sources]);
  const chunks = useMemo(() => knowledgeBase?.chunks || [], [knowledgeBase?.chunks]);
  const parsedSourceCount = sources.filter((source) => source.status === "parsed").length;
  const failedSourceCount = sources.filter((source) => source.status === "failed").length;
  const vectorStatus = knowledgeBase ? getVectorStatus(knowledgeBase) : "pending_config";
  const updateRows = useMemo(() => (knowledgeBase ? buildUpdateRows(knowledgeBase) : []), [knowledgeBase]);
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const ruleTerms = knowledgeBase?.productExpressionRuleDraft?.distilledTermSuggestions || [];

  function openEditModal() {
    if (!knowledgeBase) return;

    editForm.setFieldsValue({
      name: knowledgeBase.name,
      type: knowledgeBase.type,
      status: knowledgeBase.status,
      usageScope: knowledgeBase.usageScope,
      sourceType: knowledgeBase.sourceType || "manual",
      sourceUrl: knowledgeBase.sourceUrl,
      productExpressionSource: Boolean(knowledgeBase.productExpressionSource)
    });
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!knowledgeBase) return;

    const values = await editForm.validateFields();
    setSavingEdit(true);

    try {
      const result = await callJsonApi(`/api/knowledge-bases/${knowledgeBase.id}`, {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      await refresh();
      setEditOpen(false);
      messageApi.success(formatApiMessage(result, "知识库基础信息已更新。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存基础信息失败");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleAppendSources() {
    if (!knowledgeBase) return;

    const values = await appendForm.validateFields();
    setAppending(true);

    try {
      const result = await callJsonApi(`/api/knowledge-bases/${knowledgeBase.id}/sources`, {
        method: "POST",
        body: JSON.stringify(values)
      });
      await refresh();
      appendForm.resetFields();
      messageApi.success(formatApiMessage(result, "资料已追加，知识库已重新切片。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "追加资料失败");
    } finally {
      setAppending(false);
    }
  }

  async function handleVectorize() {
    if (!knowledgeBase) return;

    setVectorizing(true);

    try {
      const result = await callJsonApi(`/api/knowledge-bases/${knowledgeBase.id}/vectorize`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "向量化已完成。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "向量化失败");
    } finally {
      setVectorizing(false);
    }
  }

  if (!knowledgeBase && !loading) {
    return (
      <>
        <PageHeader
          title="知识库详情"
          subtitle="未找到这条知识库资料。"
          actions={
            <Link href="/knowledge">
              <Button>返回知识库</Button>
            </Link>
          }
        />
        <ActionEmpty title="资料不存在" description="它可能已经被删除，或者当前本地状态尚未同步。" />
      </>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title={knowledgeBase ? `编辑详情：${knowledgeBase.name}` : "知识库详情"}
        subtitle="查看资料内容、追加新资料、执行切片与向量化，并保留来源和更新时间。"
        actions={
          <Space>
            <Link href="/knowledge">
              <Button>返回知识库</Button>
            </Link>
            <Button onClick={openEditModal}>编辑基础信息</Button>
            <Button type="primary" loading={vectorizing} onClick={handleVectorize}>
              重新向量化
            </Button>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      {knowledgeBase ? (
        <>
          <div className="metric-grid">
            <MetricCard title="来源资料" value={sources.length} suffix="个" />
            <MetricCard title="已解析来源" value={parsedSourceCount} suffix="个" />
            <MetricCard title="切片数量" value={chunks.length} suffix="段" />
            <MetricCard title="向量状态" value={embeddingStatusLabels[vectorStatus]} />
            <MetricCard title="解析失败" value={failedSourceCount} suffix="个" />
          </div>

          <Card style={{ marginBottom: 16 }} data-testid="knowledge-detail-source-card">
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="资料类型">{knowledgeTypeLabels[knowledgeBase.type]}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={knowledgeBase.status === "enabled" ? "green" : "default"}>{statusLabels[knowledgeBase.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="导入方式">{getSourceTypeLabel(knowledgeBase.sourceType)}</Descriptions.Item>
              <Descriptions.Item label="资料用途">{knowledgeBase.usageScope || "未填写"}</Descriptions.Item>
              <Descriptions.Item label="最近同步">{knowledgeBase.lastSyncedAt || "-"}</Descriptions.Item>
              <Descriptions.Item label="来源 URL">{knowledgeBase.sourceUrl || "-"}</Descriptions.Item>
              <Descriptions.Item label="切片策略">{knowledgeBase.chunkingStrategy || "rule"}</Descriptions.Item>
              <Descriptions.Item label="向量模型">{knowledgeBase.embeddingModel || "pending_config"}</Descriptions.Item>
              <Descriptions.Item label="检索策略">{knowledgeBase.retrievalStrategy || "pending_config"}</Descriptions.Item>
              <Descriptions.Item label="规则包处理">{getRulePackageModeLabel(knowledgeBase, knowledgeBases)}</Descriptions.Item>
              <Descriptions.Item label="自动导入状态">{knowledgeBase.autoCrawl?.enabled ? knowledgeBase.autoCrawl.status || "idle" : "未启用"}</Descriptions.Item>
              <Descriptions.Item label="发现文章">{knowledgeBase.autoCrawl?.totalDiscovered ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="已导入文章">{knowledgeBase.autoCrawl?.importedCount ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="导入失败">{knowledgeBase.autoCrawl?.failedCount ?? "-"}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Tabs
            className="knowledge-detail-tabs"
            items={[
              {
                key: "preview",
                label: "内容预览",
                children: (
                  <Card data-testid="knowledge-detail-preview-card">
                    <Typography.Paragraph className="knowledge-preview-text">
                      {getDisplayContentPreview(knowledgeBase.contentPreview)}
                    </Typography.Paragraph>
                  </Card>
                )
              },
              {
                key: "append",
                label: "追加资料",
                children: (
                  <Card>
                    <Alert
                      showIcon
                      type="info"
                      message="追加资料会进入同一个知识库"
                      description="可以一次追加多个 URL 或一段补充文本；保存后系统会保留来源标题、URL、追加时间，并重新生成切片，状态回到待向量化。"
                      style={{ marginBottom: 16 }}
                    />
                    <Form form={appendForm} layout="vertical" initialValues={{ chunkingStrategy: knowledgeBase.chunkingStrategy || "rule" }}>
                      <Form.Item label="补充文本标题" name="title">
                        <Input placeholder="例如：JOTO 产品补充说明" />
                      </Form.Item>
                      <Form.Item label="多个 URL" name="urlsText" extra="一行一个 URL。后端按历史缓存、XCrawl、代理抓取、本地兜底的顺序处理，并在来源中保留抓取方式与失败原因。">
                        <Input.TextArea rows={5} placeholder="https://jotoai.com/..." />
                      </Form.Item>
                      <Form.Item label="补充文本" name="manualText">
                        <Input.TextArea rows={7} placeholder="直接粘贴需要追加进知识库的 Markdown 或纯文本。" />
                      </Form.Item>
                      <Form.Item label="切片策略" name="chunkingStrategy">
                        <Select options={chunkingStrategyOptions} style={{ maxWidth: 260 }} />
                      </Form.Item>
                      <Button type="primary" loading={appending} onClick={handleAppendSources}>
                        保存并重新切片
                      </Button>
                    </Form>
                  </Card>
                )
              },
              {
                key: "vectorization",
                label: "切片与向量化记录",
                children: (
                  <Card>
                    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                      <Alert
                        showIcon
                        type={vectorStatus === "real_embedding" ? "success" : vectorStatus === "failed" ? "error" : "warning"}
                        message={`当前状态：${embeddingStatusLabels[vectorStatus]}`}
                        description={
                          vectorStatus === "real_embedding"
                            ? "当前知识库已经写入真实向量。"
                            : "如果没有配置真实 Embedding provider，系统会显示 pending_config，不会伪装成真实向量。"
                        }
                      />
                      <Button type="primary" loading={vectorizing} onClick={handleVectorize}>
                        确认解析并向量化
                      </Button>
                      <Table
                        rowKey="id"
                        size="small"
                        dataSource={chunks}
                        pagination={{ pageSize: 8, showSizeChanger: false }}
                        locale={{
                          emptyText: <ActionEmpty title="暂无切片记录" description="导入或追加资料后，系统会根据正文结构生成切片。" />
                        }}
                        columns={[
                          { title: "切片标题", dataIndex: "chunkTitle", width: 180 },
                          {
                            title: "来源",
                            dataIndex: "sourceId",
                            width: 180,
                            render: (value, record: KnowledgeChunk) => sourceById.get(value as string)?.title || record.sourceTitle || "-"
                          },
                          { title: "路径", dataIndex: "sectionPath", width: 160 },
                          { title: "长度", dataIndex: "tokenCount", width: 80 },
                          {
                            title: "向量状态",
                            dataIndex: "embeddingStatus",
                            width: 130,
                            render: (value) => {
                              const status = (value || vectorStatus) as KnowledgeEmbeddingStatus;
                              return <Tag color={embeddingStatusColors[status]}>{embeddingStatusLabels[status]}</Tag>;
                            }
                          },
                          { title: "内容", dataIndex: "content", render: (value) => <Typography.Text>{value}</Typography.Text> }
                        ]}
                      />
                    </Space>
                  </Card>
                )
              },
              {
                key: "distilled-terms",
                label: "关联蒸馏词",
                children: (
                  <Card>
                    {ruleTerms.length ? (
                      <Space wrap>
                        {ruleTerms.map((term) => (
                          <Tag key={term} color="blue">
                            {term}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <ActionEmpty title="暂无关联蒸馏词" description="后续可以由规则包或 GEO 缺口提取后进入蒸馏词池。" />
                    )}
                  </Card>
                )
              },
              {
                key: "updates",
                label: "更新记录",
                children: (
                  <Card>
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={updateRows}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      columns={[
                        { title: "时间", dataIndex: "time", width: 190 },
                        { title: "类型", dataIndex: "type", width: 140 },
                        { title: "对象", dataIndex: "title" },
                        { title: "状态", dataIndex: "status", width: 130 }
                      ]}
                    />
                  </Card>
                )
              }
            ]}
          />

          <Modal
            title="编辑基础信息"
            open={editOpen}
            onCancel={() => setEditOpen(false)}
            onOk={handleSaveEdit}
            okText="保存"
            cancelText="取消"
            confirmLoading={savingEdit}
            width={720}
          >
            <Form form={editForm} layout="vertical">
              <Form.Item label="知识库名称" name="name" rules={[{ required: true, message: "请填写知识库名称" }]}>
                <Input />
              </Form.Item>
              <Space wrap style={{ width: "100%" }}>
                <Form.Item label="知识库类型" name="type" style={{ minWidth: 220 }}>
                  <Select options={knowledgeTypeOptions} />
                </Form.Item>
                <Form.Item label="状态" name="status" style={{ minWidth: 160 }}>
                  <Select options={statusOptions} />
                </Form.Item>
                <Form.Item label="导入方式" name="sourceType" style={{ minWidth: 180 }}>
                  <Select options={sourceTypeOptions} />
                </Form.Item>
              </Space>
              <Form.Item label="资料用途" name="usageScope">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item label="来源 URL" name="sourceUrl">
                <Input />
              </Form.Item>
              <Form.Item name="productExpressionSource" valuePropName="checked">
                <Checkbox>作为产品表达规则包来源</Checkbox>
              </Form.Item>
            </Form>
          </Modal>
        </>
      ) : null}
    </>
  );
}
