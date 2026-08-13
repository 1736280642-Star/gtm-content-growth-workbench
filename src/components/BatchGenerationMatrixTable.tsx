"use client";

import { EditOutlined, EyeOutlined, FileAddOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Input, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import type { ProductionDraftSummary, ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { WechatPresentationPanel } from "@/components/WechatPresentationPanel";
import { WechatTemplateSelectionPanel } from "@/components/WechatTemplateSelectionPanel";
import { resolveWechatPlatformKey } from "@/lib/v5/wechat-presentation-contracts";
import { SampleArticleReviewPanel } from "@/components/SampleArticleReviewPanel";

const statusMeta: Record<ProductionMatrixTask["status"], { label: string; color: string }> = {
  ready_for_generation: { label: "待生成", color: "blue" },
  generating: { label: "生成中", color: "processing" },
  available: { label: "可用 · 系统已检查", color: "green" },
  awaiting_material: { label: "待补资料", color: "gold" },
  system_recovering: { label: "系统恢复中", color: "cyan" },
  scheduled: { label: "已排程", color: "purple" }
, published: { label: "已发布", color: "green" }
};

export function BatchGenerationMatrixTable({
  items,
  initialDraft,
  onSaveDraft,
  onGenerate
}: {
  items: ProductionMatrixTask[];
  initialDraft?: ProductionDraftSummary;
  onSaveDraft?: (task: ProductionMatrixTask, markdown: string) => Promise<void>;
  onGenerate?: (task: ProductionMatrixTask) => Promise<void>;
}) {
  const [selectedTask, setSelectedTask] = useState<ProductionMatrixTask>();
  const [loadedDraft, setLoadedDraft] = useState<ProductionDraftSummary>();
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const grouped = useMemo(() => {
    const groups = new Map<string, ProductionMatrixTask[]>();
    items.forEach((item) => {
      const key = `${item.question}::${item.contentType}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return Array.from(groups.entries());
  }, [items]);

  useEffect(() => {
    if (!initialDraft) return;
    const task = items.find((item) => item.currentDraft?.draftId === initialDraft.draftId || item.lastUsableDraft?.draftId === initialDraft.draftId) || {
      taskId: `preview-${initialDraft.draftId}`,
      monthlyPlanId: "preview",
      strategyPackageId: "preview",
      quotaRuleId: "preview",
      questionVersionId: "preview",
      question: "正文预览",
      baseTopicIndex: 1,
      title: initialDraft.title,
      contentType: "",
      articleTypeProfileVersionId: "",
      articleTypeNameSnapshot: "",
      typeMatchRunId: "",
      typeSelectionSource: "user_selected" as const,
      matchReasonSnapshot: "",
      articleTypePromptConstraintSnapshot: "",
      articleTypePromptConstraintSnapshotHash: "",
      channel: initialDraft.platformKey === "weixin" ? "wechat" : "",
      rulePackageVersionId: "",
      knowledgeBaseIds: [],
      sourceSnapshotHash: "",
      evidencePackSourceSnapshotHash: "",
      status: "available" as const,
      recoveryAttemptCount: 0,
      automaticRepairCount: 0,
      lastUsableDraft: initialDraft,
      currentDraft: initialDraft,
      updatedAt: initialDraft.updatedAt
    };
    setSelectedTask(task);
    setLoadedDraft(initialDraft);
    setMarkdown(initialDraft.markdown);
  }, [initialDraft, items]);

  async function openPreview(task: ProductionMatrixTask) {
    setSelectedTask(task);
    setLoadedDraft(undefined);
    setMarkdown("");
    setDraftError(undefined);
    setEditing(false);
    const summary = task.currentDraft || task.lastUsableDraft;
    if (!summary) return;
    if (summary.bodyIncluded !== false && summary.markdown) {
      setLoadedDraft(summary);
      setMarkdown(summary.markdown);
      return;
    }
    setDraftLoading(true);
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(summary.draftId)}`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: ProductionDraftSummary; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "正文详情读取失败。");
      setLoadedDraft({ ...body.data, bodyIncluded: true });
      setMarkdown(body.data.markdown || "");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "正文详情读取失败。");
    } finally {
      setDraftLoading(false);
    }
  }

  const selectedDraft = loadedDraft || selectedTask?.currentDraft || selectedTask?.lastUsableDraft;
  const isWechatDraft = Boolean(selectedTask && (resolveWechatPlatformKey(selectedTask.channel) === "weixin" || selectedDraft?.platformKey === "weixin"));

  const draftTab = selectedTask ? (
    <div className="v5-draft-preview">
      {draftLoading ? <div className="v5-loading-row"><Spin /><span>正在按需读取正文</span></div> : null}
      {draftError ? <Alert type="error" showIcon message="正文详情读取失败" description={draftError} /> : null}
      {editing ? <Input.TextArea aria-label="编辑正文" autoSize={{ minRows: 18 }} value={markdown} onChange={(event) => setMarkdown(event.target.value)} /> : <MarkdownArticle markdown={markdown || ""} />}
      <section aria-labelledby="content-basis-heading">
        <Typography.Title level={5} id="content-basis-heading">内容依据</Typography.Title>
        <ul>{selectedDraft?.basisSummary.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <Space wrap>
        {editing ? <Button type="primary" onClick={async () => { await onSaveDraft?.(selectedTask, markdown); setEditing(false); }}>保存并自动复检</Button> : <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>编辑正文</Button>}
        {editing ? <Button onClick={() => { setEditing(false); setMarkdown(selectedDraft?.markdown || ""); }}>取消</Button> : null}
      </Space>
      {selectedDraft?.draftId ? <SampleArticleReviewPanel draftVersionId={selectedDraft.draftId} /> : null}
    </div>
  ) : null;

  return (
    <>
      <div className="v5-production-groups">
        {grouped.map(([key, tasks]) => {
          const [question, contentType] = key.split("::");
          return (
            <section className="v5-production-group" key={key}>
              <div className="v5-production-group-heading"><div><strong>{question}</strong><span>{contentType}</span></div><Tag>{tasks.length} 篇渠道成品</Tag></div>
              <Table<ProductionMatrixTask>
                rowKey="taskId"
                size="small"
                pagination={tasks.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                tableLayout="fixed"
                dataSource={tasks}
                columns={[
                  { title: "渠道", dataIndex: "channel", width: 90, render: (value: string) => <Tag>{value}</Tag> },
                  { title: "内容", dataIndex: "title", render: (value: string) => <strong>{value}</strong> },
                  { title: "状态", dataIndex: "status", width: 160, render: (value: ProductionMatrixTask["status"]) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag> },
                  {
                    title: "操作", key: "action", width: 140,
                    render: (_: unknown, task) => {
                      if (task.formalDraftId) return <Link href={`/monthly-plan?step=production&draftId=${encodeURIComponent(task.formalDraftId)}`}><Button size="small" icon={<EyeOutlined />}>预览正文</Button></Link>;
                      if (task.currentDraft || task.lastUsableDraft) return <Button size="small" icon={<EyeOutlined />} onClick={() => openPreview(task)}>预览正文</Button>;
                      if (task.status === "awaiting_material") return <Link href={`/knowledge?todo=${encodeURIComponent(task.knowledgeTodoId || task.taskId)}`}><Button size="small" icon={<FileAddOutlined />}>补充资料</Button></Link>;
                      if (task.formal && ["ready_for_generation", "system_recovering"].includes(task.status)) return <Button size="small" type="primary" disabled={!onGenerate} onClick={() => void onGenerate?.(task)}>立即生成</Button>;
                      return <Typography.Text type="secondary">系统自动处理</Typography.Text>;
                    }
                  }
                ]}
              />
            </section>
          );
        })}
        {!items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="已批准策略还没有可执行内容任务" /> : null}
      </div>

      <Drawer
        className="v5-draft-preview-drawer"
        width={isWechatDraft ? 1040 : 720}
        open={Boolean(selectedTask)}
        title={selectedTask ? `正文预览：${selectedTask.title}` : "正文预览"}
        onClose={() => { setSelectedTask(undefined); setLoadedDraft(undefined); setDraftError(undefined); }}
        extra={selectedTask ? <Tag color="green">{statusMeta[selectedTask.status].label}</Tag> : null}
      >
        {selectedTask ? (
          isWechatDraft && selectedDraft?.draftId ? (
            <Tabs
              className="v5-wechat-production-tabs"
              destroyInactiveTabPane
              items={[
                { key: "draft", label: "正文草稿", children: draftTab },
                { key: "template", label: "排版模板", children: <WechatTemplateSelectionPanel draftVersionId={selectedDraft.draftId} /> },
                { key: "preview", label: "图文预览", children: <WechatPresentationPanel draftVersionId={selectedDraft.draftId} /> }
              ]}
            />
          ) : draftTab
        ) : null}
      </Drawer>
    </>
  );
}
