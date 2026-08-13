"use client";

import {
  FileAddOutlined,
  GlobalOutlined,
  PlusOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { Button, Card, Drawer, Space, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type {
  ProductKnowledgeItemStatus,
  ProductKnowledgeStatus,
  ProductWorkflowStage,
  ProductWorkflowSummary
} from "@/lib/v5/product-workflow-summary";

interface ProductListResponse {
  ok: true;
  products: ProductRegistryItem[];
  workflowSummaries: ProductWorkflowSummary[];
}

const knowledgeStatusPresentation: Record<ProductKnowledgeStatus, { label: string; color: string }> = {
  empty: { label: "未导入", color: "default" },
  incomplete: { label: "待补充", color: "gold" },
  source_blocked: { label: "来源异常", color: "red" },
  research_ready: { label: "可用于调研", color: "green" },
  stale: { label: "需要更新", color: "orange" }
};

const itemStatusPresentation: Record<ProductKnowledgeItemStatus, { label: string; color: string }> = {
  complete: { label: "已确认", color: "green" },
  partial: { label: "部分完整", color: "gold" },
  missing: { label: "缺失", color: "red" },
  conflicted: { label: "存在冲突", color: "red" },
  stale: { label: "需要更新", color: "orange" }
};

const stageLabels: Record<ProductWorkflowStage, string> = {
  knowledge: "资料建设",
  research: "GEO 调研",
  strategy: "策略确认",
  production_setup: "生产准备",
  production: "自动化生产"
};

function formatDate(value?: string) {
  if (!value) return "尚无更新记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function missingLabels(summary: ProductWorkflowSummary) {
  return summary.knowledgeBase.items
    .filter((item) => item.status !== "complete")
    .map((item) => item.label);
}

function KnowledgeReadinessDrawer({
  summary,
  onClose
}: {
  summary?: ProductWorkflowSummary;
  onClose: () => void;
}) {
  const knowledge = summary?.knowledgeBase;
  const presentation = knowledge ? knowledgeStatusPresentation[knowledge.status] : undefined;

  return (
    <Drawer
      className="product-readiness-drawer"
      open={Boolean(summary)}
      onClose={onClose}
      width={560}
      title={summary ? `${summary.productName}·知识库检查` : "知识库检查"}
      footer={summary ? (
        <div className="product-readiness-footer">
          <div>
            <Typography.Text strong>当前状态：{presentation?.label}</Typography.Text>
            <Typography.Text type="secondary">补充后系统会重新解析并生成新资料快照。</Typography.Text>
          </div>
          <Link href={`/products/${encodeURIComponent(summary.productId)}?tab=information&addMaterials=1`}>
            <Button type="primary" icon={<FileAddOutlined />}>补充资料</Button>
          </Link>
        </div>
      ) : null}
    >
      {summary && knowledge ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div className="product-readiness-summary">
            <div>
              <Typography.Text type="secondary">知识库状态</Typography.Text>
              <strong>{presentation?.label}</strong>
            </div>
            <div>
              <Typography.Text type="secondary">必需资料</Typography.Text>
              <strong>{knowledge.coveredCategoryCount}/{knowledge.requiredCategoryCount} 类已确认</strong>
            </div>
            <div>
              <Typography.Text type="secondary">正式来源</Typography.Text>
              <strong>{knowledge.officialSourceCount} 个</strong>
            </div>
          </div>

          {knowledge.status !== "research_ready" ? (
            <div className="product-readiness-impact">
              <WarningOutlined />
              <div>
                <strong>当前暂不能启动正式 GEO 调研</strong>
                <span>{summary.statusDescription}</span>
              </div>
            </div>
          ) : null}

          <div className="product-readiness-list">
            {knowledge.items.map((item) => {
              const status = itemStatusPresentation[item.status];
              return (
                <section className={`product-readiness-item is-${item.status}`} key={item.code}>
                  <header>
                    <div>
                      <strong>{item.label}</strong>
                      {item.factCount > 0 ? <span>{item.factCount} 条已识别信息</span> : null}
                    </div>
                    <Tag color={status.color}>{status.label}</Tag>
                  </header>
                  <Typography.Paragraph>{item.reason}</Typography.Paragraph>
                  {item.status !== "complete" ? (
                    <div className="product-readiness-guidance">
                      <span><b>影响：</b>{item.impact}</span>
                      <span><b>建议补充：</b>{item.requestedInputs.join("、")}</span>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          <Typography.Text type="secondary">
            最近更新：{formatDate(knowledge.updatedAt)}。正在执行的任务仍使用启动时绑定的资料快照。
          </Typography.Text>
        </Space>
      ) : null}
    </Drawer>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRegistryItem[]>([]);
  const [summaries, setSummaries] = useState<ProductWorkflowSummary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<ProductWorkflowSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await callJsonApi<ProductListResponse>("/api/v5/products", { cache: "no-store" });
      setProducts(result.products || []);
      setSummaries(result.workflowSummaries || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "产品知识库加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const summaryByProduct = useMemo(
    () => new Map(summaries.map((item) => [item.productId, item])),
    [summaries]
  );
  return (
    <>
      <PageHeader
        title="产品知识库与 GEO 调研"
        subtitle="查看每个产品的资料准备情况、自动化阶段和当前唯一的下一步。"
        actions={<Space wrap>
          <Link href="/products/sources"><Button icon={<GlobalOutlined />}>资料采集</Button></Link>
          <Link href="/products/new"><Button type="primary" icon={<PlusOutlined />}>新建产品</Button></Link>
        </Space>}
      />

      <PageErrorState message={error} loading={loading && !products.length} onRetry={refresh} />

      <Card className="foundation-panel product-workflow-table-card" bordered={false}>
        <div className="product-workflow-table-heading">
          <div>
            <Typography.Title level={4}>全部产品知识库</Typography.Title>
            <Typography.Text type="secondary">每行只保留一个主操作；你也可以随时补充产品资料。</Typography.Text>
          </div>
          <Typography.Text type="secondary">共 {products.length} 个产品</Typography.Text>
        </div>
        <Table
          rowKey="productId"
          loading={loading}
          dataSource={products}
          pagination={false}
          scroll={{ x: 1080 }}
          locale={{
            emptyText: (
              <ActionEmpty
                title="还没有产品知识库"
                description="新建产品并导入第一批真实资料，系统会自动检查下一步条件。"
                action={<Link href="/products/new"><Button type="primary">新建产品</Button></Link>}
              />
            )
          }}
          columns={[
            {
              title: "产品知识库",
              width: 230,
              render: (_, record) => (
                <div className="product-workflow-product-cell">
                  <Link href={`/products/${encodeURIComponent(record.productId)}?tab=information`}>
                    <Typography.Text strong>{record.displayName}</Typography.Text>
                  </Link>
                  <Typography.Text type="secondary">{record.officialEntity || record.productCategory || "所属主体待确认"}</Typography.Text>
                </div>
              )
            },
            {
              title: "知识库状态",
              width: 180,
              render: (_, record) => {
                const summary = summaryByProduct.get(record.productId);
                if (!summary) return <Tag>状态整理中</Tag>;
                const status = knowledgeStatusPresentation[summary.knowledgeBase.status];
                const missing = missingLabels(summary);
                return (
                  <button type="button" className="product-knowledge-status-button" onClick={() => setSelectedSummary(summary)}>
                    <span><Tag color={status.color}>{status.label}</Tag><b>{summary.knowledgeBase.coveredCategoryCount}/6</b></span>
                    <small>{missing.length ? `缺少：${missing.slice(0, 2).join("、")}${missing.length > 2 ? ` 等 ${missing.length} 项` : ""}` : "资料类别和来源门禁已通过"}</small>
                  </button>
                );
              }
            },
            {
              title: "当前阶段",
              width: 150,
              render: (_, record) => {
                const summary = summaryByProduct.get(record.productId);
                return summary ? <Tag className={`product-stage-tag is-${summary.workflowStage}`}>{stageLabels[summary.workflowStage]}</Tag> : "—";
              }
            },
            {
              title: "当前情况",
              width: 290,
              render: (_, record) => {
                const summary = summaryByProduct.get(record.productId);
                return summary ? (
                  <div className="product-workflow-description">
                    <strong>{summary.nextAction.label}</strong>
                    <span>{summary.statusDescription}</span>
                  </div>
                ) : <Typography.Text type="secondary">系统正在整理产品状态。</Typography.Text>;
              }
            },
            {
              title: "操作",
              width: 300,
              fixed: "right",
              render: (_, record) => {
                const summary = summaryByProduct.get(record.productId);
                if (!summary) return null;
                const supplementIsPrimary = ["import_materials", "complete_materials", "resolve_source_issue"].includes(summary.nextAction.type);
                return (
                  <Space wrap size={8} className="product-workflow-actions">
                    <Link href={supplementIsPrimary ? `/products/${encodeURIComponent(record.productId)}?tab=information&addMaterials=1` : summary.nextAction.href}>
                      <Button type="primary" size="small">{summary.nextAction.label}</Button>
                    </Link>
                    {!supplementIsPrimary ? (
                      <Link href={`/products/${encodeURIComponent(record.productId)}?tab=information&addMaterials=1`}>
                        <Button icon={<FileAddOutlined />} size="small" aria-label={`为 ${record.displayName} 补充资料`}>补充资料</Button>
                      </Link>
                    ) : null}
                  </Space>
                );
              }
            }
          ]}
        />
      </Card>

      <KnowledgeReadinessDrawer summary={selectedSummary} onClose={() => setSelectedSummary(undefined)} />
    </>
  );
}
