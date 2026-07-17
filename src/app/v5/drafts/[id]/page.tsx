"use client";

import { ArrowLeftOutlined, CheckCircleOutlined, CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, message, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { FactTrace, FormalDraftVersion } from "@/lib/v5/single-article-contracts";

const traceColumns = [
  { title: "事实句", dataIndex: "sentence", key: "sentence", width: "46%" },
  { title: "EvidenceItem", dataIndex: "evidenceItemId", key: "evidenceItemId", ellipsis: true },
  { title: "Claim", dataIndex: "claimId", key: "claimId", ellipsis: true },
  { title: "SourceRevision", dataIndex: "sourceRevisionId", key: "sourceRevisionId", ellipsis: true }
];

export default function FormalDraftPage({ params }: { params: { id: string } }) {
  const [messageApi, messageContext] = message.useMessage();
  const [draft, setDraft] = useState<FormalDraftVersion>();
  const [error, setError] = useState<{ message: string; nextAction: string }>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v5/drafts/${encodeURIComponent(params.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { ok?: boolean; data?: FormalDraftVersion; error?: { message?: string; nextAction?: string } };
        if (!response.ok || !body.ok || !body.data) {
          throw { message: body.error?.message || "正式正文读取失败。", nextAction: body.error?.nextAction || "返回批量生成中心刷新状态。" };
        }
        setDraft(body.data);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        const detail = reason && typeof reason === "object" ? reason as { message?: string; nextAction?: string } : {};
        setError({ message: detail.message || "正式正文读取失败。", nextAction: detail.nextAction || "返回批量生成中心刷新状态。" });
      });
    return () => controller.abort();
  }, [params.id]);

  async function copyMarkdown() {
    if (!draft?.copyAllowed) return;
    await navigator.clipboard.writeText(draft.markdown);
    messageApi.success("Markdown 已复制");
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title="正式 Markdown 正文"
        titleExtra={draft ? <Space size={6}><Tag color="green">正式 Draft</Tag><Tag>testOnly=false</Tag></Space> : null}
        subtitle="正文与事实追溯来自 MySQL DraftVersion；这里只展示业务审核所需信息。"
        actions={
          <Space wrap>
            <Link href="/batch-generation"><Button icon={<ArrowLeftOutlined />}>返回批量生成中心</Button></Link>
            <Tooltip title={draft?.copyAllowed ? "复制完整 Markdown" : "硬规则通过后才允许复制"}>
              <span><Button type="primary" icon={<CopyOutlined />} disabled={!draft?.copyAllowed} onClick={() => void copyMarkdown()}>复制 Markdown</Button></span>
            </Tooltip>
          </Space>
        }
      />
      {error ? <Alert showIcon type="error" message={error.message} description={`下一步：${error.nextAction}`} /> : null}
      {!draft && !error ? <div className="v5-formal-draft-loading"><Spin /><span>正在读取正式正文</span></div> : null}
      {draft ? (
        <div className="v5-formal-draft-layout">
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} bordered>
            <Descriptions.Item label="DraftVersion ID">{draft.draftVersionId}</Descriptions.Item>
            <Descriptions.Item label="GenerationRun ID">{draft.generationRunId}</Descriptions.Item>
            <Descriptions.Item label="任务版本">v{draft.taskVersion}</Descriptions.Item>
            <Descriptions.Item label="Final EvidencePack">{draft.finalEvidencePackId}</Descriptions.Item>
            <Descriptions.Item label="规则包版本">{draft.rulePackageVersionId}</Descriptions.Item>
            <Descriptions.Item label="硬规则">
              <Tag color={draft.hardRuleResult.passed ? "green" : "red"} icon={draft.hardRuleResult.passed ? <CheckCircleOutlined /> : undefined}>
                {draft.hardRuleResult.passed ? "通过" : "阻断"}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          <section className="v5-formal-draft-section" aria-labelledby="formal-markdown-heading">
            <Typography.Title id="formal-markdown-heading" level={4}>Markdown 正文</Typography.Title>
            <pre className="v5-formal-markdown-source">{draft.markdown}</pre>
          </section>
          <section className="v5-formal-draft-section" aria-labelledby="fact-trace-heading">
            <Space align="baseline" wrap>
              <Typography.Title id="fact-trace-heading" level={4}>事实追溯</Typography.Title>
              <Tag color="green">{draft.hardRuleResult.traceableFactCount} 条已验证</Tag>
            </Space>
            <Table<FactTrace>
              rowKey={(record) => `${record.evidenceItemId}-${record.claimId}-${record.sentence}`}
              size="small"
              tableLayout="fixed"
              pagination={false}
              dataSource={draft.factTraces}
              columns={traceColumns}
              scroll={{ x: 920 }}
            />
          </section>
        </div>
      ) : null}
    </>
  );
}
