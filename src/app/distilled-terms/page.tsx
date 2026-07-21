"use client";

import { Alert, Button, Card, Drawer, Input, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { contentTypeLabels, productLabels } from "@/lib/labels";
import type { ContentTask, DistilledTerm, DistilledTermRuleDraft } from "@/lib/types";

type AutoPoolSource = "knowledge_base" | "all";

const levelLabels: Record<DistilledTerm["level"], string> = {
  core: "核心词",
  scenario: "场景词",
  product: "产品词"
};

const statusLabels: Record<DistilledTerm["status"], string> = {
  active: "已入池",
  watching: "观察中",
  disabled: "已删除"
};

const statusColors: Record<DistilledTerm["status"], string> = {
  active: "green",
  watching: "gold",
  disabled: "default"
};

const generationModeLabels: Record<NonNullable<DistilledTerm["generationMode"]>, string> = {
  knowledge_base: "知识库自动生成",
  search_question: "搜索问题生成",
  manual_seed: "系统预置"
};

const validationStatusLabels: Record<DistilledTerm["validationStatus"], string> = {
  auto_validated: "已自动入池",
  pending: "待观察",
  disabled: "已删除"
};

const validationStatusColors: Record<DistilledTerm["validationStatus"], string> = {
  auto_validated: "green",
  pending: "gold",
  disabled: "default"
};

function getTermUsage(term: DistilledTerm, tasks: ContentTask[]) {
  return tasks.filter((task) => task.primaryDistilledTerm === term.term || task.targetKeywords.includes(term.term));
}

export default function DistilledTermsPage() {
  const {
    state: { distilledTerms, distilledTermRuleDrafts, tasks },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchQuestion, setSearchQuestion] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [autoPoolingSource, setAutoPoolingSource] = useState<AutoPoolSource>();
  const [selectedTerm, setSelectedTerm] = useState<DistilledTerm>();
  const [handlingTermId, setHandlingTermId] = useState<string>();
  const [handlingRuleDraftId, setHandlingRuleDraftId] = useState<string>();
  const visibleTerms = distilledTerms.filter((term) => term.status !== "disabled");
  const pendingRuleDrafts = (distilledTermRuleDrafts || []).filter((draft) => draft.status === "pending");
  const autoPooledCount = distilledTerms.filter((term) => term.status !== "disabled" && term.validationStatus === "auto_validated").length;
  const searchQuestionSuccessCount = distilledTerms.filter((term) => term.status !== "disabled" && term.generationMode === "search_question").length;
  const knowledgeBaseGeneratedCount = distilledTerms.filter((term) => term.status !== "disabled" && term.generationMode === "knowledge_base").length;
  const usedTermCount = visibleTerms.filter((term) => getTermUsage(term, tasks).length > 0).length;
  const selectedTermUsage = useMemo(() => (selectedTerm ? getTermUsage(selectedTerm, tasks) : []), [selectedTerm, tasks]);

  async function handleExtractTerm() {
    const question = searchQuestion.trim();

    if (!question) {
      messageApi.warning("请先输入一个真实搜索问题。");
      return;
    }

    setExtracting(true);

    try {
      const result = await callJsonApi<{ data?: { discarded?: boolean; confidence: number; term?: DistilledTerm; ruleDraft?: DistilledTermRuleDraft } }>("/api/distilled-terms/extract", {
        method: "POST",
        body: JSON.stringify({ question })
      });
      await refresh();

      if (result.data?.discarded) {
        messageApi.warning("候选词未通过入池阈值，已直接丢弃。");
        return;
      }

      if (result.data?.ruleDraft) {
        messageApi.success(formatApiMessage(result, "已生成待确认规则建议。"));
        setSearchQuestion("");
        return;
      }

      messageApi.success(formatApiMessage(result, "蒸馏词已自动入池。"));
      setSearchQuestion("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "提取蒸馏词失败");
    } finally {
      setExtracting(false);
    }
  }

  async function handleArchiveTerm(term: DistilledTerm) {
    setHandlingTermId(term.id);

    try {
      const result = await callJsonApi(`/api/distilled-terms/${term.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "蒸馏词已归档。"));
      setSelectedTerm(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "归档蒸馏词失败");
    } finally {
      setHandlingTermId(undefined);
    }
  }

  async function handleAutoPoolTerms(source: AutoPoolSource) {
    setAutoPoolingSource(source);

    try {
      const result = await callJsonApi<{
        data?: {
          createdCount: number;
          reusedCount: number;
          skippedCount: number;
          terms: DistilledTerm[];
          source: AutoPoolSource;
        };
      }>("/api/distilled-terms/auto-pool", {
        method: "POST",
        body: JSON.stringify({ source })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "蒸馏词自动入池已完成。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "自动入池失败");
    } finally {
      setAutoPoolingSource(undefined);
    }
  }

  async function handleDeleteTerm(term: DistilledTerm) {
    setHandlingTermId(term.id);

    try {
      const result = await callJsonApi(`/api/distilled-terms/${term.id}`, { method: "DELETE" });
      await refresh();
      messageApi.success(formatApiMessage(result, "蒸馏词已删除。"));
      setSelectedTerm(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除蒸馏词失败");
    } finally {
      setHandlingTermId(undefined);
    }
  }

  async function handleActivateRuleDraft(ruleDraft: DistilledTermRuleDraft) {
    setHandlingRuleDraftId(ruleDraft.id);

    try {
      const result = await callJsonApi(`/api/distilled-terms/rule-drafts/${ruleDraft.id}`, { method: "PATCH" });
      await refresh();
      messageApi.success(formatApiMessage(result, "规则建议已生效。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认规则建议失败");
    } finally {
      setHandlingRuleDraftId(undefined);
    }
  }

  async function handleDiscardRuleDraft(ruleDraft: DistilledTermRuleDraft) {
    setHandlingRuleDraftId(ruleDraft.id);

    try {
      const result = await callJsonApi(`/api/distilled-terms/rule-drafts/${ruleDraft.id}`, { method: "DELETE" });
      await refresh();
      messageApi.success(formatApiMessage(result, "规则建议已放弃。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "放弃规则建议失败");
    } finally {
      setHandlingRuleDraftId(undefined);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="蒸馏词池"
        subtitle="只展示已入池和观察中的蒸馏词；未通过入池阈值的候选直接丢弃，不进入业务前台。"
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid">
        <MetricCard title="自动入池" value={autoPooledCount} suffix="个" />
        <MetricCard title="搜索问题生成" value={searchQuestionSuccessCount} suffix="个" />
        <MetricCard title="知识库生成" value={knowledgeBaseGeneratedCount} suffix="个" />
        <MetricCard title="待确认规则" value={pendingRuleDrafts.length} suffix="条" />
        <MetricCard title="周计划调用" value={usedTermCount} suffix="个" />
      </div>
      <Card title="自动入池来源" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Button
              loading={autoPoolingSource === "knowledge_base"}
              onClick={() => handleAutoPoolTerms("knowledge_base")}
              data-testid="distilled-auto-pool-knowledge"
            >
              从知识库建议入池
            </Button>
            <Button type="primary" loading={autoPoolingSource === "all"} onClick={() => handleAutoPoolTerms("all")} data-testid="distilled-auto-pool-all">
              同步全部来源
            </Button>
          </Space>
          <Alert
            showIcon
            type="info"
            message="自动入池范围：已生效知识库规则包建议和真实搜索问题。"
            description="知识库草稿不会直接入池；搜索问题会优先命中已生效规则，未命中的高价值问题会生成待确认规则建议。"
          />
        </Space>
      </Card>
      <Card title="从搜索问题提取蒸馏词" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              data-testid="distilled-question-input"
              value={searchQuestion}
              onChange={(event) => setSearchQuestion(event.target.value)}
              placeholder="例如：企业想接入 Dify，但不知道怎么判断服务商是否具备长期交付能力"
              onPressEnter={handleExtractTerm}
            />
            <Button type="primary" loading={extracting} onClick={handleExtractTerm} data-testid="distilled-extract-button">
              AI 提取入池
            </Button>
          </Space.Compact>
          <Alert
            showIcon
            type="info"
            message="入池规则：达到阈值自动入池，未通过阈值直接丢弃。"
            description="明显无关问题会直接丢弃；能沉淀为长期规则的问题会进入待确认规则建议，确认后同类问题可自动入池。"
          />
        </Space>
      </Card>
      <Card title="待确认规则建议" style={{ marginBottom: 16 }} data-testid="distilled-rule-draft-card">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={pendingRuleDrafts}
          pagination={false}
          locale={{
            emptyText: <ActionEmpty title="暂无待确认规则" description="未命中现有规则但具备业务价值的问题，会先生成规则建议，确认后才生效。" />
          }}
          columns={[
            { title: "建议规则", dataIndex: "ruleName" },
            { title: "映射蒸馏词", dataIndex: "mappedTerm", render: (value, record) => <span data-testid={`distilled-rule-draft-term-${record.id}`}>{value}</span> },
            { title: "产品", dataIndex: "product", render: (value) => (value ? <Tag color="blue">{productLabels[value as keyof typeof productLabels]}</Tag> : "-") },
            { title: "覆盖问题", render: (_, record) => <Tag>{record.sourceQuestions.length}</Tag> },
            { title: "触发表达", render: (_, record) => record.patterns.slice(0, 3).map((pattern) => <Tag key={pattern}>{pattern}</Tag>) },
            {
              title: "操作",
              render: (_, record) => (
                <Space>
                  <Button
                    type="primary"
                    size="small"
                    loading={handlingRuleDraftId === record.id}
                    onClick={() => handleActivateRuleDraft(record)}
                    data-testid={`distilled-rule-draft-activate-${record.id}`}
                  >
                    确认生效
                  </Button>
                  <Popconfirm title="确认放弃这条规则建议？" description="放弃后不会进入提取链路，也不会创建蒸馏词。" onConfirm={() => handleDiscardRuleDraft(record)}>
                    <Button size="small" loading={handlingRuleDraftId === record.id} data-testid={`distilled-rule-draft-discard-${record.id}`}>
                      放弃
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
          expandable={{
            expandedRowRender: (record) => (
              <Space direction="vertical" style={{ width: "100%" }} data-testid={`distilled-rule-draft-detail-${record.id}`}>
                <Typography.Paragraph style={{ marginBottom: 0 }}>可能误伤：{record.riskNote}</Typography.Paragraph>
                <Typography.Paragraph style={{ marginBottom: 0 }}>来源问题：{record.sourceQuestions.join("；")}</Typography.Paragraph>
              </Space>
            )
          }}
        />
      </Card>
      <Card title="已入池蒸馏词">
        <div data-testid="distilled-term-table">
          <Table
            rowKey="id"
            loading={loading}
            dataSource={visibleTerms}
            locale={{
              emptyText: (
                <ActionEmpty
                  title="还没有可展示的蒸馏词"
                  description="后续由知识库解析、GEO 缺口或搜索问题提取自动入池。"
                />
              )
            }}
            columns={[
              { title: "蒸馏词", dataIndex: "term" },
              { title: "层级", dataIndex: "level", render: (value) => <Tag>{levelLabels[value as DistilledTerm["level"]]}</Tag> },
              { title: "产品", dataIndex: "product", render: (value) => (value ? <Tag color="blue">{productLabels[value as keyof typeof productLabels]}</Tag> : "-") },
              { title: "来源", dataIndex: "source" },
              {
                title: "入池方式",
                dataIndex: "generationMode",
                render: (value, record) => (
                  <Tag data-testid={`distilled-term-generation-mode-${record.id}`}>
                    {generationModeLabels[(value || "manual_seed") as NonNullable<DistilledTerm["generationMode"]>]}
                  </Tag>
                )
              },
              {
                title: "入池结果",
                dataIndex: "validationStatus",
                render: (value) => <Tag color={validationStatusColors[value as DistilledTerm["validationStatus"]]}>{validationStatusLabels[value as DistilledTerm["validationStatus"]]}</Tag>
              },
              { title: "状态", dataIndex: "status", render: (value) => <Tag color={statusColors[value as DistilledTerm["status"]]}>{statusLabels[value as DistilledTerm["status"]]}</Tag> },
              { title: "周计划调用", render: (_, record) => <Tag>{getTermUsage(record, tasks).length}</Tag> },
              {
                title: "操作",
                render: (_, record) => (
                  <Button size="small" onClick={() => setSelectedTerm(record)} data-testid={`distilled-term-detail-${record.id}`}>
                    查看
                  </Button>
                )
              }
            ]}
          />
        </div>
      </Card>
      <Drawer title="蒸馏词详情" open={Boolean(selectedTerm)} width={620} onClose={() => setSelectedTerm(undefined)}>
        {selectedTerm ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle" data-testid="distilled-term-detail-drawer">
            <Space wrap>
              <Tag>{levelLabels[selectedTerm.level]}</Tag>
              <Tag color={statusColors[selectedTerm.status]}>{statusLabels[selectedTerm.status]}</Tag>
              {selectedTerm.product ? <Tag color="blue">{productLabels[selectedTerm.product]}</Tag> : null}
              <Tag data-testid="distilled-term-detail-generation-mode">{generationModeLabels[selectedTerm.generationMode || "manual_seed"]}</Tag>
              <Tag color={validationStatusColors[selectedTerm.validationStatus]}>{validationStatusLabels[selectedTerm.validationStatus]}</Tag>
            </Space>
            <Typography.Title level={4} style={{ margin: 0 }} data-testid="distilled-term-detail-term">
              {selectedTerm.term}
            </Typography.Title>
            <Typography.Paragraph className="muted">来源：{selectedTerm.source}</Typography.Paragraph>
            {selectedTerm.sourceQuestion ? <Typography.Paragraph data-testid="distilled-term-detail-source-question">来源问题：{selectedTerm.sourceQuestion}</Typography.Paragraph> : null}
            {selectedTerm.sourceAssetId ? <Typography.Paragraph>来源资产：{selectedTerm.sourceAssetId}</Typography.Paragraph> : null}
            <Typography.Paragraph>覆盖内容类型：{selectedTerm.coveredContentTypes?.map((item) => contentTypeLabels[item]).join("、") || "待观察"}</Typography.Paragraph>
            <Alert showIcon type="info" message="规则：只展示已通过入池规则的蒸馏词；未通过阈值的候选直接丢弃，不进入业务前台。" />
            <Card size="small" title="使用记录">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={selectedTermUsage}
                locale={{ emptyText: <ActionEmpty title="暂无调用记录" description="当周计划标题或关键词引用该词后，会在这里形成使用记录。" /> }}
                columns={[
                  { title: "标题", dataIndex: "title" },
                  { title: "发布日期", dataIndex: "publishDate" },
                  { title: "内容类型", dataIndex: "contentType", render: (value) => contentTypeLabels[value as keyof typeof contentTypeLabels] }
                ]}
              />
            </Card>
            <Space>
              <Popconfirm title="确认删除这个蒸馏词？" description="删除后不会在业务前台展示，但操作会保留在审计记录中。" onConfirm={() => handleDeleteTerm(selectedTerm)}>
                <Button danger loading={handlingTermId === selectedTerm.id}>
                  删除
                </Button>
              </Popconfirm>
              <Button loading={handlingTermId === selectedTerm.id} onClick={() => handleArchiveTerm(selectedTerm)}>
                归档
              </Button>
            </Space>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
