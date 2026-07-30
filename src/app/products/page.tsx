"use client";

import { ArrowRightOutlined, PlusOutlined } from "@ant-design/icons";
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

const nextActionCopy: Record<ProductGeoOverview["nextAction"], string> = {
  create_project: "补充研究边界",
  add_sources: "导入产品资料",
  configure_provider: "配置联网研究",
  review_blueprint: "审核 GEO 蓝图",
  open_run: "查看研究进度",
  start_research: "启动 GEO 调研",
  monthly_strategy: "进入月度策略"
};

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
        title="产品与 GEO 调研"
        subtitle="先确认产品身份与表达重点，再用真实资料和联网证据形成 GEO 内容铺设蓝图。"
        actions={
          <Link href="/products/new">
            <Button type="primary" icon={<PlusOutlined />}>新增产品并创建调研</Button>
          </Link>
        }
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
                description="新增第一个产品，提交基础资料与表达重点后进入 GEO 前置调研。"
                action={<Link href="/products/new"><Button type="primary">新增产品</Button></Link>}
              />
            )
          }}
          columns={[
            {
              title: "产品",
              render: (_, record) => (
                <Space direction="vertical" size={2}>
                  <Link href={`/products/${record.productId}/research`}>
                    <Typography.Text strong>{record.displayName}</Typography.Text>
                  </Link>
                  <Typography.Text type="secondary">{record.canonicalName}</Typography.Text>
                </Space>
              )
            },
            {
              title: "GEO 准入进度",
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
                      {overview ? nextActionCopy[overview.nextAction] : "读取状态"}
                    </Typography.Text>
                  </div>
                );
              }
            },
            {
              title: "资料与运行",
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
              width: 180,
              render: (_, record) => (
                <Link href={`/products/${record.productId}/research`}>
                  <Button icon={<ArrowRightOutlined />} iconPosition="end" size="small">
                    {nextActionCopy[overviews.find((item) => item.productId === record.productId)?.nextAction || "create_project"]}
                  </Button>
                </Link>
              )
            }
          ]}
        />
      </Card>
    </>
  );
}
