"use client";

import { Alert, Button, Card, Form, Input, InputNumber, Radio, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import type { SampleArticleFeedbackInput, SampleArticleReviewState } from "@/lib/v5/sample-calibration-contracts";

const ratingLabels: Array<[keyof SampleArticleFeedbackInput["ratings"], string]> = [
  ["boundaryClarity", "产品理解准确度"],
  ["scenarioAuthenticity", "用户场景真实度"],
  ["readability", "结构和重点合理度"],
  ["productFit", "表达自然度与可信度"],
  ["factualReliability", "发布就绪度"]
];

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function SampleArticleReviewPanel({ draftVersionId }: { draftVersionId: string }) {
  const [state, setState] = useState<SampleArticleReviewState>();
  const [loading, setLoading] = useState(false);
  const [messageApi, holder] = message.useMessage();
  const [form] = Form.useForm();
  const decision = Form.useWatch("decision", form);

  useEffect(() => {
    void fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/sample-review`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setState(body.data));
  }, [draftVersionId]);

  if (!state?.eligible) return null;

  async function submit() {
    const values = await form.validateFields();
    const feedback: SampleArticleFeedbackInput = {
      decision: values.decision,
      ratings: Object.fromEntries(ratingLabels.map(([key]) => [key, values[key]])) as SampleArticleFeedbackInput["ratings"],
      strengths: lines(values.strengths || ""),
      issues: values.issue?.trim() ? [{ category: values.issueCategory, segment: values.issueSegment || "全文", instruction: values.issue.trim() }] : [],
      expressionDirectives: lines(values.expressionDirectives || ""),
      reason: values.reason
    };
    setLoading(true);
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(draftVersionId)}/sample-review`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `sample-${draftVersionId}-${Date.now()}` },
        body: JSON.stringify(feedback)
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "样稿验收失败");
      setState((current) => current ? { ...current, latestDecision: feedback.decision, latestFeedback: feedback, strategyStatus: feedback.decision === "approved" ? "production_ready" : "pending_sample_review", calibrationVersionId: body.data.calibrationVersionId } : current);
      if (feedback.decision === "changes_requested" && body.data.revision?.status === "generated") {
        window.dispatchEvent(new CustomEvent("product-sample-updated"));
        messageApi.success("反馈已记录，并已生成一版修订稿。");
      } else if (feedback.decision === "changes_requested" && body.data.revision?.status === "failed") {
        messageApi.warning(body.data.revision.nextAction || "反馈已记录，修订稿等待重试。");
      } else {
        messageApi.success("样稿已确认，表达校准版本已冻结。");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "样稿验收失败");
    } finally { setLoading(false); }
  }

  return <Card size="small" title="样稿质量验收" style={{ marginTop: 18 }}>
    {holder}
    {state.strategyStatus === "production_ready" ? <Alert showIcon type="success" message="样稿已通过，策略已进入 production_ready" description={<Space direction="vertical" size={2}><span>{`校准版本：${state.calibrationVersionId || "已冻结"}`}</span>{state.latestFeedback ? <span>{ratingLabels.map(([key, label]) => `${label} ${state.latestFeedback!.ratings[key]} 分`).join(" · ")}</span> : null}</Space>} /> : null}
    <Typography.Paragraph type="secondary">只验收读者最终看到的正文。事实追溯和原始摘录保留在系统内部，不要求正文展示审计信息。</Typography.Paragraph>
    <Form form={form} layout="vertical" initialValues={{ decision: "approved", scenarioAuthenticity: 4, boundaryClarity: 4, factualReliability: 4, readability: 4, productFit: 4, issueCategory: "expression" }}>
      <Form.Item name="decision" label="验收结论" rules={[{ required: true }]}><Radio.Group options={[{ label: "确认通过", value: "approved" }, { label: "需要修改", value: "changes_requested" }]} /></Form.Item>
      <Alert showIcon type="info" message="通过标准：五项均不低于 4 分，且不存在事实、结构或策略问题。" />
      <Space wrap align="start">{ratingLabels.map(([key, label]) => <Form.Item key={key} name={key} label={label} rules={[{ required: true }]}><InputNumber min={1} max={5} precision={0} /></Form.Item>)}</Space>
      <Form.Item name="strengths" label="值得保留的表达（一行一条）"><Input.TextArea rows={2} /></Form.Item>
      <Space.Compact block>
        <Form.Item name="issueCategory" label="主要问题类型" style={{ width: 150 }}><Radio.Group optionType="button" options={[{ label: "表达", value: "expression" }, { label: "结构", value: "structure" }, { label: "事实", value: "fact" }, { label: "策略", value: "strategy" }]} /></Form.Item>
      </Space.Compact>
      <Form.Item name="issueSegment" label="问题位置"><Input placeholder="例如：第二节或全文" /></Form.Item>
      <Form.Item name="issue" label="具体修改要求"><Input.TextArea rows={2} /></Form.Item>
      <Form.Item name="expressionDirectives" label="后续批量正文都应遵循的表达原则（一行一条）"><Input.TextArea rows={3} /></Form.Item>
      <Form.Item name="reason" label="本次判断原因" rules={[{ required: true, max: 500 }]}><Input.TextArea rows={2} /></Form.Item>
      <Button type="primary" loading={loading} onClick={() => void submit()}>{decision === "changes_requested" ? "提交并生成修订稿" : "提交样稿验收"}</Button>
    </Form>
  </Card>;
}
