"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type {
  V5ArticleExpressionProfileView,
  V5ArticleExpressionStructureModule,
  V5ConfigurationStatusItem
} from "@/lib/v5/article-expression-contracts";

type ProfilesResponse = { ok: true; data: { profiles: V5ArticleExpressionProfileView[]; stateVersion: number } };
type ConfigurationResponse = { ok: true; data: { items: V5ConfigurationStatusItem[] } };

function tabFromQuery(value: string | null) {
  return value === "connections" ? "publish_connections" : value || "models";
}

export default function ConfigurationPage() {
  const searchParams = useSearchParams();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();
  const [profilesData, setProfilesData] = useState<ProfilesResponse["data"]>();
  const [configurationItems, setConfigurationItems] = useState<V5ConfigurationStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activeTab, setActiveTab] = useState(() => tabFromQuery(searchParams.get("tab")));
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<V5ArticleExpressionProfileView>();
  const [modules, setModules] = useState<V5ArticleExpressionStructureModule[]>([]);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [profiles, configuration] = await Promise.all([
        callJsonApi<ProfilesResponse>("/api/v5/article-expression-profiles", { cache: "no-store" }),
        callJsonApi<ConfigurationResponse>("/api/v5/configuration/status", { cache: "no-store" })
      ]);
      setProfilesData(profiles.data);
      setConfigurationItems(configuration.data.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "配置管理加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function openEditor(profile?: V5ArticleExpressionProfileView) {
    setEditingProfile(profile);
    const version = profile?.currentVersion;
    setModules(version?.structureModules || []);
    form.resetFields();
    form.setFieldsValue(profile ? {
      name: profile.name,
      targetAudience: version!.targetAudience,
      writingFocus: version!.writingFocus,
      minLength: version!.minLength,
      maxLength: version!.maxLength,
      cta: version!.cta,
      forbiddenStyles: version!.forbiddenStyles.join("\n"),
      otherInstructions: version!.otherInstructions || version!.notes
    } : {});
    setEditorOpen(true);
  }

  function moveModule(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;
    setModules((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addModule() {
    setModules((current) => [...current, {
      moduleId: `custom-${Date.now()}`,
      label: "",
      guidance: "",
      required: false
    }]);
  }

  function removeModule(index: number) {
    setModules((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveProfile() {
    const values = await form.validateFields();
    if (!profilesData) return;
    if (modules.some((item) => Boolean(item.label.trim()) !== Boolean(item.guidance.trim()))) {
      messageApi.error("结构模块需要同时填写名称和说明，或删除未完成模块。");
      return;
    }
    setSaving(true);
    const expectedVersion = editingProfile?.rowVersion ?? profilesData.stateVersion;
    const body = {
      ...createV5WritePayload(workspaceSetting.currentRole, expectedVersion, editingProfile ? "更新文章表达预设草稿" : "创建文章表达预设草稿"),
      name: values.name,
      applicableArticleTypes: editingProfile?.applicableArticleTypes || [],
      applicableChannels: editingProfile?.applicableChannels || [],
      version: {
        targetAudience: values.targetAudience?.trim() || undefined,
        writingFocus: values.writingFocus?.trim() || undefined,
        structureModules: modules.filter((item) => item.label.trim() && item.guidance.trim()),
        forbiddenStyles: typeof values.forbiddenStyles === "string"
          ? values.forbiddenStyles.split(/[\n,，]/).map((item: string) => item.trim()).filter(Boolean)
          : [],
        minLength: values.minLength,
        maxLength: values.maxLength,
        cta: values.cta?.trim() || undefined,
        otherInstructions: values.otherInstructions?.trim() || undefined
      }
    };
    try {
      await callJsonApi(editingProfile ? `/api/v5/article-expression-profiles/${editingProfile.profileId}` : "/api/v5/article-expression-profiles", {
        method: editingProfile ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      setEditorOpen(false);
      await refresh();
      messageApi.success("文章表达预设草稿已保存。未发布版本不会影响现有生产。 ");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "保存表达预设失败");
    } finally {
      setSaving(false);
    }
  }

  async function publishProfile(profile: V5ArticleExpressionProfileView) {
    setSaving(true);
    try {
      await callJsonApi(`/api/v5/article-expression-profiles/${profile.profileId}/publish`, {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, profile.rowVersion, "人工发布文章表达预设新版本"),
          profileVersionId: profile.currentVersion.profileVersionId
        })
      });
      await refresh();
      messageApi.success("表达预设新版本已发布。 ");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "发布表达预设失败");
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => ({
    models: configurationItems.filter((item) => item.category === "model"),
    publish: configurationItems.filter((item) => item.category === "publish_connection"),
    observation: configurationItems.filter((item) => item.category === "observation_connection")
  }), [configurationItems]);

  function statusTable(items: V5ConfigurationStatusItem[], emptyTitle: string) {
    return (
      <Card className="foundation-panel" bordered={false}>
        <Table
          rowKey="key"
          loading={loading}
          dataSource={items}
          pagination={false}
          locale={{ emptyText: <ActionEmpty title={emptyTitle} description="当前没有可展示的配置项。" /> }}
          columns={[
            { title: "用途", dataIndex: "purpose", render: (value, record) => <div className="foundation-question-cell"><strong>{record.label}</strong><span>{value}</span></div> },
            { title: "状态", dataIndex: "status", width: 130, render: (value) => <Tag color={value === "ready" ? "green" : value === "failed" ? "red" : "gold"}>{value === "ready" ? "已配置" : value === "failed" ? "验证失败" : "缺配置"}</Tag> },
            { title: "下一步", dataIndex: "nextAction", width: 230 },
            { title: "操作", width: 100, render: () => <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>检查</Button> }
          ]}
        />
      </Card>
    );
  }

  const profilesTab = (
    <Card className="foundation-panel" bordered={false}>
      <div className="foundation-card-heading">
        <div><Typography.Title level={4}>文章表达预设</Typography.Title><Typography.Text type="secondary">只填写需要人工控制的部分；留空项由系统规则处理，避免固定模板限制文章表达。</Typography.Text></div>
        <Button type="primary" icon={<PlusOutlined />} data-testid="expression-profile-create" onClick={() => openEditor()}>新建预设</Button>
      </div>
      <ListProfiles profiles={profilesData?.profiles || []} loading={loading} saving={saving} onEdit={openEditor} onPublish={publishProfile} />
    </Card>
  );

  const auditTab = (
    <Card className="foundation-panel" bordered={false}>
      <Alert showIcon type="info" message="版本和调用信息保持业务可读" description="这里只显示预设版本、状态和配置检查结果；密钥、完整 Prompt、原始模型 trace 与凭证不会回显。" />
      <Table
        rowKey="profileId"
        dataSource={profilesData?.profiles || []}
        pagination={false}
        columns={[
          { title: "对象", dataIndex: "name" },
          { title: "当前版本", render: (_, record) => `v${record.currentVersion.versionNumber}` },
          { title: "状态", render: (_, record) => <Tag color={record.currentVersion.status === "active" ? "green" : "gold"}>{record.currentVersion.status === "active" ? "已发布" : "草稿"}</Tag> },
          { title: "更新人", render: (_, record) => record.currentVersion.createdBy },
          { title: "更新时间", render: (_, record) => new Date(record.currentVersion.createdAt).toLocaleString("zh-CN", { hour12: false }) }
        ]}
      />
    </Card>
  );

  return (
    <>
      {contextHolder}
      <PageHeader
        title="配置管理"
        subtitle="统一管理模型、文章表达预设、发布连接和前台测试连接。"
        titleExtra={<Tag color="blue" icon={<SettingOutlined />}>凭证不回显</Tag>}
        actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>检查全部配置</Button>}
      />
      <PageErrorState message={error} loading={loading && !profilesData} onRetry={refresh} />
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "models", label: "模型服务", icon: <SettingOutlined />, children: statusTable(grouped.models, "暂无模型服务") },
          { key: "expression_profiles", label: "文章表达预设", children: profilesTab },
          { key: "publish_connections", label: "发布连接", icon: <CloudSyncOutlined />, children: statusTable(grouped.publish, "暂无发布连接") },
          { key: "observation_connections", label: "前台测试连接", children: <><Alert showIcon type="warning" message="本分支只聚合连接状态，不运行 AI 前台采集" style={{ marginBottom: 12 }} />{statusTable(grouped.observation, "暂无前台测试连接")}</> },
          { key: "audit", label: "版本与调用日志", children: auditTab }
        ]}
      />

      <Modal
        title={editingProfile ? `编辑文章表达预设：${editingProfile.name}` : "新建文章表达预设"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={saveProfile}
        okText="保存草稿"
        confirmLoading={saving}
        width={860}
      >
        <Form form={form} layout="vertical" data-testid="expression-profile-form">
          <Form.Item name="name" label="预设名称" rules={[{ required: true, message: "请填写预设名称" }]}><Input placeholder="用于识别这套预设" /></Form.Item>
          <Form.Item name="targetAudience" label="目标读者（选填）" extra="留空时由系统根据任务与渠道判断。"><Input placeholder="例如：首次接触该产品的业务负责人" /></Form.Item>
          <Form.Item name="writingFocus" label="写作重心（选填）" extra="描述这篇文章最需要讲清楚的内容，不限定固定写作目标。"><Input.TextArea rows={2} maxLength={500} showCount /></Form.Item>
          <div className="foundation-modules-heading"><div><Typography.Text strong>结构（选填）</Typography.Text><br /><Typography.Text type="secondary">不添加模块时，系统按文章任务组织结构。</Typography.Text></div><Button size="small" icon={<PlusOutlined />} onClick={addModule}>添加模块</Button></div>
          <div className="foundation-module-list">
            {!modules.length ? <div className="foundation-optional-empty">未指定结构，将遵循系统规则</div> : null}
            {modules.map((module, index) => (
              <div className="foundation-module-row" key={module.moduleId}>
                <div className="foundation-module-order">{index + 1}</div>
                <Input placeholder="模块名称" value={module.label} onChange={(event) => setModules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} aria-label={`结构模块 ${index + 1} 名称`} />
                <Input placeholder="该部分需要讲清什么" value={module.guidance} onChange={(event) => setModules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, guidance: event.target.value } : item))} aria-label={`结构模块 ${index + 1} 要求`} />
                <Button icon={<ArrowUpOutlined />} aria-label="上移模块" disabled={index === 0} onClick={() => moveModule(index, -1)} />
                <Button icon={<ArrowDownOutlined />} aria-label="下移模块" disabled={index === modules.length - 1} onClick={() => moveModule(index, 1)} />
                <Button danger icon={<DeleteOutlined />} aria-label="删除模块" onClick={() => removeModule(index)} />
              </div>
            ))}
          </div>
          <div className="foundation-field-heading"><Typography.Text strong>篇幅（选填）</Typography.Text><Typography.Text type="secondary">上下限都留空时由系统决定。</Typography.Text></div>
          <div className="foundation-form-grid">
            <Form.Item name="minLength" label="最少字数"><InputNumber min={300} max={10000} placeholder="系统决定" style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="maxLength" label="最多字数"><InputNumber min={300} max={10000} placeholder="系统决定" style={{ width: "100%" }} /></Form.Item>
          </div>
          <Form.Item name="cta" label="CTA（选填）" extra="留空时由系统根据文章目的判断是否需要 CTA。"><Input /></Form.Item>
          <Form.Item name="forbiddenStyles" label="禁止风格（选填）" extra="一行一项。系统安全规则始终生效，无需重复填写。"><Input.TextArea rows={3} maxLength={500} /></Form.Item>
          <Form.Item name="otherInstructions" label="其他（选填）" extra="仅填写以上字段无法表达的特殊要求；能力、合作、案例或量化承诺仍需证据支持。"><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
          <Alert showIcon type="info" message="未填写或无法映射的内容会遵循系统规则" description="系统规则、产品边界、渠道要求和 EvidencePack 共同组成最终指令，不会用固定选项补齐用户未选择的表达偏好。" />
        </Form>
      </Modal>
    </>
  );
}

function ListProfiles({ profiles, loading, saving, onEdit, onPublish }: {
  profiles: V5ArticleExpressionProfileView[];
  loading: boolean;
  saving: boolean;
  onEdit: (profile: V5ArticleExpressionProfileView) => void;
  onPublish: (profile: V5ArticleExpressionProfileView) => void;
}) {
  return (
    <Table
      rowKey="profileId"
      loading={loading}
      dataSource={profiles}
      locale={{ emptyText: <ActionEmpty title="还没有文章表达预设" description="新建表单化预设，不需要编写完整 Prompt。" /> }}
      scroll={{ x: 900 }}
      columns={[
        { title: "预设", width: 220, render: (_, record) => <Space><strong>{record.name}</strong><Tag>v{record.currentVersion.versionNumber}</Tag>{record.defaultProfile ? <Tag color="blue">默认</Tag> : null}</Space> },
        { title: "写作重心", width: 260, render: (_, record) => record.currentVersion.writingFocus || <Typography.Text type="secondary">遵循系统规则</Typography.Text> },
        { title: "结构", render: (_, record) => record.currentVersion.structureModules.map((item) => item.label).join(" > ") || <Typography.Text type="secondary">遵循系统规则</Typography.Text> },
        { title: "状态", width: 110, render: (_, record) => <Tag color={record.currentVersion.status === "active" ? "green" : "gold"}>{record.currentVersion.status === "active" ? "已发布" : "草稿"}</Tag> },
        {
          title: "操作",
          width: 180,
          fixed: "right" as const,
          render: (_, record) => <Space><Button size="small" onClick={() => onEdit(record)}>编辑</Button>{record.currentVersion.status === "draft" ? <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={saving} onClick={() => onPublish(record)}>发布新版本</Button> : null}</Space>
        }
      ]}
    />
  );
}
