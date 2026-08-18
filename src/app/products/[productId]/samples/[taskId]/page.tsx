"use client";

import { ArrowLeftOutlined, CodeOutlined, FileSearchOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Descriptions, Drawer, Select, Space, Spin, Tag, Typography } from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import { SampleArticleReviewPanel } from "@/components/SampleArticleReviewPanel";
import { callJsonApi } from "@/lib/client-api";

interface SampleVersion {
  draftVersionId: string;
  versionNumber: number;
  title: string;
  markdown: string;
  copyAllowed: boolean;
  createdAt?: string;
  provider: string;
  model?: string;
  brief?: Record<string, unknown>;
  technicalPrompt?: { system: string; user: string };
  decision?: string;
  feedback?: { revisionInstruction?: string };
}

interface SampleDetail {
  productId: string;
  strategyPackId: string;
  taskId: string;
  articleTypeVersionId: string;
  articleTypeName: string;
  title: string;
  reviewStatus: string;
  acceptedDraftVersionId?: string;
  operation?: { status: string; progressStage?: string; error?: { message: string; nextAction: string } };
  versions: SampleVersion[];
  currentVersion?: SampleVersion;
}

const progressText: Record<string, string> = {
  queued: "等待后台 Worker 领取",
  retrieving_evidence: "正在检索证据",
  compiling_contract: "正在准备写作 Brief",
  provider_preflight: "正在检查正文模型",
  calling_provider: "正在调用正文模型",
  local_repair: "正在整理正文",
  quality_validation: "正在校验事实"
};

function textList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : [];
}

export default function ProductSampleDetailPage() {
  const { productId, taskId } = useParams<{ productId: string; taskId: string }>();
  const [data, setData] = useState<SampleDetail>();
  const [selectedDraftId, setSelectedDraftId] = useState<string>();
  const [briefOpen, setBriefOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const body = await callJsonApi<{ ok: true; data: SampleDetail }>(
      `/api/v5/products/${encodeURIComponent(productId)}/sample-articles/${encodeURIComponent(taskId)}`,
      { cache: "no-store" }
    );
    setData(body.data);
    setSelectedDraftId((current) => current && body.data.versions.some((item) => item.draftVersionId === current)
      ? current
      : body.data.currentVersion?.draftVersionId);
    setLoading(false);
  }, [productId, taskId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!["queued", "running"].includes(data?.operation?.status || "")) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [data?.operation?.status, refresh]);

  const version = useMemo(
    () => data?.versions.find((item) => item.draftVersionId === selectedDraftId) || data?.currentVersion,
    [data, selectedDraftId]
  );
  const isLatest = version?.draftVersionId === data?.currentVersion?.draftVersionId;
  const brief = version?.brief || {};

  if (loading && !data) return <div className="sample-page-loading"><Spin /> 正在打开样文</div>;
  if (!data) return <Alert type="error" showIcon message="没有找到这篇样文" />;

  return (
    <div className="sample-reader-page">
      <header className="sample-reader-header">
        <div>
          <Link href={`/products/${encodeURIComponent(productId)}/samples`}>
            <Button type="text" icon={<ArrowLeftOutlined />}>返回样文列表</Button>
          </Link>
          <Space wrap size={8}>
            <Tag color="blue">{data.articleTypeName}</Tag>
            {data.reviewStatus === "approved" ? <Tag color="green">已确认</Tag> : <Tag color="gold">待验收</Tag>}
          </Space>
          <Typography.Title level={2}>{data.title}</Typography.Title>
        </div>
        <Space wrap>
          {data.versions.length ? (
            <Select
              value={version?.draftVersionId}
              onChange={setSelectedDraftId}
              options={data.versions.map((item) => ({ label: `第 ${item.versionNumber} 版`, value: item.draftVersionId }))}
              style={{ width: 120 }}
            />
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>
          <Button type="primary" ghost icon={<FileSearchOutlined />} onClick={() => setBriefOpen(true)}>查看本篇写作 Brief</Button>
        </Space>
      </header>

      {["queued", "running"].includes(data.operation?.status || "") ? (
        <Alert
          showIcon
          type="info"
          message={progressText[data.operation?.progressStage || "queued"] || "正在生成新版本"}
          description="当前版本仍可阅读。新版本完成后页面会自动切换。"
        />
      ) : null}
      {data.operation?.error ? <Alert showIcon type="error" message={data.operation.error.message} description={data.operation.error.nextAction} /> : null}

      {version ? (
        <main className="sample-reader-canvas">
          <div className="sample-reader-meta">
            <span>第 {version.versionNumber} 版</span>
            <span>{version.provider}{version.model ? ` · ${version.model}` : ""}</span>
            <span>{version.createdAt ? new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false }) : ""}</span>
          </div>
          <MarkdownArticle markdown={version.markdown} />
        </main>
      ) : <Alert showIcon type="info" message="样文正在生成" description="生成完成后正文会自动出现在这里。" />}

      {version && isLatest ? (
        <div className="sample-reader-review-dock">
          <SampleArticleReviewPanel draftVersionId={version.draftVersionId} onUpdated={refresh} />
        </div>
      ) : version ? (
        <Alert showIcon type="info" message="当前查看的是历史版本" description="切换到最新版后才能提交修改或确认。" />
      ) : null}

      <Drawer title="本篇写作 Brief" open={briefOpen} onClose={() => setBriefOpen(false)} width={620}>
        <div className="sample-brief-drawer">
          <Typography.Paragraph type="secondary">这是生成当前版本时实际冻结的写作输入。你可以据此判断问题来自策略、知识资料、系统规则还是上一轮修改要求。</Typography.Paragraph>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="文章类型">{String(brief.articleType || data.articleTypeName)}</Descriptions.Item>
            <Descriptions.Item label="目标读者">{String(brief.targetAudience || "未提供")}</Descriptions.Item>
            <Descriptions.Item label="要回答的问题">{String(brief.questionToAnswer || data.title)}</Descriptions.Item>
            <Descriptions.Item label="发布渠道">{String(brief.channel || "wechat")}</Descriptions.Item>
          </Descriptions>

          <section>
            <Typography.Title level={5}>写作方向 <Tag color="blue">来自策略</Tag></Typography.Title>
            <ul>{textList(brief.writingDirection).map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section>
            <Typography.Title level={5}>核心事实 <Tag color="green">来自知识库</Tag></Typography.Title>
            <ul>{textList(brief.coreFacts).map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section>
            <Typography.Title level={5}>事实规则 <Tag>系统规则</Tag></Typography.Title>
            <ul>{textList(brief.factualRules).map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          {textList(brief.userRevisionRequirements).length ? (
            <section>
              <Typography.Title level={5}>本次修改要求 <Tag color="purple">用户要求</Tag></Typography.Title>
              <ul>{textList(brief.userRevisionRequirements).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ) : null}
          <Collapse items={[{
            key: "technical",
            label: <Space><CodeOutlined />查看脱敏后的技术版 Prompt</Space>,
            children: version?.technicalPrompt ? (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div><Typography.Text strong>System Prompt</Typography.Text><pre className="sample-technical-prompt">{version.technicalPrompt.system}</pre></div>
                <div><Typography.Text strong>User Prompt</Typography.Text><pre className="sample-technical-prompt">{version.technicalPrompt.user}</pre></div>
              </Space>
            ) : <Typography.Text type="secondary">该历史版本生成时尚未保存 Prompt 快照。</Typography.Text>
          }]} />
        </div>
      </Drawer>
    </div>
  );
}
