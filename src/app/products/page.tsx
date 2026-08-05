"use client";

import { ArrowRightOutlined, ExperimentOutlined, GlobalOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Progress, Space, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import type { ProductGeoOverview } from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";

interface ProductListResponse {
  ok: true;
  products: ProductRegistryItem[];
  overviews: ProductGeoOverview[];
}

function stageProgress(overview?: ProductGeoOverview) {
  if (!overview?.projectStatus) return 15;
  if (!overview.hasSourceSnapshot) return 30;
  if (overview.blueprintStatus === "approved") return 100;
  if (overview.blueprintStatus === "pending_review") return 85;
  if (overview.latestRunStatus) return 58;
  return 42;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRegistryItem[]>([]);
  const [overviews, setOverviews] = useState<ProductGeoOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await callJsonApi<ProductListResponse>("/api/v5/products", { cache: "no-store" });
      setProducts(result.products || []);
      setOverviews(result.overviews || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "产品列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title="产品与资料"
        subtitle="先创建产品或服务，再在对应页面持续补充资料；知识整理、索引和治理由系统自动完成。"
        actions={<Space wrap>
          <Link href="/products/sources"><Button icon={<GlobalOutlined />}>持续采集</Button></Link>
          <Link href="/products/new"><Button type="primary" icon={<PlusOutlined />}>创建产品/服务</Button></Link>
        </Space>}
      />
      <PageErrorState message={error} loading={loading && !products.length} onRetry={refresh} />
      <Card className="foundation-panel" bordered={false}>
        <Table
          rowKey="productId"
          loading={loading}
          dataSource={products}
          locale={{
            emptyText: (
              <ActionEmpty
                title="还没有已登记产品"
                description="先创建产品或服务，再直接导入第一批真实资料。"
                action={<Link href="/products/new"><Button type="primary">创建产品/服务</Button></Link>}
              />
            )
          }}
          columns={[
            {
              title: "产品",
              render: (_, record) => (
                <Space direction="vertical" size={2}>
                  <Link href={`/products/${record.productId}`}>
                    <Typography.Text strong>{record.displayName}</Typography.Text>
                  </Link>
                  <Typography.Text type="secondary">{record.canonicalName}</Typography.Text>
                </Space>
              )
            },
            {
              title: "资料准备",
              width: 240,
              render: (_, record) => {
                const overview = overviews.find((item) => item.productId === record.productId);
                const progress = stageProgress(overview);
                return (
                  <div style={{ minWidth: 190 }}>
                    <Progress
                      percent={progress}
                      showInfo={false}
                      size="small"
                      strokeColor={progress === 100 ? "#15916f" : "#3867b7"}
                    />
                    <Typography.Text type="secondary">
                      {overview?.hasSourceSnapshot ? "资料已进入系统治理" : "等待第一批真实资料"}
                    </Typography.Text>
                  </div>
                );
              }
            },
            {
              title: "资料状态",
              width: 200,
              render: (_, record) => {
                const overview = overviews.find((item) => item.productId === record.productId);
                return (
                  <Space wrap>
                    <Tag color={overview?.hasSourceSnapshot ? "green" : "gold"}>
                      {overview?.hasSourceSnapshot ? `${overview.sourceCount} 个资料源` : "待导入资料"}
                    </Tag>
                    {overview?.latestRunStatus ? <Tag>{overview.latestRunStatus}</Tag> : null}
                  </Space>
                );
              }
            },
            {
              title: "产品品类",
              dataIndex: "productCategory",
              width: 150,
              render: (value) => value || "待补充"
            },
            {
              title: "操作",
              width: 270,
              render: (_, record) => {
                const overview = overviews.find((item) => item.productId === record.productId);
                return (
                  <Space wrap>
                    <Link href={`/products/${record.productId}?tab=materials`}>
                      <Button icon={<ArrowRightOutlined />} iconPosition="end" size="small">
                        {overview?.hasSourceSnapshot ? "管理资料" : "导入资料"}
                      </Button>
                    </Link>
                    <Link href={`/products/${record.productId}/research`}>
                      <Button icon={<ExperimentOutlined />} size="small">GEO 进程</Button>
                    </Link>
                  </Space>
                );
              }
            }
          ]}
        />
      </Card>
    </>
  );
}
