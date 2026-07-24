"use client";

import { FileTextOutlined, ImportOutlined, InfoCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Form, Input, List, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type { V5KnowledgeBaseDetail, V5KnowledgeUnderstandingItem } from "@/lib/v5/knowledge-workspace-contracts";

type DetailResponse = { ok: true; data: { knowledgeBase: V5KnowledgeBaseDetail; stateVersion: number } };

const actionTypeLabels = {
  critical_evidence_missing: "需要补充关键资料",
  public_scope_uncertain: "确认公开范围",
  unrecoverable_source_failure: "资料处理失败"
};

export default function KnowledgeDetailPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();
  const [data, setData] = useState<DetailResponse["data"]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [importOpen, setImportOpen] = useState(searchParams.get("import") === "1");
  const [saving, setSaving] = useState(false);
  const [evidence, setEvidence] = useState<V5KnowledgeUnderstandingItem>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await callJsonApi<DetailResponse>(`/api/v5/knowledge-bases/${params.id}`, { cache: "no-store" });
      setData(result.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "知识库详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addMaterial() {
    const values = await form.validateFields();
    if (!data) return;
    setSaving(true);
    try {
      await callJsonApi(`/api/v5/knowledge-bases/${params.id}/materials`, {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, data.knowledgeBase.rowVersion, "导入资料并更新知识快照"),
          title: values.title,
          kind: values.kind,
          summary: values.summary,
          evidenceExcerpt: values.evidenceExcerpt,
          sourceOwner: values.sourceOwner,
          visibility: values.visibility,
          limitation: values.limitation
        })
      });
      setImportOpen(false);
      form.resetFields();
      await refresh();
      messageApi.success("资料已导入，系统理解与知识快照已更新。");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "导入资料失败");
    } finally {
      setSaving(false);
    }
  }

  async function resolveAction(actionItemId: string, rowVersion: number) {
    setSaving(true);
    try {
      await callJsonApi(`/api/v5/knowledge-action-items/${actionItemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, rowVersion, "确认知识库待处理事项已处理"),
          status: "resolved"
        })
      });
      await refresh();
      messageApi.success("待处理事项已完成，系统已生成新知识快照。");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "更新待处理事项失败");
    } finally {
      setSaving(false);
    }
  }

  if (!data?.knowledgeBase && !loading && error) {
    return <><PageHeader title="知识库详情" actions={<Link href="/knowledge"><Button>返回知识库</Button></Link>} /><PageErrorState message={error} onRetry={refresh} /></>;
  }

  const knowledgeBase = data?.knowledgeBase;
  const openActions = knowledgeBase?.actionItems.filter((item) => item.status === "open") || [];
  const materialsTab = (
    <Card className="foundation-panel" bordered={false}>
      <Table
        rowKey="materialId"
        loading={loading}
        dataSource={knowledgeBase?.materials || []}
        locale={{ emptyText: <ActionEmpty title="尚未导入资料" description="导入 URL、文档或文本后，系统会自动处理并更新理解。" action={<Button type="primary" onClick={() => setImportOpen(true)}>导入资料</Button>} /> }}
        columns={[
          { title: "资料", dataIndex: "title", render: (value) => <Space><FileTextOutlined /><strong>{value}</strong></Space> },
          { title: "类型", dataIndex: "kind", width: 110, render: (value) => ({ url: "URL", document: "文档", text: "文本" }[value as string] || value) },
          { title: "状态", dataIndex: "status", width: 120, render: (value) => <Tag color={value === "ready" ? "green" : value === "failed" ? "red" : "blue"}>{value === "ready" ? "已完成" : value === "failed" ? "失败" : "处理中"}</Tag> },
          { title: "更新时间", dataIndex: "updatedAt", width: 190, render: (value) => new Date(value).toLocaleString("zh-CN", { hour12: false }) }
        ]}
      />
    </Card>
  );

  const understandingTab = (
    <Card className="foundation-panel" bordered={false}>
      <Alert showIcon type="info" message="系统目前理解" description="以下是已导入资料能够支撑的自然语言概括；生成内容时系统仍会核对原文和公开范围。" />
      <List
        dataSource={knowledgeBase?.understanding || []}
        locale={{ emptyText: <ActionEmpty title="暂无系统理解" description="导入包含可读内容的资料后自动生成。" /> }}
        renderItem={(item) => (
          <List.Item actions={[<Button key="evidence" size="small" onClick={() => setEvidence(item)}>查看依据</Button>]}>
            <List.Item.Meta avatar={<InfoCircleOutlined />} title={item.summary} description={item.limitation || "当前无额外公开限制"} />
          </List.Item>
        )}
      />
    </Card>
  );

  const actionsTab = (
    <Card className="foundation-panel" bordered={false}>
      <Alert
        showIcon
        type={knowledgeBase?.productionBlockingActionCount ? "warning" : "success"}
        message={knowledgeBase?.productionStatus === "ready" ? "知识库仍可用于内容生产" : "仅受影响的具体表达被限制"}
        description="这里只保留缺关键资料、公开范围无法判断和无法自动恢复的资料失败。重复、切片质量和可自动降级事项不会成为用户待办，也不阻断整个知识库。"
      />
      <List
        dataSource={openActions}
        locale={{ emptyText: <ActionEmpty title="没有需要处理的事项" description="系统已自动完成常规治理。" /> }}
        renderItem={(item) => (
          <List.Item actions={[<Button key="resolve" size="small" loading={saving} onClick={() => resolveAction(item.actionItemId, item.rowVersion)}>标记已处理</Button>]}>
            <List.Item.Meta
              avatar={<WarningOutlined style={{ color: item.affectsProduction ? "#cf1322" : "#d48806" }} />}
              title={<Space wrap><strong>{actionTypeLabels[item.type]}</strong>{item.affectsProduction ? <Tag color="red">影响相关表达</Tag> : <Tag color="gold">不阻断生产</Tag>}</Space>}
              description={<div><Typography.Paragraph style={{ marginBottom: 4 }}>{item.description}</Typography.Paragraph><Typography.Text type="secondary">下一步：{item.recommendedAction}</Typography.Text></div>}
            />
          </List.Item>
        )}
      />
    </Card>
  );

  return (
    <>
      {contextHolder}
      <PageHeader
        title={knowledgeBase?.name || "知识库详情"}
        subtitle={knowledgeBase ? `重点：${knowledgeBase.focus}` : "加载中"}
        titleExtra={knowledgeBase?.dataSource === "demo" ? <Tag>demo</Tag> : undefined}
        actions={<Space wrap><Link href="/knowledge"><Button>返回列表</Button></Link><Button type="primary" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入资料</Button></Space>}
      />
      <PageErrorState message={error} loading={loading && !data} onRetry={refresh} />
      {knowledgeBase ? (
        <>
          <Card className="foundation-status-band" bordered={false}>
            <Space wrap size="large">
              <Tag color={knowledgeBase.productionStatus === "ready" ? "green" : knowledgeBase.productionStatus === "limited" ? "gold" : "default"}>
                {knowledgeBase.productionStatus === "ready" ? "可用于内容生产" : knowledgeBase.productionStatus === "limited" ? "部分表达受限" : "待导入资料"}
              </Tag>
              <Typography.Text>资料 {knowledgeBase.materialCount}</Typography.Text>
              <Typography.Text>待处理 {knowledgeBase.openActionCount}</Typography.Text>
              <Typography.Text type="secondary">最近更新 {new Date(knowledgeBase.updatedAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text>
            </Space>
          </Card>
          <Tabs
            defaultActiveKey="materials"
            items={[
              { key: "materials", label: `资料 ${knowledgeBase.materialCount}`, children: materialsTab },
              { key: "understanding", label: "系统理解", children: understandingTab },
              { key: "actions", label: `待处理 ${openActions.length}`, children: actionsTab }
            ]}
          />
        </>
      ) : null}

      <Modal title="导入资料" open={importOpen} onCancel={() => setImportOpen(false)} onOk={addMaterial} confirmLoading={saving} okText="导入并更新理解" width={680}>
        <Form form={form} layout="vertical" initialValues={{ kind: "document", visibility: knowledgeBase?.defaultVisibility || "conditional_public" }}>
          <Form.Item name="title" label="资料名称" rules={[{ required: true, message: "请填写资料名称" }]}><Input /></Form.Item>
          <Space wrap style={{ width: "100%" }}>
            <Form.Item name="kind" label="资料类型"><Select style={{ width: 150 }} options={[{ value: "url", label: "URL" }, { value: "document", label: "文档" }, { value: "text", label: "文本" }]} /></Form.Item>
            <Form.Item name="visibility" label="公开范围"><Select style={{ width: 220 }} options={[{ value: "internal_only", label: "仅内部使用" }, { value: "conditional_public", label: "公开文章逐条确认" }, { value: "public", label: "允许公开引用" }]} /></Form.Item>
          </Space>
          <Form.Item name="summary" label="资料支持的系统理解" extra="可留空；系统处理真实正文后再自动生成。"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="evidenceExcerpt" label="原文片段（可选）"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="sourceOwner" label="来源主体（可选）"><Input /></Form.Item>
          <Form.Item name="limitation" label="公开限制（可选）"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Drawer title="内容依据" open={Boolean(evidence)} onClose={() => setEvidence(undefined)} width={560}>
        {evidence && knowledgeBase ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="系统理解">{evidence.summary}</Descriptions.Item>
              <Descriptions.Item label="原文片段">{evidence.evidenceExcerpt}</Descriptions.Item>
              <Descriptions.Item label="来自资料">{evidence.materialTitle}</Descriptions.Item>
              <Descriptions.Item label="来源主体">{evidence.sourceOwner}</Descriptions.Item>
              <Descriptions.Item label="公开范围">{evidence.visibility}</Descriptions.Item>
              <Descriptions.Item label="限制">{evidence.limitation || "无额外限制"}</Descriptions.Item>
            </Descriptions>
            <Collapse
              ghost
              items={[{
                key: "technical",
                label: "技术信息",
                children: <Typography.Paragraph copyable>{`sourceSnapshotHash: ${knowledgeBase.sourceSnapshotHash}\nunderstandingId: ${evidence.understandingId}\nmaterialId: ${evidence.materialId}`}</Typography.Paragraph>
              }]}
            />
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
