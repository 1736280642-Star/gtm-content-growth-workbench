"use client";

import { ArrowRightOutlined, DatabaseOutlined, EditOutlined, FileTextOutlined, FireOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Empty, Space } from "antd";
import type { ReactNode } from "react";
import type { FreeProductionSourceExcerpt } from "@/lib/v5/free-production-contracts";

const sourceMeta = {
  knowledge: { label: "知识库资料", icon: <DatabaseOutlined /> },
  human_fact: { label: "人工事实", icon: <EditOutlined /> },
  meeting_text: { label: "会议文本", icon: <FileTextOutlined /> },
  trend_signal: { label: "AIHOT 热点", icon: <FireOutlined /> }
};

export function CitationSourcePanel({ sources, hotspotPanel, onContinue }: { sources: FreeProductionSourceExcerpt[]; hotspotPanel?: ReactNode; onContinue: () => void }) {
  return (
    <aside className="citation-source-panel">
      {hotspotPanel}
      <div className="citation-source-heading"><span className="v5-kicker">事实依据</span><h2>引用来源</h2></div>
      {sources.length ? <div className="citation-source-list">{sources.map((source) => <section key={source.id}><span>{sourceMeta[source.sourceType].icon}{sourceMeta[source.sourceType].label}</span><blockquote>{source.excerpt}</blockquote>{source.sourceType === "trend_signal" ? <Space size={12} wrap><a href={source.aihotUrl} target="_blank" rel="noreferrer"><LinkOutlined /> AIHOT</a><a href={source.originalUrl} target="_blank" rel="noreferrer"><LinkOutlined /> 原文</a></Space> : null}</section>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="历史正文暂无来源快照" />}
      <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" disabled={!sources.length} onClick={onContinue}>核对完成，继续发布</Button>
    </aside>
  );
}
