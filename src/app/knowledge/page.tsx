"use client";

import { BookOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type { V5KnowledgeBaseWorkspace, V5KnowledgeVisibility } from "@/lib/v5/knowledge-workspace-contracts";

type KnowledgeResponse = { ok: true; data: { knowledgeBases: V5KnowledgeBaseWorkspace[]; stateVersion: number } };

const visibilityLabels: Record<V5KnowledgeVisibility, string> = {
  internal_only: "仅内部使用",
  conditional_public: "公开文章逐条确认",
  public: "允许公开引用"
};

export default function KnowledgePage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();
  const [data, setData] = useState<KnowledgeResponse["data"]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | V5KnowledgeBaseWorkspace["productionStatus"]>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await callJsonApi<KnowledgeResponse>("/api/v5/knowledge-bases", { cache: "no-store" });
      setData(result.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "知识库加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const visibleItems = useMemo(() => (data?.knowledgeBases || []).filter((item) => statusFilter === "all" || item.productionStatus === statusFilter), [data?.knowledgeBases, statusFilter]);

  async function createKnowledgeBase() {
    const values = await form.validateFields();
    if (!data) return;
    setSaving(true);
    try {
      const result = await callJsonApi<{ data: { knowledgeBase: V5KnowledgeBaseWorkspace } }>("/api/v5/knowledge-bases", {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, data.stateVersion, "创建知识库并准备导入资料"),
          name: values.name,
          focus: values.focus,
          defaultVisibility: values.defaultVisibility
        })
      });
      setCreateOpen(false);
      form.resetFields();
      messageApi.success("知识库已创建，请继续导入资料。");
      router.push(`/knowledge/${result.data.knowledgeBase.knowledgeBaseId}?import=1`);
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "创建知识库失败");
    } finally {
      setSaving(false);
    }
  }

  const readyCount = data?.knowledgeBases.filter((item) => item.productionStatus === "ready").length || 0;
  const pendingCount = data?.knowledgeBases.reduce((sum, item) => sum + item.openActionCount, 0) || 0;
  const materialCount = data?.knowledgeBases.reduce((sum, item) => sum + item.materialCount, 0) || 0;

  return (
    <>
      {contextHolder}
      <PageHeader
        title="知识库"
        subtitle="用名称和重点限定系统理解方向；资料处理、索引和治理由系统自动完成。"
        actions={
          <Space wrap>
            <Link href="/knowledge/import"><Button icon={<UploadOutlined />}>导入到已有知识库</Button></Link>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} data-testid="knowledge-create-button">创建知识库</Button>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading && !data} onRetry={refresh} />
      <div className="metric-grid">
        <MetricCard title="知识库" value={data?.knowledgeBases.length || 0} suffix="个" />
        <MetricCard title="可用于内容生产" value={readyCount} suffix="个" />
        <MetricCard title="资料" value={materialCount} suffix="份" />
        <MetricCard title="待处理" value={pendingCount} suffix="项" />
      </div>
      <Card className="foundation-panel" bordered={false}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "全部状态" },
              { value: "ready", label: "可用于内容生产" },
              { value: "limited", label: "部分表达受限" },
              { value: "empty", label: "待导入资料" }
            ]}
            style={{ minWidth: 190 }}
          />
          <Typography.Text type="secondary">非关键事项只限制受影响表达，不阻断整个知识库。</Typography.Text>
        </Space>
        <Table
          rowKey="knowledgeBaseId"
          loading={loading}
          dataSource={visibleItems}
          scroll={{ x: 900 }}
          locale={{ emptyText: <ActionEmpty title="还没有知识库" description="创建知识库后导入第一份真实资料。" action={<Button type="primary" onClick={() => setCreateOpen(true)}>创建知识库</Button>} /> }}
          columns={[
            {
              title: "知识库",
              width: 360,
              render: (_, record) => (
                <div className="foundation-question-cell">
                  <Space><BookOutlined /><Link href={`/knowledge/${record.knowledgeBaseId}`}><strong>{record.name}</strong></Link>{record.dataSource === "demo" ? <Tag>demo</Tag> : null}</Space>
                  <span>重点：{record.focus}</span>
                </div>
              )
            },
            { title: "资料", dataIndex: "materialCount", width: 90, render: (value) => `${value} 份` },
            { title: "待处理", dataIndex: "openActionCount", width: 100, render: (value, record) => <Tag color={record.productionBlockingActionCount > 0 ? "red" : value > 0 ? "gold" : "green"}>{value} 项</Tag> },
            {
              title: "状态",
              dataIndex: "productionStatus",
              width: 170,
              render: (value) => value === "ready" ? <Tag color="green">可用于内容生产</Tag> : value === "limited" ? <Tag color="gold">部分表达受限</Tag> : <Tag>待导入资料</Tag>
            },
            { title: "最近更新", dataIndex: "updatedAt", width: 190, render: (value) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
            { title: "操作", width: 90, fixed: "right" as const, render: (_, record) => <Link href={`/knowledge/${record.knowledgeBaseId}`}><Button size="small">查看</Button></Link> }
          ]}
        />
      </Card>

      <Modal title="创建知识库" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createKnowledgeBase} confirmLoading={saving} okText="创建并导入" width={640}>
        <Form form={form} layout="vertical" initialValues={{ defaultVisibility: "conditional_public" }}>
          <Form.Item name="name" label="知识库名称" rules={[{ required: true, message: "请填写知识库名称" }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="focus" label="知识库重点" rules={[{ required: true, message: "请说明希望系统重点理解什么" }]} extra="重点只限定理解和检索方向，不会直接成为文章事实。">
            <Input.TextArea rows={4} maxLength={600} showCount />
          </Form.Item>
          <Form.Item name="defaultVisibility" label="默认公开范围">
            <Select options={Object.entries(visibilityLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
