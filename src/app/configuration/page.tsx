"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
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
  Radio,
  Select,
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

const defaultModules: V5ArticleExpressionStructureModule[] = [
  { moduleId: "background", label: "问题背景", guidance: "说明读者正在面对的真实问题", required: true },
  { moduleId: "criteria", label: "选择标准", guidance: "给出可验证的判断维度", required: true },
  { moduleId: "solution", label: "方案说明", guidance: "只表达证据支持的能力", required: true },
  { moduleId: "risk", label: "风险与限制", guidance: "说明边界和前置条件", required: true },
  { moduleId: "cta", label: "行动建议", guidance: "给出清晰下一步", required: true }
];

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
  const [modules, setModules] = useState<V5ArticleExpressionStructureModule[]>(defaultModules);
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
    setModules(version?.structureModules || defaultModules);
    form.setFieldsValue(profile ? {
      name: profile.name,
      applicableArticleTypes: profile.applicableArticleTypes,
      applicableChannels: profile.applicableChannels,
      targetAudience: version!.targetAudience,
      writingGoal: version!.writingGoal,
      readerAwareness: version!.readerAwareness,
      tones: version!.tones,
      requiredTopics: version!.requiredTopics,
      minLength: version!.minLength,
      maxLength: version!.maxLength,
      cta: version!.cta,
      notes: version!.notes
    } : {
      writingGoal: "selection",
      readerAwareness: "initial",
      tones: ["专业", "克制"],
      requiredTopics: ["前置条件", "验收方式"],
      minLength: 1800,
      maxLength: 2500
    });
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
      label: "自定义模块",
      guidance: "说明该模块需要覆盖什么",
      required: false
    }]);
  }

  async function saveProfile() {
    const values = await form.validateFields();
    if (!profilesData) return;
    setSaving(true);
    const expectedVersion = editingProfile?.rowVersion ?? profilesData.stateVersion;
    const body = {
      ...createV5WritePayload(workspaceSetting.currentRole, expectedVersion, editingProfile ? "更新文章表达预设草稿" : "创建文章表达预设草稿"),
      name: values.name,
      applicableArticleTypes: values.applicableArticleTypes || [],
      applicableChannels: values.applicableChannels || [],
      version: {
        targetAudience: values.targetAudience,
        writingGoal: values.writingGoal,
        readerAwareness: values.readerAwareness,
        tones: values.tones || [],
        structureModules: modules,
        requiredTopics: values.requiredTopics || [],
        forbiddenStyles: ["绝对排名", "泛化承诺", "无证据数据"],
        minLength: values.minLength,
        maxLength: values.maxLength,
        cta: values.cta,
        notes: values.notes || ""
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
        <div><Typography.Title level={4}>文章表达预设</Typography.Title><Typography.Text type="secondary">表单与结构模块会在生成时编译为指令，用户无需编写完整 Prompt。</Typography.Text></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新建预设</Button>
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
        <Form form={form} layout="vertical">
          <div className="foundation-form-grid">
            <Form.Item name="name" label="预设名称" rules={[{ required: true, message: "请填写预设名称" }]}><Input /></Form.Item>
            <Form.Item name="targetAudience" label="目标读者" rules={[{ required: true, message: "请填写目标读者" }]}><Input /></Form.Item>
            <Form.Item name="applicableArticleTypes" label="适用文章类型"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
            <Form.Item name="applicableChannels" label="适用渠道"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
          </div>
          <Form.Item name="writingGoal" label="写作目标"><Radio.Group options={[{ value: "selection", label: "帮助选型" }, { value: "explain", label: "解释能力" }, { value: "implementation", label: "指导实施" }]} /></Form.Item>
          <Form.Item name="readerAwareness" label="读者认知"><Radio.Group options={[{ value: "initial", label: "初步了解" }, { value: "comparing", label: "正在比较" }, { value: "implementing", label: "准备实施" }]} /></Form.Item>
          <Form.Item name="tones" label="语气"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
          <div className="foundation-modules-heading"><Typography.Text strong>结构模块</Typography.Text><Button size="small" icon={<PlusOutlined />} onClick={addModule}>添加模块</Button></div>
          <div className="foundation-module-list">
            {modules.map((module, index) => (
              <div className="foundation-module-row" key={module.moduleId}>
                <div className="foundation-module-order">{index + 1}</div>
                <Input value={module.label} onChange={(event) => setModules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} aria-label={`结构模块 ${index + 1} 名称`} />
                <Input value={module.guidance} onChange={(event) => setModules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, guidance: event.target.value } : item))} aria-label={`结构模块 ${index + 1} 要求`} />
                <Button icon={<ArrowUpOutlined />} aria-label="上移模块" disabled={index === 0} onClick={() => moveModule(index, -1)} />
                <Button icon={<ArrowDownOutlined />} aria-label="下移模块" disabled={index === modules.length - 1} onClick={() => moveModule(index, 1)} />
              </div>
            ))}
          </div>
          <Form.Item name="requiredTopics" label="必须展开"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
          <Form.Item label="禁止风格"><Space wrap>{["绝对排名", "泛化承诺", "无证据数据"].map((item) => <Tag key={item} color="red">{item} · 强制</Tag>)}</Space></Form.Item>
          <Space wrap align="start">
            <Form.Item name="minLength" label="最少字数" rules={[{ required: true }]}><InputNumber min={300} max={10000} /></Form.Item>
            <Form.Item name="maxLength" label="最多字数" rules={[{ required: true }]}><InputNumber min={300} max={10000} /></Form.Item>
          </Space>
          <Form.Item name="cta" label="CTA" rules={[{ required: true, message: "请填写清晰的下一步动作" }]}><Input /></Form.Item>
          <Form.Item name="notes" label="补充说明" extra="最多 200 字；能力、合作、案例或量化承诺需要证据支持。"><Input.TextArea rows={3} maxLength={200} showCount /></Form.Item>
          <Alert showIcon type="info" message="系统会将表单、规则包、渠道配置和 EvidencePack 编译为最终指令。" />
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
        { title: "适用", width: 250, render: (_, record) => `${record.applicableArticleTypes.join(" / ") || "未限定"} · ${record.applicableChannels.join("、") || "全渠道"}` },
        { title: "结构", render: (_, record) => record.currentVersion.structureModules.map((item) => item.label).join(" > ") },
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
