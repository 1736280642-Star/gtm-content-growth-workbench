"use client";

import { CopyOutlined, EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined, StopOutlined, ExperimentOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, Modal, Select, Space, Spin, Table, Tag, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArticleTypeProfileEditor } from "@/components/ArticleTypeProfileEditor";
import { PageHeader } from "@/components/PageHeader";
import type { ArticleTypeProfileSummary } from "@/lib/v5/article-type-contracts";

function makeKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `article-type-${Date.now()}`;
}
export default function ArticleTypeLibraryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [profiles, setProfiles] = useState<ArticleTypeProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<{ profile?: ArticleTypeProfileSummary; copyMode?: boolean }>();
  const [preview, setPreview] = useState<ArticleTypeProfileSummary>();
  const [testProfile, setTestProfile] = useState<ArticleTypeProfileSummary>();
  const [exampleQuestion, setExampleQuestion] = useState("");

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v5/article-type-profiles", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: ArticleTypeProfileSummary[]; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "内容类型库读取失败。" );
      setProfiles(body.data || []);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "内容类型库读取失败。" );
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const filtered = useMemo(() => profiles.filter((profile) => {
    const version = profile.activeVersion || profile.currentVersion;
    const matchesStatus = status === "all" || profile.status === status;
    const matchesSearch = !search.trim() || `${version.name} ${version.semanticDescription} ${version.suitableQuestionDescription}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return matchesStatus && matchesSearch;
  }), [profiles, search, status]);

  async function disableProfile(profile: ArticleTypeProfileSummary) {
    try {
      const response = await fetch(`/api/v5/article-type-profiles/${encodeURIComponent(profile.profileId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-idempotency-key": makeKey() },
        body: JSON.stringify({ expectedVersion: profile.revision, action: "disable", auditReason: "停用不再用于后续月度策略的内容类型", input: profile.currentVersion })
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "内容类型停用失败。" );
      messageApi.success("内容类型已停用；历史策略仍保留原版本。" );
      await loadProfiles();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "内容类型停用失败。" );
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="内容类型库"
        subtitle="用自然语言定义类型用途和表达设置；发布后的版本可被月度策略冻结引用。"
        actions={<Space wrap><Link href="/monthly-matrix/strategy"><Button>返回月度策略</Button></Link><Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({})}>新建内容类型</Button></Space>}
      />
      <Alert className="article-type-library-note" showIcon type="info" message="系统起始模板不是固定枚举" description="可以复制模板并创建避坑指南、采购评估清单等工作区类型。类型更新不会改变已批准月度策略中的冻结版本。" />
      <div className="article-type-toolbar">
        <Input allowClear prefix={<SearchOutlined />} placeholder="搜索类型名称或适配问题" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "已启用" }, { value: "draft", label: "草稿" }, { value: "disabled", label: "已停用" }]} />
      </div>
      {loading ? <div className="v5-loading-row"><Spin /><span>正在读取内容类型</span></div> : (
        <Table<ArticleTypeProfileSummary>
          className="article-type-table"
          rowKey="profileId"
          dataSource={filtered}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的内容类型" /> }}
          pagination={{ pageSize: 12 }}
          columns={[
            { title: "类型名称", key: "name", render: (_, record) => <div className="v5-table-stack"><strong>{(record.activeVersion || record.currentVersion).name}</strong><span>{record.origin === "system_template" ? "系统起始模板" : "工作区自定义"}</span></div> },
            { title: "适配问题摘要", key: "suitable", render: (_, record) => <span className="article-type-summary">{(record.activeVersion || record.currentVersion).suitableQuestionDescription || (record.activeVersion || record.currentVersion).semanticDescription}</span> },
            { title: "表达设置摘要", key: "expression", render: (_, record) => { const version = record.activeVersion || record.currentVersion; return <span className="article-type-summary">{version.structureModules.slice(0, 3).join(" -> ") || "待补充结构"} · {version.styleTraits.slice(0, 2).join("、") || "待补充风格"}</span>; } },
            { title: "当前版本", width: 100, key: "version", render: (_, record) => `v${(record.activeVersion || record.currentVersion).version}` },
            { title: "状态", width: 100, dataIndex: "status", render: (value: ArticleTypeProfileSummary["status"]) => <Tag color={value === "active" ? "green" : value === "disabled" ? "default" : "gold"}>{value === "active" ? "已启用" : value === "disabled" ? "已停用" : "草稿"}</Tag> },
            { title: "本月使用", width: 100, dataIndex: "monthlyUsageCount", render: (value: number) => `${value} 次` },
            { title: "更新时间", width: 170, dataIndex: "updatedAt", render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
            { title: "操作", width: 330, key: "actions", render: (_, record) => <Space wrap size={4}>
              <Button size="small" icon={<EyeOutlined />} onClick={() => setPreview(record)}>查看</Button>
              <Button size="small" icon={<EditOutlined />} disabled={record.status === "disabled"} onClick={() => setEditor({ profile: record })}>编辑新版本</Button>
              <Button size="small" icon={<CopyOutlined />} onClick={() => setEditor({ profile: record, copyMode: true })}>复制</Button>
              <Button size="small" icon={<ExperimentOutlined />} onClick={() => { setTestProfile(record); setExampleQuestion(""); }}>示例问题测试</Button>
              <Button size="small" danger icon={<StopOutlined />} disabled={record.status === "disabled"} onClick={() => Modal.confirm({ title: `停用「${record.currentVersion.name}」？`, content: "仅影响后续策略选择，已批准策略继续使用冻结版本。", okText: "停用", okButtonProps: { danger: true }, onOk: () => disableProfile(record) })}>停用</Button>
            </Space> }
          ]}
        />
      )}
      <ArticleTypeProfileEditor open={Boolean(editor)} profile={editor?.profile} copyMode={editor?.copyMode} onClose={() => setEditor(undefined)} onSaved={() => void loadProfiles()} />
      <Modal open={Boolean(preview)} title={preview ? `${preview.currentVersion.name} v${preview.currentVersion.version}` : "内容类型"} footer={<Button onClick={() => setPreview(undefined)}>关闭</Button>} onCancel={() => setPreview(undefined)}>
        {preview ? <div className="article-type-preview"><dl><dt>适配问题</dt><dd>{preview.currentVersion.suitableQuestionDescription || "待补充"}</dd><dt>不适配问题</dt><dd>{preview.currentVersion.unsuitableQuestionDescription || "待补充"}</dd><dt>内容结构</dt><dd>{preview.currentVersion.structureModules.join(" -> ") || "待补充"}</dd><dt>CTA</dt><dd>{preview.currentVersion.cta || "待补充"}</dd><dt>篇幅与风格</dt><dd>{preview.currentVersion.lengthRange.min}-{preview.currentVersion.lengthRange.max} 字 · {preview.currentVersion.styleTraits.join("、") || "待补充"}</dd><dt>Prompt 快照</dt><dd><code>{preview.currentVersion.promptConstraintSnapshotHash.slice(0, 16)}</code></dd></dl></div> : null}
      </Modal>
      <Modal open={Boolean(testProfile)} title="用示例问题测试" okText="转到月度策略匹配" onOk={() => { window.location.href = "/monthly-matrix/strategy"; }} onCancel={() => setTestProfile(undefined)}>
        <Input.TextArea rows={4} placeholder="输入一个真实目标问题" value={exampleQuestion} onChange={(event) => setExampleQuestion(event.target.value)} />
        <Alert className="article-type-test-note" showIcon type="info" message="测试不保存结果" description={`正式语义匹配会在月度策略中同时比较全部已启用类型，并返回推荐理由。当前类型：${testProfile?.currentVersion.name || "-"}。`} />
      </Modal>
    </>
  );
}
