"use client";

import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  ArticleExpressionPresetOption,
  ContentQuotaRule,
  KnowledgeBaseOption,
  MonthlyPlanConfig,
  RulePackageOption,
  TargetQuestionOption
} from "@/lib/v5/monthly-workspace-contracts";

interface MonthlyPlanConfigPanelProps {
  open: boolean;
  locked?: boolean;
  value: MonthlyPlanConfig;
  rulePackages: RulePackageOption[];
  channels: string[];
  targetQuestions: TargetQuestionOption[];
  knowledgeBases: KnowledgeBaseOption[];
  articleExpressionPresets: ArticleExpressionPresetOption[];
  onClose: () => void;
  onSave: (value: MonthlyPlanConfig) => Promise<unknown>;
}

const contentTypes = ["选型与比较", "实施指南", "场景解决方案", "案例与证据", "FAQ", "技术实践"];
const calculateExpandedDeliverableCount = (channelQuotas: Record<string, number>) =>
  Object.values(channelQuotas).reduce((total, quota) => total + (Number.isInteger(quota) && quota > 0 ? quota : 0), 0);

function cloneConfig(value: MonthlyPlanConfig): MonthlyPlanConfig {
  return {
    ...value,
    groups: [],
    questionVersionIds: [...(value.questionVersionIds || [])],
    quotaRules: (value.quotaRules || []).map((rule) => ({
      ...rule,
      channelQuotas: { ...rule.channelQuotas },
      knowledgeBaseIds: [...rule.knowledgeBaseIds]
    }))
  };
}

function sameSnapshot(rulePackage?: RulePackageOption, knowledgeBase?: KnowledgeBaseOption) {
  return knowledgeBase?.sourceSnapshotHash || rulePackage?.sourceSnapshotHash || "";
}

export function MonthlyPlanConfigPanel(props: MonthlyPlanConfigPanelProps) {
  const { open, locked, value, rulePackages, channels, targetQuestions, knowledgeBases, articleExpressionPresets, onClose, onSave } = props;
  const [messageApi, contextHolder] = message.useMessage();
  const [draft, setDraft] = useState(() => cloneConfig(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(cloneConfig(value));
  }, [open, value]);

  const selectablePackages = rulePackages.filter((item) => item.status === "active" && item.monthlyProductionReady);
  const selectedQuestions = targetQuestions.filter((item) => (draft.questionVersionIds || []).includes(item.questionVersionId));
  const allocated = (draft.quotaRules || []).reduce((total, rule) => total + rule.expandedDeliverableCount, 0);
  const remaining = Math.max(0, Number(draft.targetDeliverableCount || 0) - allocated);
  const issues = [
    !draft.month ? "请选择月份。" : "",
    !draft.businessGoal.trim() ? "请填写月度业务目标。" : "",
    !Number.isInteger(draft.targetDeliverableCount) || Number(draft.targetDeliverableCount) < 1 ? "请填写月度渠道成品总数。" : "",
    !selectedQuestions.length ? "至少选择一个目标问题。" : "",
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

  function addQuotaRule() {
    const question = selectedQuestions[0];
    const rulePackage = selectablePackages[0];
    const knowledgeBase = knowledgeBases.find((item) => rulePackage?.knowledgeBaseIds?.includes(item.knowledgeBaseId) && item.status === "ready")
      || knowledgeBases.find((item) => item.status === "ready");
    const expression = articleExpressionPresets.find((item) => item.status === "active");
    const selectedChannels = (rulePackage?.allowedChannels || channels).slice(0, 2);
    if (!question || !rulePackage || !knowledgeBase || !expression || !selectedChannels.length) {
      messageApi.warning("目标问题、规则包、知识库、表达预设或渠道尚未准备完成。");
      return;
    }
    const snapshotHash = sameSnapshot(rulePackage, knowledgeBase);
    const channelQuotas = Object.fromEntries(selectedChannels.map((channel) => [channel, 1]));
    const next: ContentQuotaRule = {
      quotaRuleId: `quota-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      questionVersionId: question.questionVersionId,
      question: question.question,
      contentType: contentTypes[0],
      sameQuotaForAllChannels: true,
      perChannelQuota: 1,
      channelQuotas,
      expandedDeliverableCount: calculateExpandedDeliverableCount(channelQuotas),
      rulePackageVersionId: rulePackage.id,
      knowledgeBaseIds: [knowledgeBase.knowledgeBaseId],
      articleExpressionProfileVersionId: expression.articleExpressionProfileVersionId,
      sourceSnapshotHash: snapshotHash,
      rulePackageSourceSnapshotHash: snapshotHash,
      knowledgeIndexSourceSnapshotHash: snapshotHash,
      evidencePackSourceSnapshotHash: snapshotHash
    };
    setDraft((current) => ({ ...current, quotaRules: [...(current.quotaRules || []), next] }));
  }

  async function save() {
    if (issues.length || locked) return;
    setSaving(true);
    try {
      await onSave(cloneConfig(draft));
      messageApi.success("月度策略草稿已保存。");
      onClose();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "月度策略保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        className="monthly-plan-config-modal"
        width={1080}
        open={open}
        title={locked ? "查看已批准月度策略" : "配置月度内容策略"}
        onCancel={onClose}
        footer={<Space><Button onClick={onClose}>关闭</Button><Button type="primary" icon={<SaveOutlined />} disabled={Boolean(issues.length) || locked} loading={saving} onClick={() => void save()}>保存草稿</Button></Space>}
      >
        {locked ? <Alert showIcon type="info" message="策略已批准，批量生成中心不能修改目标问题、文章类型、渠道配额、规则包、知识库或表达预设。" /> : null}
        <Form layout="vertical" className="monthly-plan-base-form">
          <Form.Item label="月份" required><Input type="month" disabled={locked} value={draft.month} onChange={(event) => setDraft((current) => ({ ...current, month: event.target.value }))} /></Form.Item>
          <Form.Item label="月度渠道成品总数" required><InputNumber min={1} max={1000} disabled={locked} value={draft.targetDeliverableCount} addonAfter="篇" onChange={(value) => setDraft((current) => ({ ...current, targetDeliverableCount: Number(value || 0) }))} /></Form.Item>
          <Form.Item label="月度业务目标" required className="monthly-plan-goal-field"><Input.TextArea disabled={locked} maxLength={160} showCount value={draft.businessGoal} onChange={(event) => setDraft((current) => ({ ...current, businessGoal: event.target.value }))} /></Form.Item>
          <Form.Item label="目标问题" required className="monthly-plan-goal-field"><Select mode="multiple" disabled={locked} value={draft.questionVersionIds} options={targetQuestions.map((item) => ({ value: item.questionVersionId, label: item.question }))} onChange={(questionVersionIds) => setDraft((current) => ({ ...current, questionVersionIds }))} /></Form.Item>
        </Form>

        <div className="monthly-plan-groups-header">
          <div><strong>目标问题与渠道配额</strong><div className="monthly-plan-section-caption">配额表示每个渠道分别生成的数量，多选渠道会增加渠道成品总数。</div></div>
          <Button icon={<PlusOutlined />} disabled={locked || !selectedQuestions.length} onClick={addQuotaRule}>新增配额</Button>
        </div>

        <div className="monthly-quota-list">
          {(draft.quotaRules || []).map((rule, index) => {
            const selectedPackage = selectablePackages.find((item) => item.id === rule.rulePackageVersionId);
            const availableChannels = selectedPackage?.allowedChannels || channels;
            const channelNames = Object.keys(rule.channelQuotas);
            return (
              <section className="monthly-quota-row" key={rule.quotaRuleId} aria-label={`配额 ${index + 1}`}>
                <div className="monthly-quota-row-header"><strong>{rule.question}</strong><Button danger type="text" icon={<DeleteOutlined />} disabled={locked} aria-label="删除配额" onClick={() => setDraft((current) => ({ ...current, quotaRules: (current.quotaRules || []).filter((_, itemIndex) => itemIndex !== index) }))} /></div>
                <div className="monthly-quota-grid">
                  <Form.Item label="目标问题"><Select disabled={locked} value={rule.questionVersionId} options={selectedQuestions.map((item) => ({ value: item.questionVersionId, label: item.question }))} onChange={(id) => { const question = targetQuestions.find((item) => item.questionVersionId === id); if (question) updateRule(index, { questionVersionId: id, question: question.question }); }} /></Form.Item>
                  <Form.Item label="文章类型"><Select disabled={locked} value={rule.contentType} options={contentTypes.map((value) => ({ value, label: value }))} onChange={(contentType) => updateRule(index, { contentType })} /></Form.Item>
                  <Form.Item label="渠道"><Select mode="multiple" disabled={locked} value={channelNames} options={availableChannels.map((value) => ({ value, label: value }))} onChange={(values) => { const channelQuotas = Object.fromEntries(values.map((channel) => [channel, rule.channelQuotas[channel] || rule.perChannelQuota || 1])); updateRule(index, { channelQuotas }); }} /></Form.Item>
                  <Form.Item label="统一每渠道配额"><Checkbox disabled={locked} checked={rule.sameQuotaForAllChannels} onChange={(event) => { const same = event.target.checked; const quota = rule.perChannelQuota || 1; updateRule(index, { sameQuotaForAllChannels: same, channelQuotas: same ? Object.fromEntries(channelNames.map((channel) => [channel, quota])) : rule.channelQuotas }); }}>各渠道使用相同数量</Checkbox></Form.Item>
                </div>
                {rule.sameQuotaForAllChannels ? (
                  <Form.Item label="每渠道配额" className="monthly-quota-number"><InputNumber min={1} max={200} disabled={locked} value={rule.perChannelQuota} addonAfter="篇/渠道" onChange={(value) => { const quota = Number(value || 0); updateRule(index, { perChannelQuota: quota, channelQuotas: Object.fromEntries(channelNames.map((channel) => [channel, quota])) }); }} /></Form.Item>
                ) : (
                  <div className="monthly-channel-quota-grid">{channelNames.map((channel) => <Form.Item key={channel} label={`${channel}配额`}><InputNumber min={1} max={200} disabled={locked} value={rule.channelQuotas[channel]} addonAfter="篇" onChange={(value) => updateRule(index, { channelQuotas: { ...rule.channelQuotas, [channel]: Number(value || 0) } })} /></Form.Item>)}</div>
                )}
                <div className="monthly-quota-formula">{channelNames.map((channel) => `${channel} ${rule.channelQuotas[channel] || 0} 篇`).join(" + ")} = <strong>{rule.expandedDeliverableCount} 篇渠道成品</strong></div>
                <div className="monthly-quota-grid monthly-quota-bindings">
                  <Form.Item label="产品表达规则包"><Select disabled={locked} value={rule.rulePackageVersionId} options={selectablePackages.map((item) => ({ value: item.id, label: `${item.productName} ${item.version}` }))} onChange={(id) => { const item = selectablePackages.find((candidate) => candidate.id === id); const knowledge = knowledgeBases.find((candidate) => item?.knowledgeBaseIds?.includes(candidate.knowledgeBaseId)); const hash = sameSnapshot(item, knowledge); updateRule(index, { rulePackageVersionId: id, knowledgeBaseIds: knowledge ? [knowledge.knowledgeBaseId] : [], sourceSnapshotHash: hash, rulePackageSourceSnapshotHash: hash, knowledgeIndexSourceSnapshotHash: hash, evidencePackSourceSnapshotHash: hash }); }} /></Form.Item>
                  <Form.Item label="知识库"><Select disabled={locked} value={rule.knowledgeBaseIds[0]} options={knowledgeBases.filter((item) => selectedPackage?.knowledgeBaseIds?.includes(item.knowledgeBaseId)).map((item) => ({ value: item.knowledgeBaseId, label: item.name, disabled: item.status !== "ready" || item.sourceSnapshotHash !== selectedPackage?.sourceSnapshotHash }))} onChange={(id) => { const item = knowledgeBases.find((candidate) => candidate.knowledgeBaseId === id); const hash = selectedPackage?.sourceSnapshotHash || ""; if (item?.sourceSnapshotHash === hash) updateRule(index, { knowledgeBaseIds: [id], sourceSnapshotHash: hash, rulePackageSourceSnapshotHash: hash, knowledgeIndexSourceSnapshotHash: hash, evidencePackSourceSnapshotHash: hash }); }} /></Form.Item>
                  <Form.Item label="文章表达预设"><Select disabled={locked} value={rule.articleExpressionProfileVersionId} options={articleExpressionPresets.map((item) => ({ value: item.articleExpressionProfileVersionId, label: item.name, disabled: item.status !== "active" }))} onChange={(articleExpressionProfileVersionId) => updateRule(index, { articleExpressionProfileVersionId })} /></Form.Item>
                </div>
              </section>
            );
          })}
        </div>

        <div className="monthly-plan-summary-bar"><span>月度总数 <strong>{draft.targetDeliverableCount || 0}</strong></span><span>已分配 <strong>{allocated}</strong></span><span>待分配 <strong>{remaining}</strong></span><Tag color={allocated === draft.targetDeliverableCount ? "green" : allocated > Number(draft.targetDeliverableCount || 0) ? "red" : "gold"}>{allocated === draft.targetDeliverableCount ? "配额已平衡" : "草稿可继续配置"}</Tag></div>
        {issues.length ? <Alert className="monthly-plan-balance-alert" showIcon type="warning" message="当前草稿尚不能保存" description={issues.join("；")} /> : null}
      </Modal>
    </>
  );
}
