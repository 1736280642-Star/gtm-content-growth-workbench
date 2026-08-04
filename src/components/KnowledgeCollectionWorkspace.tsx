"use client";

import {
  ClockCircleOutlined,
  DatabaseOutlined,
  ImportOutlined,
  LinkOutlined
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { callJsonApi } from "@/lib/client-api";
import { createV5WritePayload } from "@/lib/v5-client";
import type {
  V5KnowledgeCollectionSnapshot,
  V5KnowledgeCollectionSource,
  V5KnowledgeCollectionWorkspace as CollectionWorkspace
} from "@/lib/v5/knowledge-collection-contracts";
import type { V5KnowledgeBaseWorkspace } from "@/lib/v5/knowledge-workspace-contracts";

type CollectionResponse = { ok: true; data: CollectionWorkspace };
type KnowledgeResponse = { ok: true; data: { knowledgeBases: V5KnowledgeBaseWorkspace[]; stateVersion: number } };
type ProductResponse = { products: Array<{ productId: string; displayName: string }> };

const collectionStatusLabels = {
  collected: "新增收录",
  updated: "内容更新",
  unchanged: "内容未变",
  failed: "采集失败"
};

const governanceStatusLabels = {
  archived: "已归档",
  queued: "治理排队中",
  indexed: "已索引",
  pending_config: "待基础设施恢复",
  failed: "治理失败"
};

function statusColor(value: string) {
  if (value === "collected" || value === "updated" || value === "indexed" || value === "archived") return "green";
  if (value === "failed") return "red";
  if (value === "pending_config") return "gold";
  return "blue";
}

export function KnowledgeCollectionWorkspace() {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [workspace, setWorkspace] = useState<CollectionWorkspace>();
  const [knowledgeBases, setKnowledgeBases] = useState<V5KnowledgeBaseWorkspace[]>([]);
  const [products, setProducts] = useState<Array<{ productId: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<V5KnowledgeCollectionSnapshot>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [collectionResult, knowledgeResult] = await Promise.all([
        callJsonApi<CollectionResponse>("/api/v5/knowledge-collection/sources", { cache: "no-store" }),
        callJsonApi<KnowledgeResponse>("/api/v5/knowledge-bases", { cache: "no-store" })
      ]);
      setWorkspace(collectionResult.data);
      setKnowledgeBases(knowledgeResult.data.knowledgeBases);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "动态知识采集工作区加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void refresh();
    callJsonApi<ProductResponse>("/api/v5/products", { cache: "no-store" })
      .then((result) => setProducts(result.products || []))
      .catch(() => setProducts([]));
  }, [refresh]);

  const knowledgeBaseOptions = useMemo(
    () => knowledgeBases.map((item) => ({ value: item.knowledgeBaseId, label: item.name })),
    [knowledgeBases]
  );
  const productOptions = useMemo(
    () => products.map((item) => ({ value: item.productId, label: item.displayName })),
    [products]
  );

  async function importSource() {
    const values = await form.validateFields();
    if (!workspace) return;
    const product = products.find((item) => item.productId === values.defaultProductId);
    setSaving(true);
    try {
      await callJsonApi("/api/v5/knowledge-collection/sources", {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspace.stateVersion, "导入每日自动采集来源"),
          ...values,
          defaultProductName: product?.displayName
        })
      });
      form.resetFields();
      setImportOpen(false);
      await refresh();
      messageApi.success("来源已导入，将自动进入每日采集、归属、归档与治理链路。");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "来源导入失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSource(source: V5KnowledgeCollectionSource, enabled: boolean) {
    try {
      await callJsonApi(`/api/v5/knowledge-collection/sources/${source.sourceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...createV5WritePayload(source.rowVersion, enabled ? "恢复每日自动采集" : "暂停每日自动采集"),
          enabled
        })
      });
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "来源状态更新失败");
    }
  }

  const todayTab = (
    <Table
      rowKey="snapshotId"
      loading={loading}
      dataSource={workspace?.todaySnapshots || []}
      scroll={{ x: 1280 }}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      locale={{
        emptyText: (
          <ActionEmpty
            title="今日还没有采集快照"
            description={workspace?.sources.length ? "到达执行时间后，系统会自动显示采集结果。" : "先导入一个站点或微信公众号来源。"}
            action={!workspace?.sources.length ? <Button type="primary" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>来源导入</Button> : undefined}
          />
        )
      }}
      columns={[
        {
          title: "文章标题",
          dataIndex: "title",
          width: 280,
          render: (value, record) => (
            <Button type="link" style={{ padding: 0, height: "auto", whiteSpace: "normal", textAlign: "left" }} onClick={() => setSelectedSnapshot(record)}>
              {value}
            </Button>
          )
        },
        {
          title: "对应产品或服务",
          dataIndex: "entityName",
          width: 180,
          render: (value, record) => (
            <Space direction="vertical" size={2}>
              <strong>{value}</strong>
              <Typography.Text type="secondary">{record.entityType === "service" ? "服务" : record.entityType === "product" ? "产品" : "其他"}</Typography.Text>
            </Space>
          )
        },
        {
          title: "URL",
          dataIndex: "url",
          width: 100,
          render: (value) => <Button type="link" icon={<LinkOutlined />} href={value} target="_blank" rel="noreferrer">打开</Button>
        },
        {
          title: "收录内容",
          dataIndex: "excerpt",
          width: 320,
          ellipsis: true,
          render: (value, record) => <Typography.Link onClick={() => setSelectedSnapshot(record)}>{value || record.governanceMessage || "查看采集结果"}</Typography.Link>
        },
        { title: "归档知识库", dataIndex: "knowledgeBaseName", width: 180 },
        {
          title: "采集状态",
          dataIndex: "collectionStatus",
          width: 120,
          render: (value) => <Tag color={statusColor(value)}>{collectionStatusLabels[value as keyof typeof collectionStatusLabels]}</Tag>
        },
        {
          title: "治理状态",
          dataIndex: "governanceStatus",
          width: 140,
          render: (value) => <Tag color={statusColor(value)}>{governanceStatusLabels[value as keyof typeof governanceStatusLabels]}</Tag>
        },
        {
          title: "采集时间",
          dataIndex: "collectedAt",
          width: 180,
          render: (value) => new Date(value).toLocaleString("zh-CN", { hour12: false })
        }
      ]}
    />
  );

  const sourcesTab = (
    <Table
      rowKey="sourceId"
      loading={loading}
      dataSource={workspace?.sources || []}
      scroll={{ x: 1050 }}
      locale={{
        emptyText: <ActionEmpty title="还没有导入来源" description="导入后系统每天自动执行完整采集链路。" action={<Button type="primary" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>来源导入</Button>} />
      }}
      columns={[
        {
          title: "来源",
          width: 240,
          render: (_, record) => (
            <Space direction="vertical" size={2}>
              <Space><DatabaseOutlined /><strong>{record.name}</strong></Space>
              <Typography.Text type="secondary">{record.sourceType === "site" ? "指定站点" : "微信公众号"}</Typography.Text>
            </Space>
          )
        },
        { title: "入口 / 账号", width: 280, render: (_, record) => record.entryUrl || record.accountId || "-" },
        { title: "默认归档", dataIndex: "defaultKnowledgeBaseId", width: 180, render: (value) => knowledgeBases.find((item) => item.knowledgeBaseId === value)?.name || value },
        {
          title: "最近运行",
          width: 180,
          render: (_, record) => record.lastCollectedAt
            ? new Date(record.lastCollectedAt).toLocaleString("zh-CN", { hour12: false })
            : "等待首次采集"
        },
        {
          title: "状态",
          width: 130,
          render: (_, record) => <Tag color={record.lastStatus === "failed" ? "red" : record.enabled ? "green" : "default"}>{record.enabled ? record.lastStatus === "failed" ? "自动重试中" : "每日采集" : "已暂停"}</Tag>
        },
        {
          title: "执行时间",
          dataIndex: "scheduleHour",
          width: 120,
          render: (value) => <Space><ClockCircleOutlined />每日 {String(value).padStart(2, "0")}:00</Space>
        },
        {
          title: "启用",
          width: 80,
          fixed: "right" as const,
          render: (_, record) => <Switch checked={record.enabled} onChange={(checked) => void toggleSource(record, checked)} />
        }
      ]}
    />
  );

  return (
    <>
      {contextHolder}
      <div className="foundation-panel">
        <Tabs
          defaultActiveKey="today"
          tabBarExtraContent={<Button type="primary" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>来源导入</Button>}
          items={[
            { key: "today", label: `今日采集 ${workspace?.todaySnapshots.length || 0}`, children: todayTab },
            { key: "sources", label: `采集来源 ${workspace?.sources.length || 0}`, children: sourcesTab }
          ]}
        />
      </div>

      <Modal
        title="来源导入"
        open={importOpen}
        width={680}
        okText="导入并启用每日采集"
        cancelText="取消"
        confirmLoading={saving}
        onOk={importSource}
        onCancel={() => setImportOpen(false)}
      >
        <Form form={form} layout="vertical" initialValues={{ sourceType: "site", scheduleHour: 8 }}>
          <Form.Item name="name" label="来源名称" rules={[{ required: true, message: "请填写来源名称" }]}>
            <Input maxLength={120} placeholder="例如：JOTO 官方内容" />
          </Form.Item>
          <Form.Item name="sourceType" label="来源类型" rules={[{ required: true }]}>
            <Select options={[{ value: "site", label: "指定站点" }, { value: "wechat_account", label: "微信公众号" }]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.sourceType !== current.sourceType}>
            {({ getFieldValue }) => getFieldValue("sourceType") === "wechat_account" ? (
              <>
                <Form.Item
                  name="accountId"
                  label="公众号订阅"
                  rules={[{ required: true, message: "请填写订阅 ID 或准确的公众号名称" }]}
                  extra="填写订阅服务中的 subscriptionId；也可以填写订阅列表中完全一致的公众号名称。"
                >
                  <Input placeholder="subscriptionId 或公众号名称" />
                </Form.Item>
                <Form.Item name="entryUrl" label="文章列表地址">
                  <Input placeholder="RSS、Atom 或已授权的公开文章列表 URL" />
                </Form.Item>
              </>
            ) : (
              <Form.Item name="entryUrl" label="站点入口" rules={[{ required: true, message: "请填写站点、Sitemap 或 RSS 地址" }]}>
                <Input placeholder="https://example.com/blog" />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="defaultKnowledgeBaseId" label="默认归档知识库" rules={[{ required: true, message: "请选择自动兜底知识库" }]}>
            <Select options={knowledgeBaseOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="defaultProductId" label="默认产品或服务">
            <Select allowClear options={productOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="scheduleHour" label="每日执行时间">
            <Space>
              <InputNumber min={0} max={23} precision={0} style={{ width: 140 }} />
              <Typography.Text>时</Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item
            name="publicUseConfirmed"
            valuePropName="checked"
            rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认来源内容的使用权限")) }]}
          >
            <Checkbox>已确认该来源内容可用于知识治理与公开内容生产</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={selectedSnapshot?.title || "收录内容"}
        width={720}
        open={Boolean(selectedSnapshot)}
        onClose={() => setSelectedSnapshot(undefined)}
      >
        {selectedSnapshot ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Space wrap>
              <Tag color={statusColor(selectedSnapshot.collectionStatus)}>{collectionStatusLabels[selectedSnapshot.collectionStatus]}</Tag>
              <Tag color={statusColor(selectedSnapshot.governanceStatus)}>{governanceStatusLabels[selectedSnapshot.governanceStatus]}</Tag>
              <Tag>{selectedSnapshot.entityName}</Tag>
              <Tag>{selectedSnapshot.knowledgeBaseName}</Tag>
            </Space>
            <Typography.Paragraph>
              <Typography.Text strong>归属依据：</Typography.Text>
              {selectedSnapshot.classificationReasons.join("；")}（置信度 {Math.round(selectedSnapshot.classificationConfidence * 100)}%）
            </Typography.Paragraph>
            {selectedSnapshot.governanceMessage ? <Typography.Text type="secondary">{selectedSnapshot.governanceMessage}</Typography.Text> : null}
            <Typography.Link href={selectedSnapshot.url} target="_blank" rel="noreferrer">{selectedSnapshot.url}</Typography.Link>
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }} copyable>{selectedSnapshot.content || selectedSnapshot.governanceMessage || "未收录到正文。"}</Typography.Paragraph>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
