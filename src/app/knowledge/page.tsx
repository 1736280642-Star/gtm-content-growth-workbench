"use client";

import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { promptTemplates } from "@/lib/prompt-templates";
import type { KnowledgeBase, KnowledgeSourceType } from "@/lib/types";
import { useState } from "react";

const knowledgeTypeLabels: Record<KnowledgeBase["type"], string> = {
  brand: "品牌事实",
  product: "产品知识",
  official_blog: "官网博客",
  channel_history: "渠道历史",
  competitor: "竞品参考",
  custom: "用户自定义"
};

const statusLabels: Record<KnowledgeBase["status"], string> = {
  enabled: "启用",
  disabled: "停用"
};

const knowledgeTypeOptions = Object.entries(knowledgeTypeLabels).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));
const sourceTypeLabels: Record<KnowledgeSourceType, string> = {
  url: "URL",
  markdown: "Markdown",
  docx: "Docx",
  manual: "手动文本",
  auto_crawl: "自动抓取"
};
const sourceTypeOptions = Object.entries(sourceTypeLabels).map(([value, label]) => ({ value, label }));

type KnowledgeNextStep = "enable" | "fill_scope" | "confirm_trust" | "record_sync" | "compare_only" | "ready";

const knowledgeNextStepLabels: Record<KnowledgeNextStep, string> = {
  enable: "需启用",
  fill_scope: "补调用范围",
  confirm_trust: "确认可信度",
  record_sync: "补同步记录",
  compare_only: "仅对比调用",
  ready: "可调用"
};

const knowledgeNextStepColors: Record<KnowledgeNextStep, string> = {
  enable: "gold",
  fill_scope: "blue",
  confirm_trust: "purple",
  record_sync: "cyan",
  compare_only: "default",
  ready: "green"
};

function getKnowledgeTimestamp(value?: string) {
  if (!value) {
    return 0;
  }

  const normalizedValue = value.includes("T") ? value : value.replace(" ", "T");
  const timestamp = Date.parse(normalizedValue);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getKnowledgeIdTimestamp(id: string) {
  const segments = id.split("-");
  const timestamp = Number(segments[1]);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getKnowledgeNextStep(record: KnowledgeBase): KnowledgeNextStep {
  if (record.status === "disabled") {
    return "enable";
  }

  if (!record.usageScope.trim() || !record.contentPreview?.trim()) {
    return "fill_scope";
  }

  if (record.type === "competitor") {
    return "compare_only";
  }

  if (!record.chunks?.length || !record.lastSyncedAt) {
    return "record_sync";
  }

  return "ready";
}

function getKnowledgeActionText(record: KnowledgeBase) {
  const nextStep = getKnowledgeNextStep(record);

  if (nextStep === "enable") {
    return "先启用后才能被生成和诊断流程调用。";
  }

  if (nextStep === "fill_scope") {
    return "补清楚调用范围，避免错误场景引用。";
  }

  if (nextStep === "compare_only") {
    return "保留在对比、差异化和竞品分析任务中使用。";
  }

  if (nextStep === "confirm_trust") {
    return "确认资料来源边界，普通品牌事实不调用竞品或参考来源。";
  }

  if (nextStep === "record_sync") {
    return "补内容预览或重新切片，让生成链路能看到可用 Chunk。";
  }

  return "可作为内容生成、质检或诊断依据。";
}

export default function KnowledgePage() {
  const {
    state: { knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [editingKnowledgeBase, setEditingKnowledgeBase] = useState<KnowledgeBase>();
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string>();
  const [typeFilter, setTypeFilter] = useState<KnowledgeBase["type"][]>([]);
  const [statusFilter, setStatusFilter] = useState<KnowledgeBase["status"][]>([]);
  const hasActiveFilter = Boolean(typeFilter.length || statusFilter.length);
  const filteredKnowledgeBases = knowledgeBases.filter((item) => {
    const typeMatched = !typeFilter.length || typeFilter.includes(item.type);
    const statusMatched = !statusFilter.length || statusFilter.includes(item.status);

    return typeMatched && statusMatched;
  });
  const visibleKnowledgeBases = [...filteredKnowledgeBases].sort((left, right) => {
    const syncDifference = getKnowledgeTimestamp(right.lastSyncedAt) - getKnowledgeTimestamp(left.lastSyncedAt);

    if (syncDifference !== 0) {
      return syncDifference;
    }

    const idDifference = getKnowledgeIdTimestamp(right.id) - getKnowledgeIdTimestamp(left.id);

    if (idDifference !== 0) {
      return idDifference;
    }

    return right.id.localeCompare(left.id);
  });
  const visibleReadyCount = filteredKnowledgeBases.filter((item) => getKnowledgeNextStep(item) === "ready").length;
  const visibleEnableCount = filteredKnowledgeBases.filter((item) => getKnowledgeNextStep(item) === "enable").length;
  const visibleScopeCount = filteredKnowledgeBases.filter((item) => getKnowledgeNextStep(item) === "fill_scope").length;
  const visibleTrustCount = filteredKnowledgeBases.filter((item) => getKnowledgeNextStep(item) === "confirm_trust").length;
  const visibleSyncCount = filteredKnowledgeBases.filter((item) => getKnowledgeNextStep(item) === "record_sync").length;
  const visibleCompareOnlyCount = filteredKnowledgeBases.filter((item) => getKnowledgeNextStep(item) === "compare_only").length;

  function clearFilters() {
    setTypeFilter([]);
    setStatusFilter([]);
  }

  function openCreateModal() {
    setEditingKnowledgeBase(undefined);
    form.setFieldsValue({
      name: "",
      type: "brand",
      sourceType: "manual",
      status: "enabled",
      usageScope: "",
      sourceUrl: "",
      contentPreview: "",
      autoCrawlEnabled: false,
      crawlWeekday: 1,
      crawlHour: 9,
      lastSyncedAt: ""
    });
    setModalOpen(true);
  }

  function openEditModal(record: KnowledgeBase) {
    setEditingKnowledgeBase(record);
    form.setFieldsValue({
      ...record,
      sourceType: record.sourceType || "manual",
      contentPreview: record.contentPreview || "",
      sourceUrl: record.sourceUrl || "",
      autoCrawlEnabled: Boolean(record.autoCrawl?.enabled),
      crawlWeekday: record.autoCrawl?.weekday || 1,
      crawlHour: record.autoCrawl?.hour || 9
    });
    setModalOpen(true);
  }

  async function handleSaveKnowledgeBase() {
    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const result = editingKnowledgeBase
        ? await callJsonApi(`/api/knowledge-bases/${editingKnowledgeBase.id}`, {
            method: "PATCH",
            body: JSON.stringify(values)
          })
        : await callJsonApi("/api/knowledge-bases", {
            method: "POST",
            body: JSON.stringify(values)
          });
      await refresh();
      messageApi.success(formatApiMessage(result, editingKnowledgeBase ? "知识库已保存" : "知识库已新增"));
      setModalOpen(false);
      setEditingKnowledgeBase(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存知识库失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(record: KnowledgeBase) {
    setTogglingId(record.id);

    try {
      const nextStatus = record.status === "enabled" ? "disabled" : "enabled";
      const result = await callJsonApi(`/api/knowledge-bases/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, nextStatus === "enabled" ? "知识库已启用" : "知识库已停用"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "更新知识库状态失败");
    } finally {
      setTogglingId(undefined);
    }
  }

  function renderKnowledgeEntry(record: KnowledgeBase) {
    const nextStep = getKnowledgeNextStep(record);

    if (nextStep === "enable") {
      return (
        <Button size="small" type="primary" loading={togglingId === record.id} onClick={() => handleToggleStatus(record)}>
          启用
        </Button>
      );
    }

    if (nextStep === "fill_scope" || nextStep === "confirm_trust" || nextStep === "record_sync") {
      return (
        <Button size="small" type="primary" onClick={() => openEditModal(record)}>
          补信息
        </Button>
      );
    }

    if (nextStep === "compare_only") {
      return (
        <Link href="/weekly-plan">
          <Button size="small">去对比选题</Button>
        </Link>
      );
    }

    return (
      <Link href="/today">
        <Button size="small">去内容生成</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader title="知识库" subtitle="统一导入资料、预览内容、按规则切片，并把可用 Chunk 提供给生成、GEO 诊断和周报复盘。" actions={<Button type="primary" onClick={openCreateModal} data-testid="knowledge-create-button">导入资料</Button>} />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <Card size="small">知识库：{knowledgeBases.length}</Card>
        <Card size="small">可调用：{visibleReadyCount}</Card>
        <Card size="small">Chunk：{knowledgeBases.reduce((sum, item) => sum + (item.chunks?.length || 0), 0)}</Card>
        <Card size="small">自动抓取：{knowledgeBases.filter((item) => item.autoCrawl?.enabled).length}</Card>
        <Card size="small">Prompt 模板：{promptTemplates.length}</Card>
      </div>
      <div className="two-column" style={{ marginBottom: 16 }}>
        <Card title="统一导入链路">
          <Table
            rowKey="step"
            size="small"
            pagination={false}
            dataSource={[
              { step: "1", title: "选择导入方式", detail: "URL / Markdown / Docx / 手动文本 / 自动抓取进入同一管道。" },
              { step: "2", title: "解析内容", detail: "先形成可读内容预览，不在内容生成页选择知识库类型。" },
              { step: "3", title: "规则切片", detail: "按段落和结论切成可引用 Chunk，V3 初版不依赖向量库。" },
              { step: "4", title: "Chunk 预览", detail: "用户能看到资料如何进入生成证据选择模板。" },
              { step: "5", title: "启用资料", detail: "保存名称、类型、调用范围和自动抓取设置。" }
            ]}
            columns={[
              { title: "步骤", dataIndex: "step" },
              { title: "动作", dataIndex: "title" },
              { title: "说明", dataIndex: "detail" }
            ]}
          />
        </Card>
        <Card title="资料更新配置">
          <Alert
            showIcon
            type="info"
            message="自动抓取配置放在知识库页，不放在内容生成页。"
            description="支持按周、周几、几点、上次抓取、下次抓取、立即手动抓取和启用 / 停用。"
          />
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={knowledgeBases.filter((item) => item.sourceType === "auto_crawl" || item.autoCrawl?.enabled).slice(0, 5)}
            style={{ marginTop: 16 }}
            columns={[
              { title: "知识库", dataIndex: "name" },
              { title: "状态", render: (_, record) => <Tag color={record.autoCrawl?.enabled ? "green" : "default"}>{record.autoCrawl?.enabled ? "启用" : "停用"}</Tag> },
              { title: "周期", render: (_, record) => `每周 ${record.autoCrawl?.weekday || 1} ${record.autoCrawl?.hour || 9}:00` },
              { title: "上次", render: (_, record) => record.autoCrawl?.lastCrawledAt || record.lastSyncedAt || "-" },
              { title: "下次", render: (_, record) => record.autoCrawl?.nextCrawlAt || "-" }
            ]}
          />
        </Card>
      </div>
      <Card title="知识库资产">
        <Alert
          showIcon
          type={visibleEnableCount || visibleScopeCount || visibleTrustCount ? "warning" : visibleSyncCount ? "info" : "success"}
          message={`知识库共 ${filteredKnowledgeBases.length} 条，可直接调用 ${visibleReadyCount} 条，需启用 ${visibleEnableCount} 条，需补范围 ${visibleScopeCount} 条`}
          description={`需确认可信度 ${visibleTrustCount} 条，需补同步记录 ${visibleSyncCount} 条，仅对比调用 ${visibleCompareOnlyCount} 条。`}
          style={{ marginBottom: 16 }}
        />
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按知识库类型筛选"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value)}
            options={knowledgeTypeOptions}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按启用状态筛选"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={statusOptions}
            style={{ minWidth: 200 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleKnowledgeBases}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有知识库条目" : "还没有知识库条目"}
                description={hasActiveFilter ? "清空筛选或调整类型、启用状态后再查看。" : "先补品牌事实、产品资料和官网博客，再让生成与诊断引用可信来源。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Button type="primary" onClick={openCreateModal}>导入资料</Button>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "类型", dataIndex: "type", render: (value) => <Tag>{knowledgeTypeLabels[value as KnowledgeBase["type"]]}</Tag> },
            { title: "导入方式", dataIndex: "sourceType", render: (value) => <Tag>{sourceTypeLabels[(value || "manual") as KnowledgeSourceType]}</Tag> },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "green" : "default"}>{statusLabels[value as KnowledgeBase["status"]]}</Tag> },
            { title: "调用范围", dataIndex: "usageScope" },
            { title: "Chunk", render: (_, record) => <Tag>{record.chunks?.length || 0}</Tag> },
            { title: "最近同步", dataIndex: "lastSyncedAt", render: (value) => value || "-" },
            {
              title: "可用性",
              render: (_, record) => {
                const nextStep = getKnowledgeNextStep(record);

                return <Tag color={knowledgeNextStepColors[nextStep]}>{knowledgeNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getKnowledgeNextStep(record);

                return <Tag color={knowledgeNextStepColors[nextStep]}>{knowledgeNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "处理动作",
              render: (_, record) => getKnowledgeActionText(record)
            },
            {
              title: "可执行入口",
              render: (_, record) => renderKnowledgeEntry(record)
            },
            {
              title: "维护",
              render: (_, record) => (
                <Space>
                  <Button size="small" onClick={() => openEditModal(record)}>
                    编辑
                  </Button>
                  <Button size="small" loading={togglingId === record.id} onClick={() => handleToggleStatus(record)}>
                    {record.status === "enabled" ? "停用" : "启用"}
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Card>
      <Modal
        title={editingKnowledgeBase ? "编辑资料导入" : "导入资料"}
        open={modalOpen}
        confirmLoading={saving}
        onOk={handleSaveKnowledgeBase}
        onCancel={() => setModalOpen(false)}
        okButtonProps={{ "data-testid": "knowledge-save-button" }}
        width={760}
      >
        <Form form={form} layout="vertical">
          <Tabs
            items={[
              {
                key: "import",
                label: "导入设置",
                children: (
                  <>
                    <Form.Item label="知识库名称" name="name">
                      <Input placeholder="例如：品牌事实库" data-testid="knowledge-name-input" />
                    </Form.Item>
                    <Form.Item label="类型" name="type">
                      <Select options={knowledgeTypeOptions} />
                    </Form.Item>
                    <Form.Item label="导入方式" name="sourceType">
                      <Select options={sourceTypeOptions} />
                    </Form.Item>
                    <Form.Item label="来源 URL" name="sourceUrl">
                      <Input placeholder="可选，例如 https://jotoai.com/articles/..." />
                    </Form.Item>
                    <Form.Item label="状态" name="status">
                      <Select options={statusOptions} />
                    </Form.Item>
                    <Form.Item label="调用范围" name="usageScope">
                      <Input.TextArea rows={3} placeholder="说明这个知识库在哪些任务中可以被调用" data-testid="knowledge-scope-input" />
                    </Form.Item>
                  </>
                )
              },
              {
                key: "preview",
                label: "内容预览",
                children: (
                  <Form.Item label="解析后的内容预览" name="contentPreview">
                    <Input.TextArea rows={9} placeholder="粘贴 URL 解析结果、Markdown、Docx 提取文本或手动资料。保存后会按规则生成 Chunk。" />
                  </Form.Item>
                )
              },
              {
                key: "chunks",
                label: "规则切片",
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Alert showIcon type="info" message="规则切片会按段落和结论生成 Chunk；保存内容预览后刷新列表即可看到 Chunk 预览。" />
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={editingKnowledgeBase?.chunks || []}
                      columns={[
                        { title: "Chunk", dataIndex: "chunkTitle" },
                        { title: "路径", dataIndex: "sectionPath" },
                        { title: "Token", dataIndex: "tokenCount" },
                        { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }
                      ]}
                    />
                  </Space>
                )
              },
              {
                key: "crawl",
                label: "自动抓取",
                children: (
                  <>
                    <Form.Item name="autoCrawlEnabled" valuePropName="checked">
                      <Checkbox>启用自动抓取</Checkbox>
                    </Form.Item>
                    <Space wrap>
                      <Form.Item label="周几" name="crawlWeekday">
                        <InputNumber min={1} max={7} />
                      </Form.Item>
                      <Form.Item label="几点" name="crawlHour">
                        <InputNumber min={0} max={23} />
                      </Form.Item>
                    </Space>
                    <Form.Item label="最近同步" name="lastSyncedAt">
                      <Input placeholder="可选，留空则使用当前时间" />
                    </Form.Item>
                    <Alert showIcon type="info" message="立即手动抓取在 V3 首版复用保存动作；后续接入真实 crawler 后再拆成独立执行按钮。" />
                  </>
                )
              }
            ]}
          />
        </Form>
      </Modal>
    </>
  );
}
