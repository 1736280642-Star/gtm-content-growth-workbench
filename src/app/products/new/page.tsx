"use client";

import { ArrowLeftOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Radio, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  ProductMaterialImport,
  type ProductMaterialDraft,
  type ProductMaterialTarget
} from "@/components/ProductMaterialImport";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type { GeoResearchWorkspace } from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";

interface OnboardResponse {
  ok: true;
  product: ProductRegistryItem;
  workspace: GeoResearchWorkspace;
}

function firstUrl(urlsText?: string) {
  return (urlsText || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean);
}

export default function NewProductPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [createdTarget, setCreatedTarget] = useState<ProductMaterialTarget>();
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();

  async function createProduct(draft: ProductMaterialDraft): Promise<ProductMaterialTarget> {
    if (createdTarget) return createdTarget;
    const values = await form.validateFields();
    const description = values.description?.trim() || `围绕 ${values.canonicalName} 的真实资料建立产品认知与内容依据。`;
    const write = createV5WritePayload(workspaceSetting.currentRole, 0, "创建产品或服务并导入第一批资料");
    const result = await callJsonApi<OnboardResponse>("/api/v5/products", {
      method: "POST",
      headers: { "x-idempotency-key": write.idempotencyKey },
      body: JSON.stringify({
        ...write,
        canonicalName: values.canonicalName,
        displayName: values.canonicalName,
        officialUrl: firstUrl(draft.urlsText),
        productCategory: values.entityType,
        aliases: [],
        expressionFocus: description,
        forbiddenFocus: [],
        researchMarkets: ["CN"],
        languages: ["zh-CN"],
        targetChannels: ["wechat", "official_website"]
      })
    });
    const target = { productId: result.product.productId, productName: result.product.displayName };
    setCreatedTarget(target);
    return target;
  }

  return (
    <>
      <PageHeader
        title="创建产品/服务并导入资料"
        subtitle="名称用于确定资料归属；第一批网页或文件会在同一次提交中进入系统处理。"
        actions={<Link href="/products"><Button icon={<ArrowLeftOutlined />}>返回产品知识库</Button></Link>}
      />
      <Alert
        showIcon
        type="info"
        message="一次完成创建和资料导入"
        description="填写名称、选择第一批资料，然后点击一次“创建并导入资料”。系统会自动建立产品归属、知识整理和索引任务。"
        style={{ marginBottom: 16 }}
      />
      <Card bordered={false} className="product-create-card product-create-combined-card">
        <div className="product-create-combined-grid">
          <section className="product-create-identity">
            <div className="product-create-section-heading">
              <Typography.Text className="product-material-kicker">产品归属</Typography.Text>
              <Typography.Title level={3}>确认名称</Typography.Title>
              <Typography.Paragraph type="secondary">只填写用于识别和归档的最少信息。</Typography.Paragraph>
            </div>
            {createdTarget ? (
              <Alert
                showIcon
                icon={<CheckCircleOutlined />}
                type="success"
                message={`“${createdTarget.productName}”已创建`}
                description="产品信息已锁定；若资料导入失败，可直接在右侧重试，不会重复创建产品。"
                style={{ marginBottom: 16 }}
              />
            ) : null}
            <Form form={form} layout="vertical" disabled={Boolean(createdTarget)} initialValues={{ entityType: "product" }}>
              <Form.Item name="entityType" label="创建类型" rules={[{ required: true }]}>
                <Radio.Group optionType="button" buttonStyle="solid" options={[
                  { value: "product", label: "产品" },
                  { value: "service", label: "服务" }
                ]} />
              </Form.Item>
              <Form.Item
                name="canonicalName"
                label="产品/服务名称"
                rules={[{ required: true, message: "请填写产品或服务名称" }]}
              >
                <Input size="large" maxLength={255} autoFocus placeholder="例如：JOTO WorkBuddy" />
              </Form.Item>
              <Form.Item
                name="description"
                label="一句话说明（选填）"
                extra="简单说明它服务谁、解决什么问题；也可以在资料处理后继续补充。"
              >
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 7 }} maxLength={500} showCount />
              </Form.Item>
            </Form>
          </section>

          <section className="product-create-materials">
            <ProductMaterialImport
              title="上传第一批资料"
              description="网页链接和文件可单独或同时添加，系统会自动归入左侧产品。"
              submitLabel="创建并导入资料"
              beforeImport={createProduct}
              onTargetResolved={setCreatedTarget}
              onImported={(target) => router.replace(`/products/${encodeURIComponent(target.productId)}?tab=knowledge`)}
            />
          </section>
        </div>
      </Card>
    </>
  );
}
