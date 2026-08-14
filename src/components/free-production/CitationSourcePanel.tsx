"use client";

import { ArrowRightOutlined, CheckCircleOutlined, DatabaseOutlined, EditOutlined, FileTextOutlined, FireOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Empty, Space, Tag } from "antd";
import { useMemo, type ReactNode } from "react";
import type { DraftSection, FreeProductionSourceExcerpt } from "@/lib/v5/free-production-contracts";
import { citedFreeProductionSourceIds } from "@/lib/v5/free-production-evidence";

const sourceMeta = {
  knowledge: { label: "知识库资料", icon: <DatabaseOutlined /> },
  human_fact: { label: "人工事实", icon: <EditOutlined /> },
  meeting_text: { label: "会议文本", icon: <FileTextOutlined /> },
  trend_signal: { label: "AIHOT 热点", icon: <FireOutlined /> }
};

const CANDIDATE_PREVIEW_LIMIT = 20;

function sourceLinks(source: FreeProductionSourceExcerpt) {
  return source.sourceType === "trend_signal" ? (
    <Space size={12} wrap>
      <a href={source.aihotUrl} target="_blank" rel="noreferrer"><LinkOutlined /> AIHOT</a>
      <a href={source.originalUrl} target="_blank" rel="noreferrer"><LinkOutlined /> 原文</a>
    </Space>
  ) : null;
}

export function CitationSourcePanel({ sources, sections, hotspotPanel, onContinue }: { sources: FreeProductionSourceExcerpt[]; sections: DraftSection[]; hotspotPanel?: ReactNode; onContinue: () => void }) {
  const evidence = useMemo(() => {
    const citedIds = citedFreeProductionSourceIds(sections, sources);
    const usageBySourceId = new Map<string, { sectionKeys: Set<string>; claims: Set<string> }>();
    for (const section of sections) {
      for (const citation of section.citations || []) {
        for (const sourceId of citation.sourceIds) {
          if (!citedIds.has(sourceId)) continue;
          const usage = usageBySourceId.get(sourceId) || { sectionKeys: new Set<string>(), claims: new Set<string>() };
          usage.sectionKeys.add(section.sectionKey);
          if (citation.claimText.trim()) usage.claims.add(citation.claimText.trim());
          usageBySourceId.set(sourceId, usage);
        }
      }
    }
    return {
      cited: sources.filter((source) => citedIds.has(source.id)).map((source) => ({ source, usage: usageBySourceId.get(source.id) })),
      candidates: sources.filter((source) => !citedIds.has(source.id)),
      coveredSections: new Set(Array.from(usageBySourceId.values()).flatMap((usage) => Array.from(usage.sectionKeys))).size
    };
  }, [sections, sources]);
  const coverageComplete = sections.length > 0 && evidence.coveredSections === sections.length;
  return (
    <aside className="citation-source-panel">
      {hotspotPanel}
      <div className="citation-source-heading">
        <span className="v5-kicker">事实依据</span>
        <div><h2>正文已引用</h2><Tag color={coverageComplete ? "success" : "warning"}>{evidence.coveredSections} / {sections.length} 章节</Tag></div>
        <p>这里只展示已与正文主张建立引用映射的证据。</p>
      </div>
      {evidence.cited.length ? (
        <div className="citation-source-list citation-source-list-cited">
          {evidence.cited.map(({ source, usage }) => (
            <section key={source.id}>
              <span><CheckCircleOutlined />{sourceMeta[source.sourceType].icon}{sourceMeta[source.sourceType].label}</span>
              {source.sourceName ? <em>{source.sourceName}</em> : null}
              <blockquote>{source.excerpt}</blockquote>
              {usage?.claims.size ? <div className="citation-source-claims"><strong>支持正文</strong>{Array.from(usage.claims).map((claim) => <p key={claim}>{claim}</p>)}</div> : null}
              {sourceLinks(source)}
            </section>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前正文还没有可追溯的引用映射" />}
      {evidence.candidates.length ? (
        <details className="citation-candidate-details">
          <summary>未采用候选资料 <span>{evidence.candidates.length}</span></summary>
          <p>这些资料曾进入候选池，但没有被当前正文正式引用。</p>
          <div className="citation-source-list citation-source-list-candidates">
            {evidence.candidates.slice(0, CANDIDATE_PREVIEW_LIMIT).map((source) => (
              <section key={source.id}>
                <span>{sourceMeta[source.sourceType].icon}{sourceMeta[source.sourceType].label}</span>
                <blockquote>{source.excerpt}</blockquote>
              </section>
            ))}
          </div>
          {evidence.candidates.length > CANDIDATE_PREVIEW_LIMIT ? <small>仅展示前 {CANDIDATE_PREVIEW_LIMIT} 条，其余 {evidence.candidates.length - CANDIDATE_PREVIEW_LIMIT} 条保留在审计快照中。</small> : null}
        </details>
      ) : null}
      <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" disabled={!coverageComplete} onClick={onContinue}>核对完成，继续发布</Button>
    </aside>
  );
}
