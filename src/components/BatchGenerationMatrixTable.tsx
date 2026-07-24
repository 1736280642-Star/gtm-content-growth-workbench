"use client";

import { EditOutlined, EyeOutlined, FileAddOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Input, Space, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProductionDraftSummary, ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { WechatPresentationPanel } from "@/components/WechatPresentationPanel";

const statusMeta: Record<ProductionMatrixTask["status"], { label: string; color: string }> = {
  ready_for_generation: { label: "待生成", color: "blue" },
  generating: { label: "生成中", color: "processing" },
  available: { label: "可用 · 系统已检查", color: "green" },
  awaiting_material: { label: "待补资料", color: "gold" },
  system_recovering: { label: "系统恢复中", color: "cyan" },
  scheduled: { label: "已排程", color: "purple" }
};

export function BatchGenerationMatrixTable({
  items,
  initialDraft,
  onGenerate,
  onSaveDraft
}: {
  items: ProductionMatrixTask[];
  initialDraft?: ProductionDraftSummary;
  onGenerate?: (task: ProductionMatrixTask) => void;
  onSaveDraft?: (task: ProductionMatrixTask, markdown: string) => Promise<void>;
}) {
  const [selectedTask, setSelectedTask] = useState<ProductionMatrixTask>();
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
      channel: "",
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
    setMarkdown(initialDraft.markdown);
  }, [initialDraft, items]);

  function openPreview(task: ProductionMatrixTask) {
    setSelectedTask(task);
    setMarkdown((task.currentDraft || task.lastUsableDraft)?.markdown || "");
    setEditing(false);
  }

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
                pagination={false}
                tableLayout="fixed"
                dataSource={tasks}
                columns={[
                  { title: "渠道", dataIndex: "channel", width: 90, render: (value: string) => <Tag>{value}</Tag> },
                  { title: "内容", dataIndex: "title", render: (value: string) => <strong>{value}</strong> },
                  { title: "状态", dataIndex: "status", width: 160, render: (value: ProductionMatrixTask["status"]) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag> },
                  {
                    title: "操作", key: "action", width: 140,
                    render: (_: unknown, task) => {
                      if (task.currentDraft || task.lastUsableDraft) return <Button size="small" icon={<EyeOutlined />} onClick={() => openPreview(task)}>预览正文</Button>;
                      if (task.status === "awaiting_material") return <Link href={`/knowledge?todo=${encodeURIComponent(task.knowledgeTodoId || task.taskId)}`}><Button size="small" icon={<FileAddOutlined />}>补充资料</Button></Link>;
                      return <Button size="small" type="primary" disabled={!onGenerate || task.status !== "ready_for_generation"} onClick={() => onGenerate?.(task)}>生成</Button>;
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
        width={720}
        open={Boolean(selectedTask)}
        title={selectedTask ? `正文预览：${selectedTask.title}` : "正文预览"}
        onClose={() => setSelectedTask(undefined)}
        extra={selectedTask ? <Tag color="green">{statusMeta[selectedTask.status].label}</Tag> : null}
      >
        {selectedTask ? (
          <div className="v5-draft-preview">
            {editing ? <Input.TextArea aria-label="编辑正文" autoSize={{ minRows: 18 }} value={markdown} onChange={(event) => setMarkdown(event.target.value)} /> : <pre>{markdown}</pre>}
            <section aria-labelledby="content-basis-heading">
              <Typography.Title level={5} id="content-basis-heading">内容依据</Typography.Title>
              <ul>{(selectedTask.currentDraft || selectedTask.lastUsableDraft)?.basisSummary.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            {(selectedTask.currentDraft || selectedTask.lastUsableDraft)?.draftId ? (
              <WechatPresentationPanel draftVersionId={(selectedTask.currentDraft || selectedTask.lastUsableDraft)!.draftId} />
            ) : null}
            <Space wrap>
              {editing ? <Button type="primary" onClick={async () => { await onSaveDraft?.(selectedTask, markdown); setEditing(false); }}>保存并自动复检</Button> : <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>编辑正文</Button>}
              {editing ? <Button onClick={() => { setEditing(false); setMarkdown((selectedTask.currentDraft || selectedTask.lastUsableDraft)?.markdown || ""); }}>取消</Button> : null}
            </Space>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
