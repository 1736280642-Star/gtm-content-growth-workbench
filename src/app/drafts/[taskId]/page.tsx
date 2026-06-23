"use client";

import { Alert, Button, Card, Col, Descriptions, Input, Popconfirm, Row, Space, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { PublishRecord } from "@/lib/types";
import { useEffect, useState } from "react";

const draftStatusLabels = {
  draft: "草稿",
  final: "终稿",
  discarded: "已废弃"
} as const;

const generationModeLabels = {
  local_rule: "本地规则引擎",
  ai_provider: "AI Provider"
} as const;

const generationStatusLabels = {
  success: "成功",
  pending_config: "待配置",
  failed: "失败"
} as const;

type DraftReviewNextStep = "configure_generation" | "regenerate_draft" | "fix_qa" | "join_publish_queue" | "publish" | "fill_url" | "record_metrics" | "fix_publish" | "retrospect";
type DraftPublishHandoff = "none" | "queued" | "published" | "url_filled" | "measured" | "failed";

const draftReviewNextStepLabels: Record<DraftReviewNextStep, string> = {
  configure_generation: "检查配置",
  regenerate_draft: "重新生成",
  fix_qa: "处理阻断",
  join_publish_queue: "加入发布队列",
  publish: "人工发布",
  fill_url: "回填 URL",
  record_metrics: "录入指标",
  fix_publish: "排查发布",
  retrospect: "进入复盘"
};

const draftReviewNextStepColors: Record<DraftReviewNextStep, string> = {
  configure_generation: "gold",
  regenerate_draft: "blue",
  fix_qa: "red",
  join_publish_queue: "purple",
  publish: "gold",
  fill_url: "blue",
  record_metrics: "purple",
  fix_publish: "red",
  retrospect: "green"
};

const draftPublishHandoffLabels: Record<DraftPublishHandoff, string> = {
  none: "未入队",
  queued: "待发布",
  published: "待回填 URL",
  url_filled: "待录指标",
  measured: "可复盘",
  failed: "发布失败"
};

const draftPublishHandoffColors: Record<DraftPublishHandoff, string> = {
  none: "default",
  queued: "gold",
  published: "blue",
  url_filled: "purple",
  measured: "green",
  failed: "red"
};

function getDraftPublishHandoff(record?: PublishRecord): DraftPublishHandoff {
  if (!record) {
    return "none";
  }

  if (record.publishStatus === "failed") {
    return "failed";
  }

  if (record.channelMetrics) {
    return "measured";
  }

  if (record.publishStatus === "url_filled") {
    return "url_filled";
  }

  if (record.publishStatus === "published") {
    return "published";
  }

  return "queued";
}

function getDraftReviewNextStep(
  generationStatus: keyof typeof generationStatusLabels,
  qaPassed: boolean,
  publishRecord?: PublishRecord
): DraftReviewNextStep {
  const publishHandoff = getDraftPublishHandoff(publishRecord);

  if (publishHandoff === "failed") {
    return "fix_publish";
  }

  if (publishHandoff === "queued") {
    return "publish";
  }

  if (publishHandoff === "published") {
    return "fill_url";
  }

  if (publishHandoff === "url_filled") {
    return "record_metrics";
  }

  if (publishHandoff === "measured") {
    return "retrospect";
  }

  if (generationStatus === "pending_config") {
    return "configure_generation";
  }

  if (generationStatus === "failed") {
    return "regenerate_draft";
  }

  if (!qaPassed) {
    return "fix_qa";
  }

  return "join_publish_queue";
}

function getDraftReviewActionText(nextStep: DraftReviewNextStep, hasWarnings: boolean) {
  if (nextStep === "configure_generation") {
    return "生成能力待配置，先去 AI 配置页确认 Provider，再决定是否重新生成。";
  }

  if (nextStep === "regenerate_draft") {
    return "上次生成失败或当前内容需要刷新，建议重新生成并重新质检。";
  }

  if (nextStep === "fix_qa") {
    return "先处理阻断项，再保存草稿或重新生成，质检通过后再加入发布队列。";
  }

  if (nextStep === "join_publish_queue") {
    return hasWarnings
      ? "阻断项已清除，但仍有警告项，人工复核后再加入发布队列。"
      : "当前稿件已具备入队条件，确认无误后可加入发布队列。";
  }

  if (nextStep === "publish") {
    return "终稿已经进入发布队列，下一步去发布页完成人工发布。";
  }

  if (nextStep === "fill_url") {
    return "内容已发布但还没回填链接，先补 URL，后续才能稳定复盘。";
  }

  if (nextStep === "record_metrics") {
    return "发布链路已完成，补录渠道表现数据后再进入周报复盘。";
  }

  if (nextStep === "fix_publish") {
    return "发布记录出现失败，先去发布队列排查，再决定是否回到终稿继续调整。";
  }

  return "终稿、发布和指标都已闭环，可以直接进入周度复盘。";
}

export default function DraftReviewPage({ params }: { params: { taskId: string } }) {
  const {
    state: { drafts, tasks, publishRecords },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const task = tasks.find((item) => item.id === params.taskId) || tasks[0];
  const draft = task ? drafts.find((item) => item.taskId === task.id) || drafts[0] : drafts[0];

  useEffect(() => {
    if (!draft) {
      return;
    }

    setTitle(draft.title);
    setSummary(draft.summary);
    setContent(draft.content);
  }, [draft]);

  async function handleSaveDraft() {
    setSaving(true);

    try {
      const result = await callJsonApi(`/api/article-drafts/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, summary, content })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "草稿已保存"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存草稿失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveDraft() {
    setApproving(true);

    try {
      const result = await callJsonApi(`/api/article-drafts/${draft.id}/approve`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "已加入发布队列"));
      router.push("/publish");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加入发布队列失败");
    } finally {
      setApproving(false);
    }
  }

  async function handleRegenerateDraft() {
    if (!task) {
      return;
    }

    setRegenerating(true);

    try {
      const result = await callJsonApi(`/api/content-tasks/${task.id}/generate`, { method: "POST" });
      const snapshot = await refresh();
      const nextDraft = snapshot?.state.drafts.find((item) => item.taskId === task.id);

      if (nextDraft) {
        setTitle(nextDraft.title);
        setSummary(nextDraft.summary);
        setContent(nextDraft.content);
      }

      messageApi.success(formatApiMessage(result, "稿件已重新生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  if (!task || !draft) {
    return (
      <>
        <PageHeader title="内容终稿确认" subtitle="当前任务还没有生成稿件。" />
        <PageErrorState message={error} loading={loading} onRetry={refresh} />
        <Card>
          <ActionEmpty
            title="当前任务还没有生成稿件"
            description="请先在今日任务页生成稿件，再进入终稿确认。"
            action={
              <Link href="/today">
                <Button type="primary">去今日任务</Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const hasBlockers = Boolean(draft.qaResult.blockers.length);
  const hasWarnings = Boolean(draft.qaResult.warnings.length);
  const canApproveDraft = Boolean(draft.qaResult.passed);
  const generationMode = draft.generationSource?.mode ?? "local_rule";
  const generationStatus = draft.generationSource?.status ?? "success";
  const publishRecord = publishRecords.find((item) => item.draftId === draft.id);
  const publishHandoff = getDraftPublishHandoff(publishRecord);
  const draftReviewNextStep = getDraftReviewNextStep(generationStatus, canApproveDraft, publishRecord);
  const draftReviewActionText = getDraftReviewActionText(draftReviewNextStep, hasWarnings);

  function renderDraftReviewEntry() {
    if (draftReviewNextStep === "configure_generation") {
      return (
        <Link href="/ai-config">
          <Button size="small">看 AI 配置</Button>
        </Link>
      );
    }

    if (draftReviewNextStep === "regenerate_draft") {
      return (
        <Popconfirm
          title="确认重新生成稿件？"
          description="当前编辑区内容会被新的生成结果覆盖。"
          okText="重新生成"
          cancelText="取消"
          onConfirm={handleRegenerateDraft}
        >
          <Button size="small" loading={regenerating}>
            重新生成
          </Button>
        </Popconfirm>
      );
    }

    if (draftReviewNextStep === "fix_qa") {
      return (
        <Button size="small" loading={saving} onClick={handleSaveDraft}>
          保存草稿
        </Button>
      );
    }

    if (draftReviewNextStep === "join_publish_queue") {
      return (
        <Popconfirm
          title="确认加入发布队列？"
          description="终稿确认后会创建或更新发布记录。"
          okText="入队"
          cancelText="取消"
          onConfirm={handleApproveDraft}
        >
          <Button size="small" type="primary" loading={approving} disabled={!draft.qaResult.passed}>
            加入发布队列
          </Button>
        </Popconfirm>
      );
    }

    if (draftReviewNextStep === "publish" || draftReviewNextStep === "fill_url" || draftReviewNextStep === "record_metrics" || draftReviewNextStep === "fix_publish") {
      return (
        <Link href="/publish">
          <Button size="small">{draftReviewNextStepLabels[draftReviewNextStep]}</Button>
        </Link>
      );
    }

    return (
      <Link href="/weekly-report">
        <Button size="small">去周报复盘</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader title="内容终稿确认" subtitle="左侧编辑正文，右侧确认任务上下文、稿件来源和入队风险。" />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Row gutter={16}>
        <Col span={15}>
          <Card title="正文编辑区">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Alert
                showIcon
                type={hasBlockers ? "error" : hasWarnings ? "warning" : "success"}
                message={canApproveDraft ? (hasWarnings ? "终稿可入队，但有警告项" : "终稿可入队") : "存在阻断项，暂不建议入队"}
                description={
                  canApproveDraft
                    ? "自动质检已通过，确认内容无误后可以加入发布队列。"
                    : "请先处理右侧阻断项，保存或重新生成稿件后再确认。"
                }
              />
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input value={summary} onChange={(event) => setSummary(event.target.value)} />
              <Input.TextArea rows={14} value={content} onChange={(event) => setContent(event.target.value)} />
              <Space>
                <Button loading={saving} onClick={handleSaveDraft}>
                  保存草稿
                </Button>
                <Popconfirm
                  title="确认重新生成稿件？"
                  description="当前编辑区内容会被新的生成结果覆盖。"
                  okText="重新生成"
                  cancelText="取消"
                  onConfirm={handleRegenerateDraft}
                >
                  <Button loading={regenerating}>
                    重新生成
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="确认加入发布队列？"
                  description="终稿确认后会创建或更新发布记录。"
                  okText="入队"
                  cancelText="取消"
                  onConfirm={handleApproveDraft}
                >
                  <Button type="primary" loading={approving} disabled={!draft.qaResult.passed}>
                    加入发布队列
                  </Button>
                </Popconfirm>
              </Space>
            </Space>
          </Card>
        </Col>
        <Col span={9}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card title="任务上下文">
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "publishDate", label: "发布日期", children: task.publishDate },
                  { key: "channel", label: "渠道", children: channelLabels[task.channel] },
                  { key: "product", label: "产品", children: productLabels[task.product] },
                  { key: "contentType", label: "内容类型", children: contentTypeLabels[task.contentType] },
                  { key: "status", label: "任务状态", children: statusLabels[task.status] },
                  {
                    key: "keywords",
                    label: "目标关键词",
                    children: task.targetKeywords.length ? (
                      <Space wrap>
                        {task.targetKeywords.map((keyword) => (
                          <Tag key={keyword}>{keyword}</Tag>
                        ))}
                      </Space>
                    ) : (
                      <span className="muted">未设置</span>
                    )
                  }
                ]}
              />
            </Card>
            <Card title="稿件来源">
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "draftStatus", label: "稿件状态", children: draftStatusLabels[draft.status] },
                  { key: "version", label: "版本", children: `v${draft.version}` },
                  { key: "generationMode", label: "生成模式", children: generationModeLabels[generationMode] },
                  { key: "generationStatus", label: "生成状态", children: generationStatusLabels[generationStatus] },
                  { key: "provider", label: "Provider", children: draft.generationSource?.provider || "-" },
                  { key: "model", label: "模型", children: draft.generationSource?.model || "-" },
                  { key: "generatedAt", label: "生成时间", children: draft.generationSource?.generatedAt || "-" },
                  { key: "updatedAt", label: "更新时间", children: draft.updatedAt || "-" }
                ]}
              />
            </Card>
            <Card title="下一步判断">
              <Alert
                showIcon
                type={draftReviewNextStep === "fix_qa" || draftReviewNextStep === "configure_generation" || draftReviewNextStep === "fix_publish" ? "warning" : draftReviewNextStep === "retrospect" ? "success" : "info"}
                message={`当前优先：${draftReviewNextStepLabels[draftReviewNextStep]}`}
                description={draftReviewActionText}
                style={{ marginBottom: 12 }}
              />
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: "publishHandoff",
                    label: "发布承接",
                    children: <Tag color={draftPublishHandoffColors[publishHandoff]}>{draftPublishHandoffLabels[publishHandoff]}</Tag>
                  },
                  {
                    key: "nextStep",
                    label: "下一步",
                    children: <Tag color={draftReviewNextStepColors[draftReviewNextStep]}>{draftReviewNextStepLabels[draftReviewNextStep]}</Tag>
                  },
                  {
                    key: "action",
                    label: "处理动作",
                    children: draftReviewActionText
                  },
                  {
                    key: "entry",
                    label: "可执行入口",
                    children: renderDraftReviewEntry()
                  }
                ]}
              />
            </Card>
            <Card title="质检面板">
              {draft.qaResult.passed ? <Alert type="success" message="自动质检通过" /> : <Alert type="error" message="存在阻断项" />}
              <h3>阻断项</h3>
              {draft.qaResult.blockers.length ? draft.qaResult.blockers.map((item) => <Tag color="red" key={item}>{item}</Tag>) : <p className="muted">无</p>}
              <h3>警告项</h3>
              {draft.qaResult.warnings.length ? (
                <Space wrap>
                  {draft.qaResult.warnings.map((item) => (
                    <Tag color="gold" key={item}>{item}</Tag>
                  ))}
                </Space>
              ) : (
                <p className="muted">无</p>
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </>
  );
}
