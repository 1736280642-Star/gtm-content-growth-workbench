"use client";

import { ArrowLeftOutlined, ExperimentOutlined, FileTextOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Space, Tabs, Tag, Typography } from "antd";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageErrorState } from "@/components/PageErrorState";
import { ProductMaterialImport } from "@/components/ProductMaterialImport";
import { callJsonApi } from "@/lib/client-api";
import type { GeoResearchReadiness, GeoResearchWorkspace } from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";

interface ProductWorkspaceResponse {
  ok: true;
  product: ProductRegistryItem;
  workspace?: GeoResearchWorkspace;
  readiness: GeoResearchReadiness;
}

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab === "profile" || requestedTab === "geo" ? requestedTab : "materials";
  const [data, setData] = useState<ProductWorkspaceResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setData(await callJsonApi<ProductWorkspaceResponse>(`/api/v5/products/${encodeURIComponent(productId)}`, { cache: "no-store" }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "产品页面加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const snapshot = data?.readiness.latestSourceSnapshot;

  return (
    <>
      <PageErrorState message={error} loading={loading && !data} onRetry={refresh} />

      {data?.product ? (
        <>
          <Card bordered={false} className="product-material-hero">
            <div className="product-material-actions">
              <Space wrap>
                <Link href={`/products/${encodeURIComponent(productId)}/research`}><Button type="primary" icon={<ExperimentOutlined />}>查看 GEO 调研进程</Button></Link>
                <Link href="/products"><Button icon={<ArrowLeftOutlined />}>产品与资料</Button></Link>
              </Space>
            </div>
            <div className="product-material-summary">
              <div>
                <Typography.Text className="product-material-kicker">当前产品</Typography.Text>
                <Typography.Title level={2}>{data.product.displayName}</Typography.Title>
                <Typography.Paragraph>{data.workspace?.project.expressionFocus || "导入资料后，系统将从真实内容中整理产品身份、能力与表达边界。"}</Typography.Paragraph>
              </div>
              <div className="product-material-status">
                <span>资料状态</span>
                <strong>{snapshot ? `${snapshot.sourceCount} 个来源` : "等待第一批资料"}</strong>
                <Tag color={snapshot ? "green" : "gold"}>{snapshot ? "已形成资料快照" : "尚未导入"}</Tag>
              </div>
            </div>
          </Card>

          <Tabs
            className="product-workspace-tabs"
            activeKey={activeTab}
            items={[
              {
                key: "materials",
                label: <span><FileTextOutlined /> 资料</span>,
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Card bordered={false}>
                      <ProductMaterialImport
                        productId={data.product.productId}
                        productName={data.product.displayName}
                        officialUrl={data.product.officialUrl}
                        onImported={refresh}
                      />
                    </Card>
                    <Card bordered={false} title="资料处理状态">
                      {snapshot ? (
                        <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
                          <Descriptions.Item label="资料来源">{snapshot.sourceCount}</Descriptions.Item>
                          <Descriptions.Item label="资料版本">{snapshot.revisionCount}</Descriptions.Item>
                          <Descriptions.Item label="可用事实">{snapshot.approvedClaimCount}</Descriptions.Item>
                          <Descriptions.Item label="最近更新">{new Date(snapshot.createdAt).toLocaleString("zh-CN", { hour12: false })}</Descriptions.Item>
                        </Descriptions>
                      ) : (
                        <Alert showIcon type="info" message="导入第一批资料后，这里会显示处理进度和可用结果。" />
                      )}
                    </Card>
                  </Space>
                )
              },
              {
                key: "profile",
                label: <span><InfoCircleOutlined /> 产品信息</span>,
                children: (
                  <Card bordered={false}>
                    <Descriptions column={{ xs: 1, sm: 2 }}>
                      <Descriptions.Item label="规范名称">{data.product.canonicalName}</Descriptions.Item>
                      <Descriptions.Item label="类型">{data.product.productCategory === "service" ? "服务" : "产品"}</Descriptions.Item>
                      <Descriptions.Item label="官方主体">{data.product.officialEntity || "可稍后补充"}</Descriptions.Item>
                      <Descriptions.Item label="官网">
                        {data.product.officialUrl ? <a href={data.product.officialUrl} target="_blank" rel="noreferrer">{data.product.officialUrl}</a> : "可稍后补充"}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )
              },
              {
                key: "geo",
                label: <span><ExperimentOutlined /> GEO 调研</span>,
                children: (
                  <Card bordered={false}>
                    <Alert
                      showIcon
                      type={snapshot ? "success" : "warning"}
                      message={snapshot ? "资料已准备，可进入 GEO 调研" : "请先导入产品资料"}
                      description={snapshot
                        ? "GEO 调研将以当前资料快照为事实边界，继续发现用户问题、竞品和内容机会。"
                        : "没有真实资料快照时，系统不会凭空推断产品能力。"}
                      action={snapshot ? <Link href={`/products/${encodeURIComponent(productId)}/research`}><Button type="primary">进入 GEO 调研</Button></Link> : undefined}
                    />
                  </Card>
                )
              }
            ]}
            onChange={(key) => router.replace(`/products/${encodeURIComponent(productId)}?tab=${key}`, { scroll: false })}
          />
        </>
      ) : null}
    </>
  );
}
