"use client";

import { ExportOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Drawer, Space, Tag, Typography } from "antd";
import type { CapturedCitation } from "@/lib/v5/observation-contracts";

export function CitationEvidenceDrawer({ citation, open, onClose }: { citation?: CapturedCitation; open: boolean; onClose: () => void }) {
  return (
    <Drawer title="引用证据详情" open={open} onClose={onClose} width={520} destroyOnClose>
      {citation ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="页面标题">{citation.title || "未捕获标题"}</Descriptions.Item>
            <Descriptions.Item label="URL"><Typography.Text copyable ellipsis>{citation.url}</Typography.Text></Descriptions.Item>
            <Descriptions.Item label="捕获时间">{new Date(citation.capturedAt).toLocaleString("zh-CN", { hour12: false })}</Descriptions.Item>
            <Descriptions.Item label="验证状态"><Tag color={citation.verificationStatus === "verified" ? "green" : "orange"}>{citation.verificationStatus === "verified" ? "可访问" : "未验证"}</Tag></Descriptions.Item>
            <Descriptions.Item label="来源类型">{citation.sourceType || "unknown"}</Descriptions.Item>
          </Descriptions>
          <div className="capture-evidence-quote">
            <strong>回答中的引用位置</strong>
            <p>{citation.visibleSnippet || "未捕获可见引用片段"}</p>
          </div>
          <Alert showIcon type="info" message="引用存在不代表它支持回答中的全部陈述" />
          <Button icon={<ExportOutlined />} href={citation.url} target="_blank" rel="noreferrer">打开原页</Button>
        </Space>
      ) : null}
    </Drawer>
  );
}
