"use client";

import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, Select, Space, Steps, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ArticleTypeProfileSummary, QuestionTypeMatchRun } from "@/lib/v5/article-type-contracts";
import type {
  ContentQuotaRule,
  KnowledgeBaseOption,
  MonthlyPlanConfig,
  RulePackageOption,
  TargetQuestionOption
} from "@/lib/v5/monthly-workspace-contracts";
import { QuestionTypeMatchPanel } from "./QuestionTypeMatchPanel";

interface MonthlyPlanConfigPanelProps {
  locked?: boolean;
  value: MonthlyPlanConfig;
  rulePackages: RulePackageOption[];
  channels: string[];
  targetQuestions: TargetQuestionOption[];
  knowledgeBases: KnowledgeBaseOption[];
  articleTypeProfiles: ArticleTypeProfileSummary[];
  typeMatchRun?: QuestionTypeMatchRun;
  onSave: (value: MonthlyPlanConfig) => Promise<unknown>;
  onRunMatch: (month: string, questionVersionIds: string[]) => Promise<unknown>;
  onConfirmMatch: (month: string, selections: Array<{ questionVersionId: string; articleTypeProfileVersionId: string; selectionStatus: "accepted" | "rejected" | "manual_added" }>) => Promise<unknown>;
}
const calculateExpandedDeliverableCount = (channelQuotas: Record<string, number>) =>
  Object.values(channelQuotas).reduce((total, quota) => total + (Number.isInteger(quota) && quota > 0 ? quota : 0), 0);

function cloneConfig(value: MonthlyPlanConfig): MonthlyPlanConfig {
  return {
    ...value,
    groups: [],
    questionVersionIds: [...(value.questionVersionIds || [])],
    quotaRules: (value.quotaRules || []).map((rule) => ({ ...rule, channelQuotas: { ...rule.channelQuotas }, knowledgeBaseIds: [...rule.knowledgeBaseIds] }))
  };
}

function sameSnapshot(rulePackage?: RulePackageOption, knowledgeBase?: KnowledgeBaseOption) {
  return knowledgeBase?.sourceSnapshotHash || rulePackage?.sourceSnapshotHash || "";
}

export function MonthlyPlanConfigPanel(props: MonthlyPlanConfigPanelProps) {
  const { locked, value, rulePackages, channels, targetQuestions, knowledgeBases, articleTypeProfiles, typeMatchRun, onSave, onRunMatch, onConfirmMatch } = props;
  const [messageApi, contextHolder] = message.useMessage();
  const [draft, setDraft] = useState(() => cloneConfig(value));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);

  useEffect(() => setDraft(cloneConfig(value)), [value]);

  const selectablePackages = rulePackages.filter((item) => item.status === "active" && item.monthlyProductionReady);
  const selectedQuestions = targetQuestions.filter((item) => (draft.questionVersionIds || []).includes(item.questionVersionId));
  const selectedQuestionIds = new Set(selectedQuestions.map((item) => item.questionVersionId));
  const relevantMatchRun = typeMatchRun
    && typeMatchRun.month === draft.month
    && typeMatchRun.questionVersionIds.length === selectedQuestionIds.size
    && typeMatchRun.questionVersionIds.every((id) => selectedQuestionIds.has(id))
    ? typeMatchRun
    : undefined;
  const confirmedSuggestions = relevantMatchRun?.status === "confirmed"
    ? relevantMatchRun.suggestions.filter((item) => item.selectionStatus === "accepted" || item.selectionStatus === "manual_added")
    : [];
  const allocated = (draft.quotaRules || []).reduce((total, rule) => total + rule.expandedDeliverableCount, 0);
  const remaining = Math.max(0, Number(draft.targetDeliverableCount || 0) - allocated);
  const activeVersionById = useMemo(() => new Map(articleTypeProfiles.flatMap((profile) => profile.activeVersion ? [[profile.activeVersion.profileVersionId, profile.activeVersion] as const] : [])), [articleTypeProfiles]);
  const issues = [
    !draft.month ? "请选择月份。" : "",
    !draft.businessGoal.trim() ? "请填写月度业务目标。" : "",
    !Number.isInteger(draft.targetDeliverableCount) || Number(draft.targetDeliverableCount) < 1 ? "请填写月度渠道成品总数。" : "",
    !selectedQuestions.length ? "至少选择一个目标问题。" : "",
    !relevantMatchRun || relevantMatchRun.status !== "confirmed" ? "请确认目标问题的内容类型组合。" : "",
    !(draft.quotaRules || []).length ? "至少新增一条配额。" : "",
    allocated > Number(draft.targetDeliverableCount || 0) ? "已分配渠道成品数不能超过月度总数。" : ""
  ].filter(Boolean);

  function updateRule(index: number, patch: Partial<ContentQuotaRule>) {
    setDraft((current) => ({
      ...current,
      quotaRules: (current.quotaRules || []).map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        const next = { ...rule, ...patch };
        return { ...next, expandedDeliverableCount: calculateExpandedDeliverableCount(next.channelQuotas) };
      })
    }));
  }

  function buildRuleFromSuggestion(suggestion: QuestionTypeMatchRun["suggestions"][number]): ContentQuotaRule | undefined {
    const version = activeVersionById.get(suggestion.articleTypeProfileVersionId);
    const rulePackage = selectablePackages[0];
    const knowledgeBase = knowledgeBases.find((item) => rulePackage?.knowledgeBaseIds?.includes(item.knowledgeBaseId) && item.status === "ready")
      || knowledgeBases.find((item) => item.status === "ready");
    const selectedChannels = (rulePackage?.allowedChannels || channels).slice(0, 2);
    if (!version || !rulePackage || !knowledgeBase || !selectedChannels.length || !relevantMatchRun) return undefined;
    const snapshotHash = sameSnapshot(rulePackage, knowledgeBase);
    const channelQuotas = Object.fromEntries(selectedChannels.map((channel) => [channel, 1]));
    return {
      quotaRuleId: `quota-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      questionVersionId: suggestion.questionVersionId,
      question: suggestion.question,
      contentType: version.name,
      articleTypeProfileVersionId: version.profileVersionId,
      articleTypeNameSnapshot: version.name,
      typeMatchRunId: relevantMatchRun.matchRunId,
      typeSelectionSource: suggestion.selectionSource,
      matchReasonSnapshot: suggestion.reason,
      articleTypePromptConstraintSnapshot: version.promptConstraintSnapshot,
      articleTypePromptConstraintSnapshotHash: version.promptConstraintSnapshotHash,
      sameQuotaForAllChannels: true,
      perChannelQuota: 1,
      channelQuotas,
      expandedDeliverableCount: calculateExpandedDeliverableCount(channelQuotas),
      rulePackageVersionId: rulePackage.id,
      knowledgeBaseIds: [knowledgeBase.knowledgeBaseId],
      sourceSnapshotHash: snapshotHash,
      rulePackageSourceSnapshotHash: snapshotHash,
      knowledgeIndexSourceSnapshotHash: snapshotHash,
      evidencePackSourceSnapshotHash: snapshotHash
    };
  }

  function addConfirmedRules() {
    const existing = new Set((draft.quotaRules || []).map((rule) => `${rule.questionVersionId}:${rule.articleTypeProfileVersionId}`));
    const additions = confirmedSuggestions.flatMap((suggestion) => {
      if (existing.has(`${suggestion.questionVersionId}:${suggestion.articleTypeProfileVersionId}`)) return [];
      const rule = buildRuleFromSuggestion(suggestion);
      return rule ? [rule] : [];
    });
    if (!additions.length) {
      messageApi.warning(confirmedSuggestions.length ? "已确认组合均已加入，或规则包、知识库尚未达到准入。" : "请先确认内容类型组合。" );
      return;
    }
    setDraft((current) => ({ ...current, quotaRules: [...(current.quotaRules || []), ...additions] }));
    messageApi.success(`已加入 ${additions.length} 条类型配额。` );
  }

  async function runMatch() {
    setMatching(true);
    try {
      await onRunMatch(draft.month, draft.questionVersionIds || []);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "内容类型匹配失败，请重试。" );
    } finally {
      setMatching(false);
    }
  }

  async function confirmMatch(selections: Parameters<MonthlyPlanConfigPanelProps["onConfirmMatch"]>[1]) {
    try {
      await onConfirmMatch(draft.month, selections);
      messageApi.success("内容类型组合已确认并冻结匹配快照。" );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "内容类型组合确认失败。" );
    }
  }

  async function save() {
    if (issues.length || locked) return;
    setSaving(true);
    try {
      await onSave(cloneConfig(draft));
      messageApi.success("月度策略草稿已保存。" );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "月度策略保存失败。" );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="monthly-strategy-builder">
      {contextHolder}
      {locked ? <Alert showIcon type="info" message="策略已批准" description="目标问题、内容类型版本、匹配快照、渠道配额、规则包和知识快照均已冻结。" /> : null}
      <Steps className="monthly-strategy-steps" current={step} onChange={setStep} items={[{ title: "目标与问题" }, { title: "内容组合" }, { title: "类型与配额" }, { title: "资料与版本" }]} />

      {step === 0 ? <section className="monthly-strategy-step" aria-labelledby="strategy-step-goal">
        <div className="v5-section-heading"><div><span className="v5-kicker">步骤 1</span><h2 id="strategy-step-goal">月度目标与目标问题</h2></div></div>
        <Form layout="vertical" className="monthly-plan-base-form">
          <Form.Item label="月份" required><Input type="month" disabled={locked} value={draft.month} onChange={(event) => setDraft((current) => ({ ...current, month: event.target.value, quotaRules: [] }))} /></Form.Item>
          <Form.Item label="月度渠道成品总数" required><InputNumber min={1} max={1000} disabled={locked} value={draft.targetDeliverableCount} addonAfter="篇" onChange={(value) => setDraft((current) => ({ ...current, targetDeliverableCount: Number(value || 0) }))} /></Form.Item>
          <Form.Item label="月度业务目标" required className="monthly-plan-goal-field"><Input.TextArea disabled={locked} maxLength={160} showCount value={draft.businessGoal} onChange={(event) => setDraft((current) => ({ ...current, businessGoal: event.target.value }))} /></Form.Item>
          <Form.Item label="目标问题" required className="monthly-plan-goal-field"><Select mode="multiple" disabled={locked} value={draft.questionVersionIds} options={targetQuestions.map((item) => ({ value: item.questionVersionId, label: item.question }))} onChange={(questionVersionIds) => setDraft((current) => ({ ...current, questionVersionIds, quotaRules: (current.quotaRules || []).filter((rule) => questionVersionIds.includes(rule.questionVersionId)) }))} /></Form.Item>
        </Form>
      </section> : null}

      {step === 1 ? <section className="monthly-strategy-step" aria-labelledby="strategy-step-match">
        <div className="v5-section-heading"><div><span className="v5-kicker">步骤 2</span><h2 id="strategy-step-match">AI 推荐内容组合</h2></div><Button href="/monthly-matrix/content-types">管理内容类型</Button></div>
        <QuestionTypeMatchPanel questions={selectedQuestions} profiles={articleTypeProfiles} run={relevantMatchRun} disabled={locked || !draft.month} running={matching} onRun={runMatch} onConfirm={confirmMatch} />
      </section> : null}

      {step === 2 ? <section className="monthly-strategy-step" aria-labelledby="strategy-step-quota">
        <div className="v5-section-heading"><div><span className="v5-kicker">步骤 3</span><h2 id="strategy-step-quota">类型、渠道和配额</h2><p>配额表示每个渠道分别生成的数量，多选渠道会增加渠道成品总数。</p></div><Button icon={<PlusOutlined />} disabled={locked || relevantMatchRun?.status !== "confirmed"} onClick={addConfirmedRules}>从已确认组合添加配额</Button></div>
        <div className="monthly-quota-list">
          {(draft.quotaRules || []).map((rule, index) => {
            const selectedPackage = selectablePackages.find((item) => item.id === rule.rulePackageVersionId);
            const availableChannels = selectedPackage?.allowedChannels || channels;
            const channelNames = Object.keys(rule.channelQuotas);
            return <section className="monthly-quota-row" key={rule.quotaRuleId} aria-label={`配额 ${index + 1}`}>
              <div className="monthly-quota-row-header"><div><strong>{rule.question}</strong><Space size={4}><Tag color={rule.typeSelectionSource === "ai_recommended" ? "blue" : "cyan"}>{rule.typeSelectionSource === "ai_recommended" ? "AI 推荐" : "手动加入"}</Tag><Tag>{rule.articleTypeNameSnapshot}</Tag><Tag>冻结版本</Tag></Space></div><Button danger type="text" icon={<DeleteOutlined />} disabled={locked} aria-label="删除配额" onClick={() => setDraft((current) => ({ ...current, quotaRules: (current.quotaRules || []).filter((_, itemIndex) => itemIndex !== index) }))} /></div>
              <p className="monthly-type-match-reason">{rule.matchReasonSnapshot}</p>
              <div className="monthly-quota-grid">
                <Form.Item label="内容类型版本"><Input disabled value={`${rule.articleTypeNameSnapshot} · ${rule.articleTypeProfileVersionId}`} /></Form.Item>
                <Form.Item label="渠道"><Select mode="multiple" disabled={locked} value={channelNames} options={availableChannels.map((value) => ({ value, label: value }))} onChange={(values) => { const channelQuotas = Object.fromEntries(values.map((channel) => [channel, rule.channelQuotas[channel] || rule.perChannelQuota || 1])); updateRule(index, { channelQuotas }); }} /></Form.Item>
                <Form.Item label="统一每渠道配额"><Checkbox disabled={locked} checked={rule.sameQuotaForAllChannels} onChange={(event) => { const same = event.target.checked; const quota = rule.perChannelQuota || 1; updateRule(index, { sameQuotaForAllChannels: same, channelQuotas: same ? Object.fromEntries(channelNames.map((channel) => [channel, quota])) : rule.channelQuotas }); }}>各渠道使用相同数量</Checkbox></Form.Item>
              </div>
              {rule.sameQuotaForAllChannels ? <Form.Item label="每渠道配额" className="monthly-quota-number"><InputNumber min={1} max={200} disabled={locked} value={rule.perChannelQuota} addonAfter="篇/渠道" onChange={(value) => { const quota = Number(value || 0); updateRule(index, { perChannelQuota: quota, channelQuotas: Object.fromEntries(channelNames.map((channel) => [channel, quota])) }); }} /></Form.Item> : <div className="monthly-channel-quota-grid">{channelNames.map((channel) => <Form.Item key={channel} label={`${channel}配额`}><InputNumber min={1} max={200} disabled={locked} value={rule.channelQuotas[channel]} addonAfter="篇" onChange={(value) => updateRule(index, { channelQuotas: { ...rule.channelQuotas, [channel]: Number(value || 0) } })} /></Form.Item>)}</div>}
              <div className="monthly-quota-formula">{channelNames.map((channel) => `${channel} ${rule.channelQuotas[channel] || 0} 篇`).join(" + ")} = <strong>{rule.expandedDeliverableCount} 篇渠道成品</strong></div>
            </section>;
          })}
          {!(draft.quotaRules || []).length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="确认内容类型组合后添加配额" /> : null}
        </div>
      </section> : null}

      {step === 3 ? <section className="monthly-strategy-step" aria-labelledby="strategy-step-binding">
        <div className="v5-section-heading"><div><span className="v5-kicker">步骤 4</span><h2 id="strategy-step-binding">规则包、知识库与版本确认</h2><p>Evidence Gate 独立校验事实与公开范围，不会被语义匹配结果绕过。</p></div></div>
        {(draft.quotaRules || []).map((rule, index) => {
          const selectedPackage = selectablePackages.find((item) => item.id === rule.rulePackageVersionId);
          return <section className="monthly-binding-row" key={rule.quotaRuleId}>
            <div><strong>{rule.question}</strong><span>{rule.articleTypeNameSnapshot} · Prompt {rule.articleTypePromptConstraintSnapshotHash.slice(0, 12)}</span></div>
            <div className="monthly-quota-grid monthly-quota-bindings">
              <Form.Item label="产品表达规则包"><Select disabled={locked} value={rule.rulePackageVersionId} options={selectablePackages.map((item) => ({ value: item.id, label: `${item.productName} ${item.version}` }))} onChange={(id) => { const item = selectablePackages.find((candidate) => candidate.id === id); const knowledge = knowledgeBases.find((candidate) => item?.knowledgeBaseIds?.includes(candidate.knowledgeBaseId)); const hash = sameSnapshot(item, knowledge); updateRule(index, { rulePackageVersionId: id, knowledgeBaseIds: knowledge ? [knowledge.knowledgeBaseId] : [], sourceSnapshotHash: hash, rulePackageSourceSnapshotHash: hash, knowledgeIndexSourceSnapshotHash: hash, evidencePackSourceSnapshotHash: hash }); }} /></Form.Item>
              <Form.Item label="知识库"><Select disabled={locked} value={rule.knowledgeBaseIds[0]} options={knowledgeBases.filter((item) => selectedPackage?.knowledgeBaseIds?.includes(item.knowledgeBaseId)).map((item) => ({ value: item.knowledgeBaseId, label: item.name, disabled: item.status !== "ready" || item.sourceSnapshotHash !== selectedPackage?.sourceSnapshotHash }))} onChange={(id) => { const item = knowledgeBases.find((candidate) => candidate.knowledgeBaseId === id); const hash = selectedPackage?.sourceSnapshotHash || ""; if (item?.sourceSnapshotHash === hash) updateRule(index, { knowledgeBaseIds: [id], sourceSnapshotHash: hash, rulePackageSourceSnapshotHash: hash, knowledgeIndexSourceSnapshotHash: hash, evidencePackSourceSnapshotHash: hash }); }} /></Form.Item>
              <Form.Item label="匹配快照"><Input disabled value={`${rule.typeMatchRunId} · ${rule.typeSelectionSource === "ai_recommended" ? "AI 推荐" : "人工选择"}`} /></Form.Item>
            </div>
          </section>;
        })}
        <div className="monthly-plan-summary-bar"><span>月度总数 <strong>{draft.targetDeliverableCount || 0}</strong></span><span>已分配 <strong>{allocated}</strong></span><span>待分配 <strong>{remaining}</strong></span><Tag color={allocated === draft.targetDeliverableCount ? "green" : allocated > Number(draft.targetDeliverableCount || 0) ? "red" : "gold"}>{allocated === draft.targetDeliverableCount ? "配额已平衡" : "草稿可继续配置"}</Tag><Button type="primary" icon={<SaveOutlined />} disabled={Boolean(issues.length) || locked} loading={saving} onClick={() => void save()}>保存月度策略草稿</Button></div>
        {issues.length ? <Alert className="monthly-plan-balance-alert" showIcon type="warning" message="当前草稿尚不能保存" description={issues.join("；")} /> : null}
      </section> : null}

      <div className="monthly-strategy-navigation"><Button disabled={step === 0} onClick={() => setStep((current) => current - 1)}>上一步</Button><Button type="primary" disabled={step === 3} onClick={() => setStep((current) => current + 1)}>下一步</Button></div>
    </div>
  );
}
