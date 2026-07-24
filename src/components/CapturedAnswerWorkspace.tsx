"use client";

import { FileProtectOutlined, LinkOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, List, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { CapturedAnswer, FrontendCaptureArtifact, ObservationGap, ObservationGapDestination, ObservationReview } from "@/lib/v5/observation-contracts";
import { CitationEvidenceDrawer } from "./CitationEvidenceDrawer";
import { ObservationGapReviewDrawer } from "./ObservationGapReviewDrawer";

export function CapturedAnswerWorkspace({ answers, artifacts, gaps, reviews, selectedAnswerId, onSelectAnswer, onAnalyzeGaps, onReviewGaps }: {
  answers: CapturedAnswer[];
  artifacts: FrontendCaptureArtifact[];
  gaps: ObservationGap[];
  reviews: ObservationReview[];
  selectedAnswerId?: string;
  onSelectAnswer: (id: string) => void;
  onAnalyzeGaps: (answer: CapturedAnswer) => Promise<void>;
  onReviewGaps: (answer: CapturedAnswer, gapIds: string[], destinations: ObservationGapDestination[], note: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [citationId, setCitationId] = useState<string>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => answers.filter((item) => item.questionText.toLowerCase().includes(search.trim().toLowerCase())), [answers, search]);
  const selected = answers.find((item) => item.id === selectedAnswerId) || filtered[0];
  const answerGaps = gaps.filter((item) => item.answerId === selected?.id);
  const answerReviews = reviews.filter((item) => item.answerId === selected?.id);
  const artifact = artifacts.find((item) => item.id === selected?.artifactId);
  const citation = selected?.citations.find((item) => item.id === citationId);

  if (!answers.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成一次真实单次采集后，回答与引用证据会显示在这里。" />;

  const items = selected ? [
    {
      key: "answer",
      label: "回答正文",
      children: <div className="captured-answer-copy"><Typography.Paragraph>{selected.answerText}</Typography.Paragraph><Alert showIcon type={selected.targetEntityMentioned ? "success" : "warning"} message={`目标实体${selected.targetEntityMentioned ? "已出现" : "未出现"}`} /></div>
    },
    {
      key: "citations",
      label: `引用证据 ${selected.citations.length}`,
      children: <Table rowKey="id" size="small" pagination={false} dataSource={selected.citations} columns={[
        { title: "引用", dataIndex: "title", render: (value, record) => <div className="v5-table-stack"><strong>{value || record.label}</strong><span>{new URL(record.url).hostname}</span></div> },
        { title: "状态", dataIndex: "verificationStatus", render: (value) => <Tag color={value === "verified" ? "green" : "orange"}>{value === "verified" ? "可访问" : "未验证"}</Tag> },
        { title: "位置", dataIndex: "position" },
        { title: "操作", render: (_, record) => <Button size="small" icon={<LinkOutlined />} onClick={() => setCitationId(record.id)}>证据详情</Button> }
      ]} />
    },
    {
      key: "gaps",
      label: `缺口分析 ${answerGaps.length}`,
      children: answerGaps.length ? <div className="gap-analysis-list">
        {answerGaps.map((gap) => <div key={gap.id}><div><strong>{gap.title}</strong><Tag>{gap.code}</Tag></div><p>{gap.explanation}</p><span>证据位置：{gap.evidenceLocation} · 置信度 {Math.round(gap.confidence * 100)}% · {gap.status}</span></div>)}
        {answerReviews.map((review) => <Alert key={review.id} showIcon type="info" message={`复核 v${review.version}：${review.decision === "confirmed" ? "已确认并分流" : "已驳回"}`} description={`未创建月度任务；下游状态：${review.downstream.map((item) => `${item.target} ${item.status}`).join("、") || "无"}`} />)}
      </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成候选缺口" />
    },
    {
      key: "artifact",
      label: "原始记录",
      children: artifact ? <div className="capture-artifact-record"><Alert showIcon type="success" message="不可变原始包已通过 SHA-256 校验" /><dl><dt>原始包 SHA-256</dt><dd className="mono">{artifact.sha256}</dd><dt>截图工件</dt><dd className="mono">{artifact.screenshotArtifactId}</dd><dt>截图 SHA-256</dt><dd className="mono">{artifact.screenshotSha256}</dd><dt>适配器 / 浏览器</dt><dd>{artifact.adapterVersion} / {artifact.browserVersion}</dd><dt>存储</dt><dd>受控本地存储，不生成公开 URL</dd></dl></div> : null
    }
  ] : [];

  return (
    <div className="captured-answer-workspace">
      <aside className="captured-answer-list">
        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问题" allowClear />
        <List dataSource={filtered} renderItem={(answer) => {
          const gapCount = gaps.filter((item) => item.answerId === answer.id).length;
          return <button className={`captured-answer-list-item ${selected?.id === answer.id ? "is-active" : ""}`} onClick={() => onSelectAnswer(answer.id)}><strong>{answer.questionText}</strong><span>ChatGPT · {answer.targetEntityMentioned ? "已提及目标实体" : "未提及目标实体"}</span><span>引用 {answer.citations.length} · {gapCount ? "已有缺口分析" : "待分析"}</span></button>;
        }} />
      </aside>
      <section className="captured-answer-detail">
        {selected ? <><div className="captured-answer-heading"><div><h2>{selected.questionText}</h2><Space wrap><Tag color="blue">ChatGPT</Tag><Tag color="green" icon={<FileProtectOutlined />}>原始包已校验</Tag><span>{new Date(selected.createdAt).toLocaleString("zh-CN", { hour12: false })}</span></Space></div><Button type="primary" loading={busy} onClick={async () => { setBusy(true); try { if (!answerGaps.length) await onAnalyzeGaps(selected); setReviewOpen(true); } finally { setBusy(false); } }}>开始人工复核</Button></div><Tabs items={items} /></> : null}
      </section>
      <CitationEvidenceDrawer citation={citation} open={Boolean(citation)} onClose={() => setCitationId(undefined)} />
      <ObservationGapReviewDrawer answer={selected} gaps={answerGaps} open={reviewOpen} submitting={busy} onClose={() => setReviewOpen(false)} onConfirm={async (gapIds, destinations, note) => { if (!selected) return; setBusy(true); try { await onReviewGaps(selected, gapIds, destinations, note); setReviewOpen(false); } finally { setBusy(false); } }} />
    </div>
  );
}
