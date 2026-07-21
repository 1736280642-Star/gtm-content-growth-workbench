"use client";

import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { KnowledgeBase } from "@/lib/types";
import { useState } from "react";

const knowledgeTypeLabels: Record<KnowledgeBase["type"], string> = {
  brand: "品牌事实",
  product: "产品知识",
  official_blog: "官网博客",
  channel_history: "渠道历史",
  competitor: "竞品参考",
  source_site: "外部来源"
};

const trustLevelLabels: Record<KnowledgeBase["trustLevel"], string> = {
  highest: "最高",
  high: "高",
  medium: "中",
  reference: "参考"
};

const trustLevelColors: Record<KnowledgeBase["trustLevel"], string> = {
  highest: "green",
  high: "blue",
  medium: "gold",
  reference: "default"
};

const statusLabels: Record<KnowledgeBase["status"], string> = {
  enabled: "启用",
  disabled: "停用"
};

const knowledgeTypeOptions = Object.entries(knowledgeTypeLabels).map(([value, label]) => ({ value, label }));
const trustLevelOptions = Object.entries(trustLevelLabels).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));

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

  if (!record.usageScope.trim()) {
    return "fill_scope";
  }

  if (record.type === "competitor") {
    return "compare_only";
  }

  if (record.trustLevel === "reference") {
    return "confirm_trust";
  }

  if (!record.lastSyncedAt) {
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
    return "确认来源可信度，普通品牌事实不建议直接引用参考级来源。";
  }

  if (nextStep === "record_sync") {
    return "补最近同步时间，方便判断知识是否过期。";
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
  const [trustLevelFilter, setTrustLevelFilter] = useState<KnowledgeBase["trustLevel"][]>([]);
  const [statusFilter, setStatusFilter] = useState<KnowledgeBase["status"][]>([]);
  const hasActiveFilter = Boolean(typeFilter.length || trustLevelFilter.length || statusFilter.length);
  const filteredKnowledgeBases = knowledgeBases.filter((item) => {
    const typeMatched = !typeFilter.length || typeFilter.includes(item.type);
    const trustMatched = !trustLevelFilter.length || trustLevelFilter.includes(item.trustLevel);
    const statusMatched = !statusFilter.length || statusFilter.includes(item.status);

    return typeMatched && trustMatched && statusMatched;
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
    setTrustLevelFilter([]);
    setStatusFilter([]);
  }

  function openCreateModal() {
    setEditingKnowledgeBase(undefined);
    form.setFieldsValue({
      name: "",
      type: "brand",
      trustLevel: "medium",
      status: "enabled",
      usageScope: "",
      lastSyncedAt: ""
    });
    setModalOpen(true);
  }

  function openEditModal(record: KnowledgeBase) {
    setEditingKnowledgeBase(record);
    form.setFieldsValue(record);
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
        <Link href="/monthly-plan">
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
      <PageHeader title="知识库" subtitle="管理内容生成和诊断依据；竞品知识库只能在对比和差异化任务中调用。" actions={<Button type="primary" onClick={openCreateModal} data-testid="knowledge-create-button">新增知识库</Button>} />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Alert
        type="warning"
        showIcon
        message="竞品知识库不是品牌事实源，普通品牌文章默认不调用。"
        style={{ marginBottom: 16 }}
      />
      <Card>
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
            placeholder="按可信等级筛选"
            value={trustLevelFilter}
            onChange={(value) => setTrustLevelFilter(value)}
            options={trustLevelOptions}
            style={{ minWidth: 200 }}
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
                description={hasActiveFilter ? "清空筛选或调整类型、可信等级、启用状态后再查看。" : "先补品牌事实、产品知识和渠道规则，再让生成与诊断引用可信来源。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Button type="primary" onClick={openCreateModal}>新增知识库</Button>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "类型", dataIndex: "type", render: (value) => <Tag>{knowledgeTypeLabels[value as KnowledgeBase["type"]]}</Tag> },
            { title: "可信等级", dataIndex: "trustLevel", render: (value) => <Tag color={trustLevelColors[value as KnowledgeBase["trustLevel"]]}>{trustLevelLabels[value as KnowledgeBase["trustLevel"]]}</Tag> },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "green" : "default"}>{statusLabels[value as KnowledgeBase["status"]]}</Tag> },
            { title: "调用范围", dataIndex: "usageScope" },
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
        title={editingKnowledgeBase ? "编辑知识库" : "新增知识库"}
        open={modalOpen}
        confirmLoading={saving}
        onOk={handleSaveKnowledgeBase}
        onCancel={() => setModalOpen(false)}
        okButtonProps={{ "data-testid": "knowledge-save-button" }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name">
            <Input placeholder="例如：品牌事实库" data-testid="knowledge-name-input" />
          </Form.Item>
          <Form.Item label="类型" name="type">
            <Select options={knowledgeTypeOptions} />
          </Form.Item>
          <Form.Item label="可信等级" name="trustLevel">
            <Select options={trustLevelOptions} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select options={statusOptions} />
          </Form.Item>
          <Form.Item label="调用范围" name="usageScope">
            <Input.TextArea rows={3} placeholder="说明这个知识库在哪些任务中可以被调用" data-testid="knowledge-scope-input" />
          </Form.Item>
          <Form.Item label="最近同步" name="lastSyncedAt">
            <Input placeholder="可选，留空则使用当前时间" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
