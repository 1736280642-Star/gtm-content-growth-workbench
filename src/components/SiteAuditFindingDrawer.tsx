"use client";

import { Alert, Button, Descriptions, Drawer, Input, Popconfirm, Space, Tag } from "antd";
import { useState } from "react";
import type { SiteAuditFinding } from "@/lib/v5/site-audit-contracts";

export function SiteAuditFindingDrawer({ finding, open, busy, onClose, onCreateRemediation, onReview }: {
  finding?: SiteAuditFinding;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onCreateRemediation: (finding: SiteAuditFinding, note: string) => Promise<void>;
  onReview: (finding: SiteAuditFinding, decision: "resolved" | "ignored", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <Drawer title={finding ? `审计问题：${finding.title}` : "审计问题"} open={open} onClose={onClose} width={620} destroyOnClose>
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
        <Alert showIcon type="info" message="官网审计与 AI 前台测试保持独立" description="这里只管理网站问题、整改和复审，不合并 AI 回答状态，也不计算统一总分。" />
        <Input.TextArea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="填写整改、复审或忽略说明" />
        <Space wrap>
          <Button type="primary" loading={busy} onClick={() => onCreateRemediation(finding, note)}>创建整改任务</Button>
          <Popconfirm title="确认问题已修复？" onConfirm={() => onReview(finding, "resolved", note)}><Button loading={busy}>复审通过</Button></Popconfirm>
          <Popconfirm title="确认忽略该问题？" description="需要保留说明和审计记录。" onConfirm={() => onReview(finding, "ignored", note)}><Button danger loading={busy}>忽略并说明</Button></Popconfirm>
        </Space>
      </Space> : null}
    </Drawer>
  );
}
