"use client";

import {
  ArrowLeftOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileAddOutlined,
  FileTextOutlined,
  SolutionOutlined
} from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Space, Tabs, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageErrorState } from "@/components/PageErrorState";
import {
  ProductMaterialImport,
  type ProductMaterialImportResult,
  type ProductMaterialTarget
} from "@/components/ProductMaterialImport";
import { ProductGeoResearchWorkspace } from "@/components/ProductGeoResearchWorkspace";
import { ProductGeoStrategyPanel } from "@/components/ProductGeoStrategyPanel";
import { ProductRolloutReadinessPanel } from "@/components/ProductRolloutReadinessPanel";
import { ProductSampleArticlePanel } from "@/components/ProductSampleArticlePanel";
import { callJsonApi } from "@/lib/client-api";
import type { ProductKnowledgeProfile, ProductKnowledgeProfileFact } from "@/lib/v5/product-knowledge-profile";
import type { ProductMaterialSummary } from "@/lib/v5/product-material-summary";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { ProductWorkflowSummary } from "@/lib/v5/product-workflow-summary";

interface ProductWorkspaceResponse {
  ok: true;
  product: ProductRegistryItem;
  productProfile: ProductKnowledgeProfile;
  workflowSummary: ProductWorkflowSummary;
  materialSummary: ProductMaterialSummary;
}

interface UpdateProductResponse {
  ok: true;
  product: ProductRegistryItem;
  message: string;
}

function formatDate(value?: string) {
  if (!value) return "暂无更新记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function factLines(facts?: ProductKnowledgeProfileFact[]) {
  return (facts || []).map((fact) => fact.text).join("\n");
}

function editedLines(value: unknown) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function workflowStatusLabel(summary: ProductWorkflowSummary) {
  if (summary.workflowStage === "knowledge") return "待补充资料";
  if (summary.workflowStage === "research") return summary.currentRunId ? "GEO 调研中" : "待 GEO 调研";
  if (summary.workflowStage === "strategy") return "待确认策略";
  if (summary.workflowStage === "production_setup") return "待完成生产准备";
  return "自动化生产中";
}

function ProductInformationSection({
  title,
  facts,
  parsed,
  children
}: {
  title: string;
  facts?: ProductKnowledgeProfileFact[];
  parsed: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="product-information-section">
      <Typography.Title level={5}>{title}</Typography.Title>
      {!parsed ? (
        <Typography.Text type="secondary">待资料解析</Typography.Text>
      ) : children ? children : facts?.length ? (
        <ul>
          {facts.map((fact) => <li key={fact.claimId}>{fact.text}</li>)}
        </ul>
      ) : (
        <Typography.Text type="secondary">资料中暂未识别</Typography.Text>
      )}
    </section>
  );
}

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedGeoView = searchParams.get("geoView");
  const shouldAddMaterials = searchParams.get("addMaterials") === "1";
  const activeTab = ["geo", "research", "strategy"].includes(requestedTab || "") ? "geo" : "information";
  const activeGeoView = requestedTab === "strategy" || requestedGeoView === "strategy" ? "strategy" : "research";
  const [data, setData] = useState<ProductWorkspaceResponse>();
  const [productForm] = Form.useForm();
  const [messageApi, messageContext] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [importQueued, setImportQueued] = useState(false);

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const response = await callJsonApi<ProductWorkspaceResponse>(`/api/v5/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
      setData(response);
      if (response.materialSummary.status !== "processing") setImportQueued(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "产品页面加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (shouldAddMaterials) setMaterialModalOpen(true);
  }, [shouldAddMaterials]);

  useEffect(() => {
    if (!importQueued) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [importQueued, refresh]);

  const handleMaterialImported = useCallback(async (
    _target: ProductMaterialTarget,
    result: ProductMaterialImportResult
  ) => {
    setMaterialModalOpen(false);
    setImportQueued(result.pipelineStatus === "queued");
    await refresh();
  }, [refresh]);

  const fillProductEditor = useCallback(() => {
    if (!data?.product) return;
    productForm.setFieldsValue({
      canonicalName: data.product.canonicalName,
      displayName: data.product.displayName,
      brandName: data.product.brandName || "",
      officialEntity: data.product.officialEntity || "",
      officialUrl: data.product.officialUrl || "",
      productCategory: data.product.productCategory || "",
      entityRelationship: data.product.entityRelationship || "",
      aliasesText: data.product.aliases.join("\n"),
      positioningText: factLines(data.productProfile.positioning),
      audiencesText: factLines(data.productProfile.audiences),
      capabilitiesText: factLines(data.productProfile.capabilities),
      scenariosText: factLines(data.productProfile.scenarios),
      boundariesText: factLines(data.productProfile.boundaries)
    });
  }, [data, productForm]);

  const openProductEditor = useCallback(() => {
    if (!data?.product) return;
    setProductModalOpen(true);
  }, [data?.product]);

  const saveProductInformation = useCallback(async () => {
    if (!data?.product) return;
    const values = await productForm.validateFields();
    setProductSaving(true);
    try {
      const aliases = String(values.aliasesText || "")
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const response = await callJsonApi<UpdateProductResponse>(`/api/v5/products/${encodeURIComponent(productId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          canonicalName: values.canonicalName,
          displayName: values.displayName,
          brandName: values.brandName,
          officialEntity: values.officialEntity,
          officialUrl: values.officialUrl,
          productCategory: values.productCategory,
          entityRelationship: values.entityRelationship,
          aliases,
          knowledgeProfile: {
            positioning: editedLines(values.positioningText),
            audiences: editedLines(values.audiencesText),
            capabilities: editedLines(values.capabilitiesText),
            scenarios: editedLines(values.scenariosText),
            boundaries: editedLines(values.boundariesText),
            sourceFactCount: data.productProfile.factCount
          },
          expectedVersion: data.product.rowVersion,
          idempotencyKey: crypto.randomUUID(),
          auditReason: "用户在产品详情页人工确认并修改产品信息"
        })
      });
      setData((current) => current ? { ...current, product: response.product } : current);
      setProductModalOpen(false);
      messageApi.success(response.message || "产品信息已保存。");
      await refresh();
    } catch (saveError) {
      messageApi.error(saveError instanceof Error ? saveError.message : "产品信息保存失败，请检查后重试。");
    } finally {
      setProductSaving(false);
    }
  }, [data?.product, data?.productProfile.factCount, messageApi, productForm, productId, refresh]);

  const profileParsed = data?.productProfile.status === "ready";
  const materialStatus = importQueued ? "资料解析中" : data?.materialSummary.statusLabel;
  const currentStatus = data?.workflowSummary ? workflowStatusLabel(data.workflowSummary) : "状态整理中";

  return (
    <>
      {messageContext}
      <PageErrorState message={error} loading={loading && !data} onRetry={refresh} />

      {data?.product ? (
        <>
          <Card bordered={false} className="product-detail-hero">
            <div className="product-detail-actions">
              <Space wrap>
                <Button type="primary" icon={<FileAddOutlined />} onClick={() => setMaterialModalOpen(true)}>添加资料</Button>
                <Link href="/products"><Button icon={<ArrowLeftOutlined />}>返回</Button></Link>
              </Space>
            </div>
            <Typography.Text className="product-detail-kicker">当前产品</Typography.Text>
            <Typography.Title level={2}>{data.product.displayName}</Typography.Title>
            <div className="product-detail-meta">
              <span><FileTextOutlined /> {data.materialSummary.materialCount} 份资料</span>
              <Tag color={data.workflowSummary.workflowStage === "knowledge" ? "gold" : "blue"}>{currentStatus}</Tag>
            </div>
          </Card>

          <Tabs
            className="product-workspace-tabs product-detail-tabs"
            activeKey={activeTab}
            items={[
              {
                key: "information",
                label: <span><FileTextOutlined /> 资料与信息</span>,
                children: (
                  <Space direction="vertical" size={18} style={{ width: "100%" }}>
                    <Card bordered={false} title="资料状态" className="product-information-card">
                      <Descriptions column={{ xs: 1, sm: 3 }}>
                        <Descriptions.Item label="处理状态">
                          <Tag color={materialStatus === "资料解析中" ? "processing" : data.materialSummary.status === "attention" ? "warning" : "default"}>
                            {materialStatus}
                          </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="资料数量">{data.materialSummary.materialCount} 份</Descriptions.Item>
                        <Descriptions.Item label="最近更新">
                          {data.materialSummary.latestUpdate ? (
                            <div className="product-latest-update">
                              {data.materialSummary.latestUpdate.sourceUrl ? (
                                <a href={data.materialSummary.latestUpdate.sourceUrl} target="_blank" rel="noreferrer">
                                  {data.materialSummary.latestUpdate.sourceLabel}
                                </a>
                              ) : <span>{data.materialSummary.latestUpdate.sourceLabel}</span>}
                              <small>{formatDate(data.materialSummary.latestUpdate.updatedAt)}</small>
                            </div>
                          ) : "暂无更新记录"}
                        </Descriptions.Item>
                      </Descriptions>
                      {importQueued || data.materialSummary.status === "processing" ? (
                        <Alert showIcon type="info" message="资料已导入，系统正在解析" description="解析完成后，产品信息会在下方自动更新。你可以关闭页面，后台处理不会中断。" />
                      ) : data.materialSummary.status === "empty" ? (
                        <Alert showIcon type="info" message="尚未导入资料" description="点击右上角“添加资料”，可粘贴网页链接或上传文件。" />
                      ) : data.materialSummary.status === "attention" ? (
                        <Alert showIcon type="warning" message="资料处理需要你的关注" description="请补充有效资料或检查最近导入的资料。" />
                      ) : null}
                    </Card>

                    <Card
                      bordered={false}
                      title="产品信息"
                      extra={<Space wrap>{data.productProfile.source === "human_corrected" ? <Tag color="blue">人工已校正 v{data.productProfile.overrideVersion}</Tag> : null}<Button icon={<EditOutlined />} onClick={openProductEditor}>编辑产品信息</Button></Space>}
                      className="product-information-card"
                    >
                      <div className="product-information-grid">
                        <ProductInformationSection title="产品身份" parsed>
                          <Descriptions column={1} size="small" colon={false}>
                            <Descriptions.Item label="产品名称">{data.product.displayName}</Descriptions.Item>
                            <Descriptions.Item label="所属品牌">{data.product.brandName || "待人工确认"}</Descriptions.Item>
                            <Descriptions.Item label="所属主体">{data.product.officialEntity || "资料中暂未识别"}</Descriptions.Item>
                            <Descriptions.Item label="产品分类">{data.product.productCategory || "待人工确认"}</Descriptions.Item>
                            <Descriptions.Item label="身份与关联实体">{data.product.entityRelationship || "待人工确认"}</Descriptions.Item>
                            <Descriptions.Item label="官方地址">
                              {data.product.officialUrl ? <a href={data.product.officialUrl} target="_blank" rel="noreferrer">{data.product.officialUrl}</a> : "资料中暂未识别"}
                            </Descriptions.Item>
                            <Descriptions.Item label="别名">
                              {data.product.aliases.length
                                ? <Space size={[4, 4]} wrap>{data.product.aliases.map((alias) => <Tag key={alias}>{alias}</Tag>)}</Space>
                                : "暂无"}
                            </Descriptions.Item>
                          </Descriptions>
                        </ProductInformationSection>
                        <ProductInformationSection title="核心定位" facts={data.productProfile.positioning} parsed={profileParsed} />
                        <ProductInformationSection title="目标用户" facts={data.productProfile.audiences} parsed={profileParsed} />
                        <ProductInformationSection title="核心能力" facts={data.productProfile.capabilities} parsed={profileParsed} />
                        <ProductInformationSection title="使用场景" facts={data.productProfile.scenarios} parsed={profileParsed} />
                        <ProductInformationSection title="条件与边界" facts={data.productProfile.boundaries} parsed={profileParsed} />
                      </div>
                    </Card>
                  </Space>
                )
              },
              {
                key: "geo",
                label: <span><ExperimentOutlined /> GEO 调研</span>,
                children: (
                  <Tabs
                    className="product-geo-subtabs"
                    activeKey={activeGeoView}
                    items={[
                      {
                        key: "research",
                        label: <span><ExperimentOutlined /> 调研工作区</span>,
                        children: <ProductGeoResearchWorkspace productId={productId} embedded />
                      },
                      {
                        key: "strategy",
                        label: <span><SolutionOutlined /> GEO 策略</span>,
                        children: (
                          <Space direction="vertical" size={16} style={{ width: "100%" }}>
                            <ProductGeoStrategyPanel productId={productId} />
                            <ProductSampleArticlePanel productId={productId} />
                            <ProductRolloutReadinessPanel productId={productId} />
                          </Space>
                        )
                      }
                    ]}
                    onChange={(key) => router.replace(`/products/${encodeURIComponent(productId)}?tab=geo&geoView=${key}`, { scroll: false })}
                  />
                )
              }
            ]}
            onChange={(key) => router.replace(`/products/${encodeURIComponent(productId)}?tab=${key}${key === "geo" ? `&geoView=${activeGeoView}` : ""}`, { scroll: false })}
          />

          <Modal
            title="编辑产品信息"
            open={productModalOpen}
            afterOpenChange={(open) => { if (open) fillProductEditor(); }}
            onCancel={() => setProductModalOpen(false)}
            onOk={() => void saveProductInformation()}
            okText="保存更改"
            cancelText="取消"
            confirmLoading={productSaving}
            width={920}
            destroyOnClose
          >
            <Alert
              showIcon
              type="info"
              message={`已带入当前解析结果${data.productProfile.factCount ? `（基于 ${data.productProfile.factCount} 条事实）` : ""}`}
              description="只修改不准确或缺失的内容，无需重新填写。保存后会生成一版独立的人工校正快照；原始资料和解析证据仍保留，后续重新解析不会覆盖人工版本。"
              style={{ marginBottom: 20 }}
            />
            <Form form={productForm} layout="vertical" preserve={false}>
              <Typography.Title level={5} className="product-profile-editor-heading">产品身份</Typography.Title>
              <div className="product-information-edit-grid">
                <Form.Item label="规范名称" name="canonicalName" rules={[{ required: true, message: "请输入规范名称" }]}>
                  <Input placeholder="例如：Noteflow" />
                </Form.Item>
                <Form.Item label="页面显示名称" name="displayName" rules={[{ required: true, message: "请输入显示名称" }]}>
                  <Input placeholder="例如：Noteflow" />
                </Form.Item>
                <Form.Item label="所属品牌" name="brandName">
                  <Input placeholder="例如：JOTO.AI" />
                </Form.Item>
                <Form.Item label="所属主体" name="officialEntity">
                  <Input placeholder="例如：上海聚托信息科技有限公司" />
                </Form.Item>
                <Form.Item label="产品分类" name="productCategory">
                  <Input placeholder="例如：AI 知识管理平台" />
                </Form.Item>
                <Form.Item label="官方地址" name="officialUrl" rules={[{ type: "url", warningOnly: false, message: "请输入完整的 HTTP/HTTPS 地址" }]}>
                  <Input placeholder="https://example.com/" />
                </Form.Item>
              </div>
              <Form.Item label="产品别名" name="aliasesText" extra="每行一个，也可以用逗号分隔。系统会自动保留规范名称和显示名称。">
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder={'NoteFlow\nJOTO Noteflow'} />
              </Form.Item>
              <Form.Item
                label="身份与关联实体"
                name="entityRelationship"
                extra="用于纠正产品归属、关联产品和 JOTO 的服务关系。人工确认后优先于模型推断。"
              >
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={2000} placeholder="例如：WorkBuddy 和腾讯云 ADP 均属于腾讯旗下产品；JOTO 提供 WorkBuddy 专项落地服务。" />
              </Form.Item>
              <Typography.Title level={5} className="product-profile-editor-heading">解析模块</Typography.Title>
              <Typography.Paragraph type="secondary" className="product-profile-editor-help">每行是一条独立信息。可以直接修改、删除错误条目，或补充解析遗漏的内容。</Typography.Paragraph>
              <div className="product-profile-module-edit-grid">
                <Form.Item label="核心定位" name="positioningText">
                  <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} placeholder="资料中暂未识别，可在这里补充" />
                </Form.Item>
                <Form.Item label="目标用户" name="audiencesText">
                  <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} placeholder="资料中暂未识别，可在这里补充" />
                </Form.Item>
                <Form.Item label="核心能力" name="capabilitiesText">
                  <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} placeholder="资料中暂未识别，可在这里补充" />
                </Form.Item>
                <Form.Item label="使用场景" name="scenariosText">
                  <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} placeholder="资料中暂未识别，可在这里补充" />
                </Form.Item>
                <Form.Item label="条件与边界" name="boundariesText" className="product-profile-module-wide">
                  <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} placeholder="资料中暂未识别，可在这里补充" />
                </Form.Item>
              </div>
            </Form>
          </Modal>

          <Modal
            open={materialModalOpen}
            onCancel={() => setMaterialModalOpen(false)}
            footer={null}
            width={980}
            destroyOnClose
            className="product-material-modal"
          >
            <ProductMaterialImport
              productId={data.product.productId}
              productName={data.product.displayName}
              officialUrl={data.product.officialUrl}
              onImported={handleMaterialImported}
            />
          </Modal>
        </>
      ) : null}
    </>
  );
}
