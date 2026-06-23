"use client";

import { Alert, Button, Card, Col, Descriptions, Input, Row, Space, Tag, message } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";

const generationModeLabels = {
  local_rule: "本地规则引擎",
  ai_provider: "AI Provider"
} as const;

const generationStatusLabels = {
  success: "成功",
  pending_config: "待配置",
  failed: "失败"
} as const;

export default function DraftReviewPage({ params }: { params: { taskId: string } }) {
  const {
    state: { drafts, tasks },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const task = tasks.find((item) => item.id === params.taskId);
  const draft = task ? drafts.find((item) => item.taskId === task.id) : undefined;

  useEffect(() => {
    if (!draft) {
      return;
    }

    setTitle(draft.title);
    setSummary(draft.summary);
    setContent(draft.content);
  }, [draft]);

  const failedSegments = useMemo(() => draft?.qaResult.failedSegments || [], [draft]);
  const issues = draft?.qaResult.issues || [];
  const isDirty = Boolean(draft && (title !== draft.title || summary !== draft.summary || content !== draft.content));
  const copyAllowed = Boolean(draft?.qaResult.passed && draft.qaResult.copyAllowed !== false && !isDirty);
  const generationMode = draft?.generationSource?.mode ?? "local_rule";
  const generationStatus = draft?.generationSource?.status ?? "success";

  async function handleSaveAndQa() {
    if (!draft) {
      return;
    }

    setSaving(true);

    try {
      const result = await callJsonApi(`/api/article-drafts/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          summary,
          content,
          editNote: isDirty ? "人工修改后运行 AI 二次质检。" : "手动触发 AI 二次质检。"
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "AI 二次质检已完成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "AI 二次质检失败");
    } finally {
      setSaving(false);
    }
  }

  function handleRestorePrevious() {
    if (!draft) {
      return;
    }

    setTitle(draft.title);
    setSummary(draft.summary);
    setContent(draft.content);
    messageApi.info("已返回到上一次保存后的草稿内容。");
  }

  function handleDeleteFailedSegments() {
    if (!failedSegments.length) {
      messageApi.info("当前没有可删除的红色失败片段。");
      return;
    }

    const nextContent = failedSegments.reduce((text, segment) => text.split(segment).join(""), content);
    setContent(nextContent.replace(/\n{3,}/g, "\n\n").trim());
    messageApi.info("已删除红色失败片段，请重新运行 AI 二次质检。");
  }

  async function handleCopyFullText() {
    if (!copyAllowed) {
      messageApi.warning(isDirty ? "请先保存并运行 AI 二次质检，通过后再复制全文。" : "质检未通过，暂不能复制全文。");
      return;
    }

    setCopying(true);

    try {
      await navigator.clipboard.writeText([title, summary, content].filter(Boolean).join("\n\n"));
      messageApi.success("全文已复制，可以到外部渠道人工发布。发布完成后回今日发布页确认并回填 URL。");
    } catch {
      messageApi.error("复制失败，请检查浏览器剪贴板权限。");
    } finally {
      setCopying(false);
    }
  }

  if (!task || !draft) {
    return (
      <>
        <PageHeader title="草稿预览" subtitle="当前任务还没有生成稿件。" />
        <PageErrorState message={error} loading={loading} onRetry={refresh} />
        <Card>
          <ActionEmpty
            title="当前任务还没有草稿"
            description="请先在今日发布页勾选任务并批量生成正文。"
            action={
              <Link href="/today">
                <Button type="primary">去今日发布</Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="草稿预览"
        subtitle="人工修改后必须运行 AI 二次质检；通过后才能复制全文并到外部渠道发布。"
        actions={
          <>
            <Link href="/today">
              <Button>返回今日发布</Button>
            </Link>
            <Button loading={saving} onClick={handleSaveAndQa}>
              保存并质检
            </Button>
            <Button type="primary" loading={copying} disabled={!copyAllowed} onClick={handleCopyFullText}>
              复制全文
            </Button>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Row gutter={16}>
        <Col span={15}>
          <Card title="正文预览与人工修改">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Alert
                showIcon
                type={!draft.qaResult.passed ? "error" : isDirty ? "warning" : draft.qaResult.warnings.length ? "warning" : "success"}
                message={!draft.qaResult.passed ? "AI 二次质检未通过，不能复制全文" : isDirty ? "存在未质检的人工修改" : draft.qaResult.warnings.length ? "质检通过，但有提醒" : "质检通过，可以复制全文"}
                description={
                  isDirty
                    ? "当前编辑区内容和上一次质检结果不一致，请先保存并质检。"
                    : draft.qaResult.summary || "通过后复制全文，外部发布完成再回今日发布页确认。"
                }
              />
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input value={summary} onChange={(event) => setSummary(event.target.value)} />
              <Input.TextArea rows={18} value={content} onChange={(event) => setContent(event.target.value)} />
              <Space wrap>
                <Button loading={saving} onClick={handleSaveAndQa}>
                  保存并运行 AI 二次质检
                </Button>
                <Button onClick={handleRestorePrevious} disabled={!isDirty}>
                  返回修改前
                </Button>
                <Button danger onClick={handleDeleteFailedSegments} disabled={!failedSegments.length}>
                  删除红色失败片段
                </Button>
                <Button type="primary" loading={copying} disabled={!copyAllowed} onClick={handleCopyFullText}>
                  复制全文
                </Button>
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
                  { key: "primaryDistilledTerm", label: "主蒸馏词", children: task.primaryDistilledTerm || "-" },
                  { key: "sourceProblem", label: "来源问题", children: task.sourceProblem || "-" },
                  { key: "officialLinkTarget", label: "官网链接目标", children: task.officialLinkTarget || "https://jotoai.com" },
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
            <Card title="AI 二次质检">
              <Space direction="vertical" style={{ width: "100%" }}>
                <Alert showIcon type={draft.qaResult.passed ? "success" : "error"} message={draft.qaResult.summary || (draft.qaResult.passed ? "质检通过" : "存在阻断项")} />
                <div>
                  <h3>阻断项</h3>
                  {draft.qaResult.blockers.length ? (
                    <Space wrap>
                      {draft.qaResult.blockers.map((item) => (
                        <Tag color="red" key={item}>
                          {item}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <p className="muted">无</p>
                  )}
                </div>
                <div>
                  <h3>提醒项</h3>
                  {draft.qaResult.warnings.length ? (
                    <Space wrap>
                      {draft.qaResult.warnings.map((item) => (
                        <Tag color="gold" key={item}>
                          {item}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <p className="muted">无</p>
                  )}
                </div>
                <div>
                  <h3>红色失败片段</h3>
                  {failedSegments.length ? (
                    <Space wrap>
                      {failedSegments.map((item) => (
                        <Tag color="red" key={item}>
                          {item}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <p className="muted">无</p>
                  )}
                </div>
                <div>
                  <h3>问题明细</h3>
                  {issues.length ? (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {issues.map((issue) => (
                        <Alert
                          key={`${issue.rule}-${issue.location}-${issue.failedText || ""}`}
                          type={issue.severity === "blocker" ? "error" : "warning"}
                          message={`${issue.rule}｜${issue.location}`}
                          description={issue.failedText ? `${issue.failedText}：${issue.suggestedAction}` : issue.suggestedAction}
                        />
                      ))}
                    </Space>
                  ) : (
                    <p className="muted">无</p>
                  )}
                </div>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </>
  );
}
