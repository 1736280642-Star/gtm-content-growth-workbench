"use client";

import { CheckCircleOutlined, CopyOutlined, EnvironmentOutlined, ToolOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Drawer, Input, Popconfirm, Space, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { SiteAuditFinding } from "@/lib/v5/site-audit-contracts";

const pageTypeLabels = {
  privacy_policy: "隐私政策页",
  terms: "服务条款页",
  article: "文章页",
  product_service: "产品/服务页",
  general: "普通内容页",
  technical_resource: "技术资源"
} as const;

export function SiteAuditFindingDrawer({ finding, open, busy, onClose, onCreateRemediation, onReview }: {
  finding?: SiteAuditFinding;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onCreateRemediation: (finding: SiteAuditFinding, note: string) => Promise<void>;
  onReview: (finding: SiteAuditFinding, decision: "resolved" | "ignored", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  useEffect(() => { if (open) setNote(""); }, [finding?.id, open]);
  const guidance = finding?.remediationGuidance;
  const taskNote = useMemo(() => {
    if (!finding) return "";
    if (!guidance) return `整改 ${finding.url}\n${finding.recommendedRemediation}`;
    return [
      `整改页面：${finding.url}`,
      `页面判断：${guidance.pageContext}`,
      `修改位置：${guidance.targetLocations.join("；")}`,
      `具体动作：${guidance.actions.join("；")}`,
      guidance.suggestedCopy.length ? `建议文案：${guidance.suggestedCopy.join("；")}` : "",
      `验收条件：${guidance.acceptanceCriteria.join("；")}`
    ].filter(Boolean).join("\n");
  }, [finding, guidance]);

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      messageApi.success(success);
    } catch {
      messageApi.error("复制失败，请选中文案后手动复制");
    }
  }

  return (
    <Drawer title={finding ? `审计问题：${finding.title}` : "审计问题"} open={open} onClose={onClose} width={760} destroyOnClose>
      {contextHolder}
      {finding ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="URL">{finding.url}</Descriptions.Item>
          <Descriptions.Item label="严重度"><Tag color={finding.severity === "critical" ? "red" : finding.severity === "high" ? "orange" : "blue"}>{finding.severity}</Tag></Descriptions.Item>
          <Descriptions.Item label="类型">{finding.category}</Descriptions.Item>
          <Descriptions.Item label="首次发现">{new Date(finding.firstSeenAt).toLocaleString("zh-CN", { hour12: false })}</Descriptions.Item>
          <Descriptions.Item label="检测依据">{finding.detectionEvidence}</Descriptions.Item>
          <Descriptions.Item label="用户影响">{finding.userImpact}</Descriptions.Item>
          <Descriptions.Item label="建议整改">{finding.recommendedRemediation}</Descriptions.Item>
        </Descriptions>
        {guidance ? <section className="site-remediation-prescription" aria-label="页面整改处方">
          <header className="site-remediation-prescription__header">
            <div><span>PAGE REMEDIATION</span><strong>页面整改处方</strong></div>
            <Tag>{pageTypeLabels[guidance.pageType]}</Tag>
          </header>
          <p className="site-remediation-prescription__context">{guidance.pageContext}</p>
          <div className="site-remediation-prescription__step">
            <span className="site-remediation-prescription__number">01</span>
            <div><h3><EnvironmentOutlined /> 在哪里改</h3><ul>{guidance.targetLocations.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
          <div className="site-remediation-prescription__step">
            <span className="site-remediation-prescription__number">02</span>
            <div><h3><ToolOutlined /> 具体怎么改</h3><ul>{guidance.actions.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
          {guidance.suggestedCopy.length ? <div className="site-remediation-prescription__step">
            <span className="site-remediation-prescription__number">03</span>
            <div className="site-remediation-prescription__copy"><h3>建议文案</h3>{guidance.suggestedCopy.map((item) => <blockquote key={item}>{item}</blockquote>)}<Button size="small" icon={<CopyOutlined />} onClick={() => copyText(guidance.suggestedCopy.join("\n\n"), "建议文案已复制")}>复制文案</Button></div>
          </div> : null}
          <div className="site-remediation-prescription__step">
            <span className="site-remediation-prescription__number">{guidance.suggestedCopy.length ? "04" : "03"}</span>
            <div><h3><CheckCircleOutlined /> 如何验收</h3><ul className="site-remediation-prescription__checks">{guidance.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
        </section> : <Alert showIcon type="warning" message="这是历史审计记录" description="重新发起审计后，系统会根据页面类型生成包含修改位置、建议文案和验收条件的整改处方。" />}
        <Alert showIcon type="info" message="官网审计与 AI 前台测试保持独立" description="这里只管理网站问题、整改和复审，不合并 AI 回答状态，也不计算统一总分。" />
        <div className="site-remediation-task-note"><div><strong>整改任务说明</strong><Button type="link" size="small" onClick={() => setNote(taskNote)}>带入完整处方</Button></div><Input.TextArea rows={6} value={note} onChange={(event) => setNote(event.target.value)} placeholder="填写整改、复审或忽略说明；可先带入完整处方再分配任务" /></div>
        <Space wrap>
          <Button type="primary" loading={busy} onClick={() => onCreateRemediation(finding, note)}>创建整改任务</Button>
          <Popconfirm title="确认问题已修复？" onConfirm={() => onReview(finding, "resolved", note)}><Button loading={busy}>复审通过</Button></Popconfirm>
          <Popconfirm title="确认忽略该问题？" description="需要保留说明和审计记录。" onConfirm={() => onReview(finding, "ignored", note)}><Button danger loading={busy}>忽略并说明</Button></Popconfirm>
        </Space>
      </Space> : null}
    </Drawer>
  );
}
