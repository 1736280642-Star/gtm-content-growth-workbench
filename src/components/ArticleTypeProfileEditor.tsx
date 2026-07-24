"use client";

import { CheckOutlined, CloseOutlined, RobotOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, List, Select, Space, Steps, Tag, message } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import type {
  ArticleTypeFieldSource,
  ArticleTypeProfileDraftInput,
  ArticleTypeProfileSummary,
  ArticleTypeSupplementResult,
  ArticleTypeSupplementSuggestion
} from "@/lib/v5/article-type-contracts";

const sourceMeta: Record<ArticleTypeFieldSource, { label: string; color: string }> = {
  user_input: { label: "用户填写", color: "blue" },
  ai_suggested: { label: "AI 建议", color: "gold" },
  user_confirmed: { label: "已确认", color: "green" },
  template_inherited: { label: "模板继承", color: "default" }
};

const fieldLabels: Record<string, string> = {
  semanticDescription: "一句话定义",
  suitableQuestionDescription: "适配问题",
  unsuitableQuestionDescription: "不适配问题",
  targetAudience: "目标读者",
  contentGoal: "内容目标",
  structureModules: "内容结构",
  requiredSections: "必须展开",
  cta: "CTA",
  lengthRange: "篇幅",
  styleTraits: "风格与语气",
  caseUsage: "案例使用方式",
  evidencePreferences: "证据偏好",
  channelHints: "渠道提示",
  exampleQuestions: "适配问题示例"
};

function emptyDraft(): ArticleTypeProfileDraftInput {
  return {
    name: "",
    semanticDescription: "",
    suitableQuestionDescription: "",
    unsuitableQuestionDescription: "",
    targetAudience: [],
    contentGoal: "",
    structureModules: [],
    requiredSections: [],
    cta: "",
    lengthRange: { min: 1200, max: 2400, unit: "字" },
    styleTraits: [],
    caseUsage: "",
    evidencePreferences: [],
    channelHints: [],
    exampleQuestions: [],
    fieldSources: {}
  };
}

function draftFromProfile(profile?: ArticleTypeProfileSummary, copyMode?: boolean): ArticleTypeProfileDraftInput {
  const version = profile?.activeVersion || profile?.currentVersion;
  if (!version) return emptyDraft();
  return {
    name: copyMode ? `${version.name}副本` : version.name,
    semanticDescription: version.semanticDescription,
    suitableQuestionDescription: version.suitableQuestionDescription,
    unsuitableQuestionDescription: version.unsuitableQuestionDescription,
    targetAudience: [...version.targetAudience],
    contentGoal: version.contentGoal,
    structureModules: [...version.structureModules],
    requiredSections: [...version.requiredSections],
    cta: version.cta,
    lengthRange: { ...version.lengthRange },
    styleTraits: [...version.styleTraits],
    caseUsage: version.caseUsage,
    evidencePreferences: [...version.evidencePreferences],
    channelHints: [...version.channelHints],
    exampleQuestions: [...version.exampleQuestions],
    fieldSources: copyMode
      ? Object.fromEntries(Object.keys(version.fieldSources).map((field) => [field, "template_inherited"]))
      : { ...version.fieldSources }
  };
}

function makeKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `article-type-${Date.now()}`;
}

async function requestJson(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-idempotency-key": makeKey() },
    body: JSON.stringify(body)
  });
  const result = await response.json() as { ok?: boolean; data?: unknown; error?: { message?: string; details?: string[] } };
  if (!response.ok || !result.ok) throw new Error([result.error?.message, ...(result.error?.details || [])].filter(Boolean).join(" ") || "请求失败。" );
  return result.data;
}

function SourceTag({ source }: { source?: ArticleTypeFieldSource }) {
  if (!source) return null;
  const meta = sourceMeta[source];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export function ArticleTypeProfileEditor({
  open,
  profile,
  copyMode,
  onClose,
  onSaved
}: {
  open: boolean;
  profile?: ArticleTypeProfileSummary;
  copyMode?: boolean;
  onClose: () => void;
  onSaved: (profile: ArticleTypeProfileSummary) => void;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ArticleTypeProfileDraftInput>(() => draftFromProfile(profile, copyMode));
  const [savedProfile, setSavedProfile] = useState<ArticleTypeProfileSummary>();
  const [supplement, setSupplement] = useState<ArticleTypeSupplementResult>();
  const [working, setWorking] = useState<"supplement" | "save" | "activate">();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDraft(draftFromProfile(profile, copyMode));
    setSavedProfile(copyMode ? undefined : profile);
    setSupplement(undefined);
    setDirty(false);
  }, [copyMode, open, profile]);

  const hasMinimumInput = Boolean(draft.name.trim() && (draft.semanticDescription.trim() || draft.suitableQuestionDescription.trim() || draft.contentGoal?.trim()));
  const sourceFor = (field: string) => draft.fieldSources?.[field];
  const title = copyMode ? "复制内容类型" : profile ? "编辑并创建新版本" : "新建内容类型";
  function updateField(field: keyof ArticleTypeProfileDraftInput, value: unknown) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      [field]: value,
      fieldSources: { ...(current.fieldSources || {}), [field]: "user_input" }
    }));
  }

  function applySuggestion(item: ArticleTypeSupplementSuggestion) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      [item.field]: item.value,
      aiSupplementRunId: supplement?.runId,
      fieldSources: { ...(current.fieldSources || {}), [item.field]: "user_confirmed" }
    }));
    setSupplement((current) => current ? { ...current, suggestions: current.suggestions.filter((candidate) => candidate.field !== item.field) } : current);
  }

  async function runSupplement() {
    if (!hasMinimumInput) return;
    setWorking("supplement");
    try {
      const result = await requestJson("/api/v5/article-type-profiles/supplement", "POST", {
        expectedVersion: 0,
        input: draft,
        auditReason: "补充并结构化当前内容类型表单"
      }) as ArticleTypeSupplementResult;
      setSupplement(result);
      if (result.status === "pending_config") messageApi.warning(result.message);
      else if (result.status === "failed") messageApi.error(result.message);
      else {
        setStep(2);
        messageApi.success(result.message);
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "AI 补充失败，请重试。" );
    } finally {
      setWorking(undefined);
    }
  }

  async function saveDraft() {
    if (!hasMinimumInput) return;
    setWorking("save");
    try {
      const current = savedProfile;
      const editingExisting = Boolean(current && !copyMode);
      const url = editingExisting ? `/api/v5/article-type-profiles/${encodeURIComponent(current!.profileId)}` : "/api/v5/article-type-profiles";
      const result = await requestJson(url, editingExisting ? "PATCH" : "POST", {
        expectedVersion: editingExisting ? current!.revision : 0,
        auditReason: editingExisting ? "编辑并创建内容类型新版本" : copyMode ? "从已有类型复制内容类型" : "创建内容类型草稿",
        input: draft,
        copyFromProfileId: copyMode ? profile?.profileId : undefined
      }) as ArticleTypeProfileSummary;
      setSavedProfile(result);
      setDirty(false);
      onSaved(result);
      messageApi.success("内容类型草稿已保存。" );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "内容类型草稿保存失败。" );
    } finally {
      setWorking(undefined);
    }
  }

  async function activate() {
    if (!savedProfile) return;
    setWorking("activate");
    try {
      const result = await requestJson(`/api/v5/article-type-profiles/${encodeURIComponent(savedProfile.profileId)}/activate`, "POST", {
        expectedVersion: savedProfile.revision,
        profileVersionId: savedProfile.currentVersion.profileVersionId,
        auditReason: "确认内容类型配置并发布当前版本"
      }) as ArticleTypeProfileSummary;
      setSavedProfile(result);
      onSaved(result);
      messageApi.success(`已发布 ${result.currentVersion.name} v${result.currentVersion.version}。` );
      onClose();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "内容类型版本发布失败。" );
    } finally {
      setWorking(undefined);
    }
  }

  const purposeFields = (
    <div className="article-type-form-grid">
      <Form.Item label={<Space size={4}>类型名称<SourceTag source={sourceFor("name")} /></Space>} required><Input maxLength={60} value={draft.name} onChange={(event) => updateField("name", event.target.value)} /></Form.Item>
      <Form.Item label={<Space size={4}>一句话定义<SourceTag source={sourceFor("semanticDescription")} /></Space>}><Input.TextArea rows={3} maxLength={500} value={draft.semanticDescription} onChange={(event) => updateField("semanticDescription", event.target.value)} /></Form.Item>
      <Form.Item label={<Space size={4}>适配什么问题<SourceTag source={sourceFor("suitableQuestionDescription")} /></Space>}><Input.TextArea rows={4} maxLength={800} value={draft.suitableQuestionDescription} onChange={(event) => updateField("suitableQuestionDescription", event.target.value)} /></Form.Item>
      <Form.Item label={<Space size={4}>不适配什么问题<SourceTag source={sourceFor("unsuitableQuestionDescription")} /></Space>}><Input.TextArea rows={4} maxLength={800} value={draft.unsuitableQuestionDescription} onChange={(event) => updateField("unsuitableQuestionDescription", event.target.value)} /></Form.Item>
      <Form.Item label={<Space size={4}>目标读者<SourceTag source={sourceFor("targetAudience")} /></Space>}><Select mode="tags" value={draft.targetAudience} onChange={(value) => updateField("targetAudience", value)} /></Form.Item>
      <Form.Item label={<Space size={4}>内容目标<SourceTag source={sourceFor("contentGoal")} /></Space>}><Input.TextArea rows={3} maxLength={500} value={draft.contentGoal} onChange={(event) => updateField("contentGoal", event.target.value)} /></Form.Item>
    </div>
  );

  const expressionFields = (
    <div className="article-type-form-grid">
      <Form.Item label={<Space size={4}>内容结构<SourceTag source={sourceFor("structureModules")} /></Space>}><Select mode="tags" value={draft.structureModules} onChange={(value) => updateField("structureModules", value)} /></Form.Item>
      <Form.Item label={<Space size={4}>必须展开的内容<SourceTag source={sourceFor("requiredSections")} /></Space>}><Select mode="tags" value={draft.requiredSections} onChange={(value) => updateField("requiredSections", value)} /></Form.Item>
      <Form.Item label={<Space size={4}>CTA<SourceTag source={sourceFor("cta")} /></Space>}><Input.TextArea rows={2} maxLength={300} value={draft.cta} onChange={(event) => updateField("cta", event.target.value)} /></Form.Item>
      <Form.Item label={<Space size={4}>篇幅<SourceTag source={sourceFor("lengthRange")} /></Space>}><Space.Compact block><InputNumber min={300} max={10000} value={draft.lengthRange?.min} onChange={(value) => updateField("lengthRange", { ...draft.lengthRange, min: Number(value || 0), unit: "字" })} /><Input disabled value="至" style={{ width: 50, textAlign: "center" }} /><InputNumber min={300} max={10000} value={draft.lengthRange?.max} onChange={(value) => updateField("lengthRange", { ...draft.lengthRange, max: Number(value || 0), unit: "字" })} /></Space.Compact></Form.Item>
      <Form.Item label={<Space size={4}>风格与语气<SourceTag source={sourceFor("styleTraits")} /></Space>}><Select mode="tags" value={draft.styleTraits} onChange={(value) => updateField("styleTraits", value)} /></Form.Item>
      <Form.Item label={<Space size={4}>案例使用方式<SourceTag source={sourceFor("caseUsage")} /></Space>}><Input.TextArea rows={2} value={draft.caseUsage} onChange={(event) => updateField("caseUsage", event.target.value)} /></Form.Item>
      <Form.Item label={<Space size={4}>证据偏好<SourceTag source={sourceFor("evidencePreferences")} /></Space>}><Select mode="tags" value={draft.evidencePreferences} onChange={(value) => updateField("evidencePreferences", value)} /></Form.Item>
      <Form.Item label={<Space size={4}>渠道提示<SourceTag source={sourceFor("channelHints")} /></Space>}><Select mode="tags" value={draft.channelHints} onChange={(value) => updateField("channelHints", value)} /></Form.Item>
    </div>
  );

  return (
    <>
      {contextHolder}
      <Drawer
        className="article-type-editor"
        width={760}
        open={open}
        title={title}
        onClose={onClose}
        extra={<Space wrap><Button icon={<RobotOutlined />} disabled={!hasMinimumInput} loading={working === "supplement"} onClick={() => void runSupplement()}>{working === "supplement" ? "AI 正在补充" : "AI 补充"}</Button><Button icon={<SaveOutlined />} disabled={!hasMinimumInput} loading={working === "save"} onClick={() => void saveDraft()}>保存草稿</Button><Button type="primary" icon={<CheckOutlined />} disabled={dirty || !savedProfile || savedProfile.currentVersion.status !== "draft"} loading={working === "activate"} onClick={() => void activate()}>发布版本</Button></Space>}
      >
        {!hasMinimumInput ? <Alert showIcon type="info" message="请先说明该类型适合解决什么问题，AI 才能进行补充。" /> : null}
        <Steps className="article-type-editor-steps" current={step} onChange={setStep} items={[{ title: "类型用途" }, { title: "表达设置" }, { title: "AI 补充与确认" }]} />
        <Form layout="vertical">
          {step === 0 ? purposeFields : null}
          {step === 1 ? expressionFields : null}
          {step === 2 ? (
            <div className="article-type-review">
              {supplement ? <Alert showIcon type={supplement.status === "success" ? "success" : supplement.status === "pending_config" ? "warning" : "error"} message={supplement.message} description={supplement.status === "pending_config" ? "人工填写路径始终可用；当前输入不会被清空。" : undefined} /> : <Alert showIcon type="info" message="可运行 AI 补充，也可以直接检查并保存人工配置。" />}
              {supplement?.suggestions.length ? <List className="article-type-suggestion-list" header={<div className="article-type-suggestion-header"><strong>待确认建议</strong><Button size="small" type="link" onClick={() => supplement.suggestions.forEach(applySuggestion)}>采用全部建议</Button></div>} dataSource={supplement.suggestions} renderItem={(item) => <List.Item actions={[<Button key="adopt" size="small" type="primary" onClick={() => applySuggestion(item)}>采用</Button>, <Button key="ignore" size="small" icon={<CloseOutlined />} onClick={() => setSupplement((current) => current ? { ...current, suggestions: current.suggestions.filter((candidate) => candidate.field !== item.field) } : current)}>忽略</Button>]}><List.Item.Meta title={<Space>{fieldLabels[String(item.field)] || String(item.field)}<Tag color="gold">AI 建议</Tag></Space>} description={<><div>{Array.isArray(item.value) ? item.value.join("、") : typeof item.value === "object" ? `${item.value.min}-${item.value.max} 字` : item.value}</div><TypographyText>{item.reason}</TypographyText></>} /></List.Item>} /> : null}
              {supplement?.overlaps.length ? <Descriptions size="small" column={1} title="可能混淆的已有类型" items={supplement.overlaps.map((item) => ({ key: item.profileVersionId, label: item.name, children: item.reason }))} /> : null}
              {supplement?.missingInformation.length ? <Alert showIcon type="warning" message="仍需确认的信息" description={supplement.missingInformation.join("；")} /> : null}
              <Descriptions size="small" column={1} title="最终结构化版本" items={[
                { key: "name", label: "类型", children: draft.name },
                { key: "purpose", label: "用途", children: draft.suitableQuestionDescription || draft.semanticDescription },
                { key: "audience", label: "读者", children: draft.targetAudience?.join("、") || "待补充" },
                { key: "structure", label: "结构", children: draft.structureModules?.join(" -> ") || "待补充" },
                { key: "style", label: "风格", children: draft.styleTraits?.join("、") || "待补充" },
                { key: "evidence", label: "证据偏好", children: draft.evidencePreferences?.join("、") || "待补充" }
              ]} />
            </div>
          ) : null}
        </Form>
        <div className="article-type-editor-nav"><Button disabled={step === 0} onClick={() => setStep((current) => current - 1)}>上一步</Button><Button disabled={step === 2} type="primary" onClick={() => setStep((current) => current + 1)}>下一步</Button></div>
      </Drawer>
    </>
  );
}

function TypographyText({ children }: { children: ReactNode }) {
  return <span className="article-type-suggestion-reason">{children}</span>;
}
