"use client";

import { Alert, Button, Card, Input, Modal, Select, Space, Tag, message } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import type { DraftRiskKeepReasonCategory } from "@/lib/types";

const generationModeLabels = {
  local_rule: "本地规则稿",
  ai_provider: "AI 生成"
} as const;

const generationStatusLabels = {
  success: "成功",
  pending_config: "待配置",
  failed: "失败"
} as const;

const keepReasonCategoryLabels: Record<DraftRiskKeepReasonCategory, string> = {
  false_positive: "质检误报",
  evidence_added: "已补证据",
  business_exception: "业务例外",
  source_quote: "原文引用",
  uncategorized: "未分类"
};

const keepReasonCategoryOptions = Object.entries(keepReasonCategoryLabels).map(([value, label]) => ({
  value,
  label
}));

type PendingDraftEditAction = {
  type: "delete_risk_segment" | "ai_rewrite_segment";
  source: "user" | "local_rule";
  segment: string;
  originalText: string;
  rewrittenText?: string;
  reason?: string;
};

function buildSegmentRewrite(segment: string) {
  const rewritten = segment
    .split("最强")
    .join("更有竞争力")
    .split("绝对领先")
    .join("具备一定优势")
    .split("永久免费")
    .join("具体费用以官方政策为准")
    .split("100%")
    .join("尽量");

  return rewritten === segment ? `${segment}（需补充证据后再表达）` : rewritten;
}

function inferKeepReasonCategory(reason: string): DraftRiskKeepReasonCategory {
  const text = reason.toLowerCase();

  if (text.includes("引用") || text.includes("原文") || text.includes("客户原话") || text.includes("访谈")) {
    return "source_quote";
  }

  if (text.includes("误报") || text.includes("不是风险") || text.includes("可接受") || text.includes("上下文")) {
    return "false_positive";
  }

  if (text.includes("证据") || text.includes("官网") || text.includes("链接") || text.includes("案例") || text.includes("资料") || text.includes("已补")) {
    return "evidence_added";
  }

  if (text.includes("业务") || text.includes("必须") || text.includes("特殊") || text.includes("渠道") || text.includes("活动") || text.includes("合规")) {
    return "business_exception";
  }

  return "uncategorized";
}

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
  const [keptSegments, setKeptSegments] = useState<string[]>([]);
  const [keepReasons, setKeepReasons] = useState<Record<string, string>>({});
  const [keepReasonCategories, setKeepReasonCategories] = useState<Record<string, DraftRiskKeepReasonCategory>>({});
  const [pendingKeepSegment, setPendingKeepSegment] = useState<string>();
  const [pendingKeepReason, setPendingKeepReason] = useState("");
  const [pendingKeepReasonCategory, setPendingKeepReasonCategory] = useState<DraftRiskKeepReasonCategory>("uncategorized");
  const [pendingKeepReasonCategoryTouched, setPendingKeepReasonCategoryTouched] = useState(false);
  const [pendingEditActions, setPendingEditActions] = useState<PendingDraftEditAction[]>([]);
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

  useEffect(() => {
    setKeptSegments([]);
    setKeepReasons({});
    setKeepReasonCategories({});
    setPendingKeepSegment(undefined);
    setPendingKeepReason("");
    setPendingKeepReasonCategory("uncategorized");
    setPendingKeepReasonCategoryTouched(false);
    setPendingEditActions([]);
  }, [draft?.id, draft?.version]);

  const failedSegments = useMemo(() => draft?.qaResult.failedSegments || [], [draft]);
  const visibleFailedSegments = useMemo(
    () => Array.from(new Set(failedSegments.filter((segment) => segment && content.includes(segment)))),
    [content, failedSegments]
  );
  const issues = draft?.qaResult.issues || [];
  const isDirty = Boolean(draft && (title !== draft.title || summary !== draft.summary || content !== draft.content));
  const copyAllowed = Boolean(draft?.qaResult.passed && draft.qaResult.copyAllowed !== false && !isDirty);
  const generationMode = draft?.generationSource?.mode ?? "local_rule";
  const generationStatus = draft?.generationSource?.status ?? "success";
  const editActions = draft?.qaResult.editActions || [];
  const showInlineRiskPreview = Boolean(visibleFailedSegments.length);
  const showRiskRail = Boolean(editActions.length);

  function getEditActionLabel(type: string) {
    if (type === "delete_risk_segment") return "已删除";
    if (type === "ai_rewrite_segment") return "AI改写";
    if (type === "keep_risk_segment") return "保留";
    if (type === "run_qa") return "质检";
    return "人工修改";
  }

  function getRiskProblem(segment: string) {
    const issue = issues.find((item) => item.failedText === segment || Boolean(item.failedText && segment.includes(item.failedText)));

    if (issue) {
      return `${issue.rule}：${issue.suggestedAction}`;
    }

    return draft?.qaResult.blockers[0] || "存在高风险表达，需处理后重新质检。";
  }

  function renderAnnotatedMarkdown() {
    if (!content.trim()) {
      return <span className="muted">暂无正文。</span>;
    }

    if (!visibleFailedSegments.length) {
      return <span>{content}</span>;
    }

    const matches = visibleFailedSegments
      .map((segment) => ({ segment, index: content.indexOf(segment) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index);
    const nodes: ReactNode[] = [];
    let cursor = 0;

    matches.forEach(({ segment, index }, matchIndex) => {
      if (index < cursor) {
        return;
      }

      if (index > cursor) {
        nodes.push(<span key={`text-${matchIndex}`}>{content.slice(cursor, index)}</span>);
      }

      nodes.push(
        <span className="draft-risk-segment" key={`${segment}-${matchIndex}`}>
          <span className="draft-risk-text">{segment}</span>
          <span className="draft-risk-callout">
            <strong>高风险！问题：{getRiskProblem(segment)}</strong>
            {keptSegments.includes(segment) ? (
              <Tag color="orange">
                已保留：{keepReasonCategoryLabels[keepReasonCategories[segment] || inferKeepReasonCategory(keepReasons[segment] || "")]}
              </Tag>
            ) : null}
            <Space size={6} wrap className="draft-risk-actions">
              <Button size="small" danger onClick={() => handleDeleteFailedSegment(segment)}>
                删除
              </Button>
              <Button size="small" onClick={() => handleRewriteFailedSegment(segment)}>
                AI改写
              </Button>
              <Button size="small" onClick={() => handleKeepFailedSegment(segment)}>
                保留
              </Button>
            </Space>
          </span>
        </span>
      );
      cursor = index + segment.length;
    });

    if (cursor < content.length) {
      nodes.push(<span key="text-end">{content.slice(cursor)}</span>);
    }

    return nodes;
  }

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
          editNote: isDirty ? "人工修改后运行 AI 二次质检。" : "手动触发 AI 二次质检。",
          keptRiskSegments: keptSegments.map((segment) => ({
            segment,
            reason: keepReasons[segment],
            keepReasonCategory: keepReasonCategories[segment] || inferKeepReasonCategory(keepReasons[segment] || "")
          })),
          editActions: pendingEditActions
        })
      });
      await refresh();
      setPendingEditActions([]);
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
    setKeptSegments([]);
    setKeepReasons({});
    setKeepReasonCategories({});
    setPendingEditActions([]);
    messageApi.info("已返回到上一次保存后的草稿内容。");
  }

  function handleDeleteFailedSegment(segment: string) {
    const nextContent = content
      .split(segment)
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    setContent(nextContent);
    setPendingEditActions((current) => [
      ...current,
      {
        type: "delete_risk_segment",
        source: "user",
        segment,
        originalText: segment,
        reason: getRiskProblem(segment)
      }
    ]);
    setKeptSegments((current) => current.filter((item) => item !== segment));
    setKeepReasons((current) => {
      const next = { ...current };
      delete next[segment];
      return next;
    });
    setKeepReasonCategories((current) => {
      const next = { ...current };
      delete next[segment];
      return next;
    });
    messageApi.info("已删除高风险片段，请重新运行 AI 二次质检。");
  }

  function handleRewriteFailedSegment(segment: string) {
    const rewritten = buildSegmentRewrite(segment);
    setContent(content.split(segment).join(rewritten));
    setPendingEditActions((current) => [
      ...current,
      {
        type: "ai_rewrite_segment",
        source: "local_rule",
        segment,
        originalText: segment,
        rewrittenText: rewritten,
        reason: getRiskProblem(segment)
      }
    ]);
    setKeptSegments((current) => current.filter((item) => item !== segment));
    setKeepReasons((current) => {
      const next = { ...current };
      delete next[segment];
      return next;
    });
    setKeepReasonCategories((current) => {
      const next = { ...current };
      delete next[segment];
      return next;
    });
    messageApi.info("已按本地规则生成改写建议，请重新运行 AI 二次质检。");
  }

  function handleKeepFailedSegment(segment: string) {
    const existingReason = keepReasons[segment] || "";
    setPendingKeepSegment(segment);
    setPendingKeepReason(existingReason);
    setPendingKeepReasonCategory(keepReasonCategories[segment] || inferKeepReasonCategory(existingReason));
    setPendingKeepReasonCategoryTouched(Boolean(keepReasonCategories[segment]));
  }

  function handlePendingKeepReasonChange(value: string) {
    setPendingKeepReason(value);

    if (!pendingKeepReasonCategoryTouched) {
      setPendingKeepReasonCategory(inferKeepReasonCategory(value));
    }
  }

  function confirmKeepFailedSegment() {
    if (!pendingKeepSegment) {
      return;
    }

    if (!pendingKeepReason.trim()) {
      messageApi.warning("请填写保留原因。");
      return;
    }

    const segment = pendingKeepSegment;
    const reason = pendingKeepReason.trim();
    const keepReasonCategory = pendingKeepReasonCategory || inferKeepReasonCategory(reason);
    setKeptSegments((current) => (current.includes(segment) ? current : [...current, segment]));
    setKeepReasons((current) => ({
      ...current,
      [segment]: reason
    }));
    setKeepReasonCategories((current) => ({
      ...current,
      [segment]: keepReasonCategory
    }));
    setPendingKeepSegment(undefined);
    setPendingKeepReason("");
    setPendingKeepReasonCategory("uncategorized");
    setPendingKeepReasonCategoryTouched(false);
    messageApi.warning("已记录保留原因。保留高风险片段后，仍需保存并重新质检。");
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
        <PageHeader title="草稿 AI 二次质检" subtitle="当前任务还没有生成稿件。" />
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

  const qaType = !draft.qaResult.passed ? "error" : isDirty ? "warning" : draft.qaResult.warnings.length ? "warning" : "success";
  const qaTitle = !draft.qaResult.passed ? "AI 二次质检未通过" : isDirty ? "存在未质检修改" : draft.qaResult.warnings.length ? "质检通过，有提醒" : "质检通过";
  const contextItems = [
    `发布日期：${task.publishDate}`,
    `渠道：${channelLabels[task.channel]}`,
    `产品：${productLabels[task.product]}`,
    `内容类型：${contentTypeLabels[task.contentType]}`,
    `任务状态：${statusLabels[task.status]}`,
    `主蒸馏词：${task.primaryDistilledTerm || "-"}`,
    `官网链接：${task.officialLinkTarget || "https://jotoai.com"}`,
    `版本：v${draft.version}`,
    `生成模式：${generationModeLabels[generationMode]}`,
    `生成状态：${generationStatusLabels[generationStatus]}`
  ];

  return (
    <>
      {contextHolder}
      <PageHeader
        title="草稿 AI 二次质检"
        subtitle="正文是页面主视角；人工修改后必须运行 AI 二次质检，通过后才能复制全文并到外部渠道发布。"
        actions={
          <div className="draft-header-actions">
            <div className={`draft-qa-status-card draft-qa-status-${qaType}`}>
              <div className="draft-qa-status-main">
                <span>{qaTitle}</span>
                <Tag color={draft.qaResult.passed && !isDirty ? "green" : "red"}>{copyAllowed ? "可复制" : "不可复制"}</Tag>
              </div>
              <div className="draft-qa-status-meta">
                阻断 {draft.qaResult.blockers.length} / 提醒 {draft.qaResult.warnings.length} / 高风险 {visibleFailedSegments.length}
              </div>
            </div>
            <Link href="/today">
              <Button>返回今日发布</Button>
            </Link>
            <Button loading={saving} onClick={handleSaveAndQa}>
              保存并运行 AI 二次质检
            </Button>
            <Button type="primary" loading={copying} disabled={!copyAllowed} onClick={handleCopyFullText}>
              复制全文
            </Button>
          </div>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      <section className="draft-review-layout">
        <div className="draft-context-strip">
          {contextItems.map((item) => (
            <span className="draft-context-item" key={item}>
              {item}
            </span>
          ))}
        </div>

        <Card title="正文 Markdown 编辑" className="draft-editor-panel">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Alert
              showIcon
              type={qaType}
              message={qaTitle}
              description={
                isDirty
                  ? "当前编辑区内容和上一次质检结果不一致，请先保存并运行 AI 二次质检。"
                  : draft.qaResult.summary || "通过后复制全文，外部发布完成再回今日发布页确认。"
              }
            />

            <div className="draft-title-fields">
              <Input addonBefore="标题" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input addonBefore="摘要" value={summary} onChange={(event) => setSummary(event.target.value)} />
            </div>

            <div className={`draft-editor-stage ${showRiskRail ? "" : "draft-editor-stage-full"}`}>
              <div className="draft-editor-main">
                <div className="draft-editor-label">正文编辑区</div>
                {showInlineRiskPreview ? (
                  <div className="draft-inline-risk-panel">
                    <div className="draft-markdown-shell-title">正文风险定位</div>
                    <div className="draft-markdown-risk-preview draft-inline-risk-preview">{renderAnnotatedMarkdown()}</div>
                  </div>
                ) : null}
                <Input.TextArea
                  className="draft-markdown-editor"
                  rows={34}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="在这里编辑 Markdown 正文。"
                />
              </div>
              {showRiskRail ? (
                <aside className="draft-risk-rail">
                  {editActions.length ? (
                    <div className="draft-action-log">
                      <div className="draft-markdown-shell-title">处理记录</div>
                      <Space wrap>
                        {editActions.slice(-6).map((action) => (
                          <Tag key={action.id} color={action.type === "keep_risk_segment" ? "orange" : action.type === "ai_rewrite_segment" ? "blue" : "default"}>
                            {`${getEditActionLabel(action.type)}${action.segment ? `：${action.segment}` : ""}`}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  ) : null}
                </aside>
              ) : null}
            </div>

            <div className="draft-footer-actions">
              <Space wrap>
                <Button loading={saving} onClick={handleSaveAndQa}>
                  保存并运行 AI 二次质检
                </Button>
                <Button onClick={handleRestorePrevious} disabled={!isDirty}>
                  返回修改前
                </Button>
                <Button type="primary" loading={copying} disabled={!copyAllowed} onClick={handleCopyFullText}>
                  复制全文
                </Button>
              </Space>
              <Space wrap>
                {draft.qaResult.blockers.map((item) => (
                  <Tag color="red" key={item}>
                    {item}
                  </Tag>
                ))}
                {draft.qaResult.warnings.map((item) => (
                  <Tag color="gold" key={item}>
                    {item}
                  </Tag>
                ))}
              </Space>
            </div>
          </Space>
        </Card>
      </section>
      <Modal
        title="保留高风险片段"
        open={Boolean(pendingKeepSegment)}
        okText="确认保留"
        cancelText="取消"
        onOk={confirmKeepFailedSegment}
        onCancel={() => {
          setPendingKeepSegment(undefined);
          setPendingKeepReason("");
          setPendingKeepReasonCategory("uncategorized");
          setPendingKeepReasonCategoryTouched(false);
        }}
      >
        <Alert showIcon type="warning" message="保留高风险内容必须填写原因，后续会进入人工处理记录。" style={{ marginBottom: 12 }} />
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Select
            value={pendingKeepReasonCategory}
            options={keepReasonCategoryOptions}
            onChange={(value: DraftRiskKeepReasonCategory) => {
              setPendingKeepReasonCategory(value);
              setPendingKeepReasonCategoryTouched(true);
            }}
            style={{ width: "100%" }}
            aria-label="保留原因分类"
          />
          <Input.TextArea
            rows={4}
            value={pendingKeepReason}
            onChange={(event) => handlePendingKeepReasonChange(event.target.value)}
            placeholder="例如：该片段为引用原文、质检误报、业务必须保留但已补充上下文。"
          />
        </Space>
      </Modal>
    </>
  );
}
