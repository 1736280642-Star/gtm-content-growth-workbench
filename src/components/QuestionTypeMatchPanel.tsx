"use client";

import { PlusOutlined, RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Select, Space, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ArticleTypeProfileSummary, QuestionTypeMatchRun, QuestionTypeSuggestion } from "@/lib/v5/article-type-contracts";
import type { TargetQuestionOption } from "@/lib/v5/monthly-workspace-contracts";

const fitMeta = {
  high: { label: "高", color: "green" },
  medium: { label: "中", color: "blue" },
  possible: { label: "可能适合", color: "default" }
};

export function QuestionTypeMatchPanel({
  questions,
  profiles,
  run,
  disabled,
  running,
  onRun,
  onConfirm
}: {
  questions: TargetQuestionOption[];
  profiles: ArticleTypeProfileSummary[];
  run?: QuestionTypeMatchRun;
  disabled?: boolean;
  running?: boolean;
  onRun: () => Promise<void>;
  onConfirm: (selections: Array<{ questionVersionId: string; articleTypeProfileVersionId: string; selectionStatus: "accepted" | "rejected" | "manual_added" }>) => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<QuestionTypeSuggestion[]>(run?.suggestions || []);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setSuggestions(run?.suggestions || []), [run]);
  const activeProfiles = profiles.filter((profile) => profile.status === "active" && profile.activeVersion);
  const byQuestion = useMemo(() => new Map(questions.map((question) => [question.questionVersionId, suggestions.filter((item) => item.questionVersionId === question.questionVersionId)])), [questions, suggestions]);

  function setSelection(item: QuestionTypeSuggestion, status: "accepted" | "rejected") {
    setSuggestions((current) => current.map((candidate) => candidate.suggestionId === item.suggestionId ? { ...candidate, selectionStatus: status } : candidate));
  }

  function addManual(question: TargetQuestionOption, profileVersionId: string) {
    const profile = activeProfiles.find((item) => item.activeVersion?.profileVersionId === profileVersionId);
    if (!profile?.activeVersion) return;
    const alreadyExists = suggestions.some((item) => item.questionVersionId === question.questionVersionId && item.articleTypeProfileVersionId === profileVersionId);
    if (alreadyExists) {
      setSuggestions((current) => current.map((item) => item.questionVersionId === question.questionVersionId && item.articleTypeProfileVersionId === profileVersionId ? { ...item, selectionStatus: "accepted" } : item));
      return;
    }
    setSuggestions((current) => [...current, {
      suggestionId: `manual-${question.questionVersionId}-${profileVersionId}`,
      questionVersionId: question.questionVersionId,
      question: question.question,
      articleTypeProfileVersionId: profileVersionId,
      articleTypeName: profile.activeVersion!.name,
      fitLevel: "possible",
      semanticScore: 0,
      reason: "用户手动加入内容策略。",
      matchedFacets: [],
      missingInformation: [],
      conflictProfileVersionIds: [],
      selectionStatus: "manual_added",
      selectionSource: "user_selected"
    }]);
  }

  async function confirm() {
    if (!run) return;
    setConfirming(true);
    try {
      await onConfirm(suggestions.map((item) => ({
        questionVersionId: item.questionVersionId,
        articleTypeProfileVersionId: item.articleTypeProfileVersionId,
        selectionStatus: item.selectionStatus === "manual_added" ? "manual_added" : item.selectionStatus === "rejected" ? "rejected" : "accepted"
      })));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="question-type-match-panel">
      <div className="question-type-match-header">
        <div><strong>AI 推荐内容组合</strong><span>AI 判断适合度，人确认组合；Evidence Gate 仍独立决定能否生产。</span></div>
        <Space wrap><Button icon={<RobotOutlined />} disabled={disabled || !questions.length} loading={running} onClick={() => void onRun()}>{running ? "AI 正在匹配" : run ? "重新运行匹配" : "AI 推荐内容组合"}</Button><Button type="primary" disabled={!run || !suggestions.some((item) => item.selectionStatus !== "rejected" && item.selectionStatus !== "suggested")} loading={confirming} onClick={() => void confirm()}>确认类型组合</Button></Space>
      </div>
      {run?.status === "pending_config" ? <Alert showIcon type="warning" message="AI 匹配暂不可用 · pending_config" description="Provider 尚未配置。可以为每个问题手动加入已启用类型，确认后继续配置配额。" /> : null}
      {run?.status === "failed" ? <Alert showIcon type="error" message="AI 匹配失败，请重试" description="当前问题与人工选择不会被清空。" /> : null}
      {!questions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择目标问题" /> : questions.map((question) => {
        const items = byQuestion.get(question.questionVersionId) || [];
        return <section className="question-match-group" key={question.questionVersionId}>
          <div className="question-match-title"><strong>{question.question}</strong><Select className="question-match-manual-select" placeholder="手动增加其他类型" suffixIcon={<PlusOutlined />} value={undefined} options={activeProfiles.map((profile) => ({ value: profile.activeVersion!.profileVersionId, label: `${profile.activeVersion!.name} v${profile.activeVersion!.version}` }))} onChange={(value) => value && addManual(question, value)} /></div>
          {items.length ? <div className="question-match-options">{items.map((item) => {
            const meta = fitMeta[item.fitLevel];
            const selected = item.selectionStatus === "accepted" || item.selectionStatus === "manual_added";
            return <article className={`question-match-option${selected ? " is-selected" : ""}`} key={item.suggestionId}>
              <div className="question-match-option-top"><Space wrap><Tag color={item.selectionSource === "user_selected" ? "cyan" : "blue"}>{item.selectionSource === "user_selected" ? "手动加入" : "AI 推荐"}</Tag><strong>{item.articleTypeName}</strong><Tag color={meta.color}>适配度 {meta.label}</Tag><span>v{profiles.find((profile) => profile.activeVersion?.profileVersionId === item.articleTypeProfileVersionId)?.activeVersion?.version || "-"}</span></Space><Space><Button size="small" type={selected ? "primary" : "default"} onClick={() => setSelection(item, "accepted")}>{selected ? "已选择" : "加入策略"}</Button><Button size="small" danger={item.selectionStatus === "rejected"} onClick={() => setSelection(item, "rejected")}>排除</Button></Space></div>
              <p>{item.reason}</p>
              {item.matchedFacets.length ? <div className="question-match-facets">{item.matchedFacets.map((facet) => <Tag key={facet}>{facet}</Tag>)}</div> : null}
              {item.missingInformation.length ? <span className="question-match-missing">仍缺：{item.missingInformation.join("、")}</span> : null}
            </article>;
          })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={run ? "暂无 AI 建议，可手动增加类型" : "运行匹配后查看推荐理由"} />}
        </section>;
      })}
    </div>
  );
}
