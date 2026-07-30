"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Select, Space, Typography, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { createV5WritePayload } from "@/lib/v5-client";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { GeoResearchWorkspace } from "@/lib/v5/geo-research-contracts";

interface OnboardResponse {
  ok: true;
  product: ProductRegistryItem;
  workspace: GeoResearchWorkspace;
}

function splitValues(value?: string) {
  return (value || "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function NewProductPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const write = createV5WritePayload(
        0,
        "新增产品并创建 GEO 前置调研项目"
      );
      const result = await callJsonApi<OnboardResponse>("/api/v5/products", {
        method: "POST",
        headers: { "x-idempotency-key": write.idempotencyKey },
        body: JSON.stringify({
          ...write,
          canonicalName: values.canonicalName,
          displayName: values.displayName,
          brandName: values.brandName,
          officialEntity: values.officialEntity,
          officialUrl: values.officialUrl,
          productCategory: values.productCategory,
          aliases: splitValues(values.aliases),
          expressionFocus: values.expressionFocus,
          forbiddenFocus: splitValues(values.forbiddenFocus),
          researchMarkets: values.researchMarkets,
          languages: values.languages,
          targetChannels: values.targetChannels
        })
      });
      messageApi.success("产品与 GEO 调研项目已创建");
      router.push(`/products/${result.product.productId}/research`);
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "产品创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="新增产品与 GEO 调研"
        subtitle="这里只收集人必须判断的信息；问题搜索、竞品研究、AI 前台测试和蓝图归纳由后续任务链完成。"
        actions={<Link href="/products"><Button icon={<ArrowLeftOutlined />}>返回产品列表</Button></Link>}
      />
      <Alert
        showIcon
        type="info"
        message="创建后先导入真实产品资料"
        description="系统只有在形成可追溯的资料快照后才允许启动联网调研，避免模型凭空推断产品能力。"
        style={{ marginBottom: 16 }}
      />
      <Card bordered={false}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            researchMarkets: ["CN"],
            languages: ["zh-CN"],
            targetChannels: ["wechat", "official_website"]
          }}
        >
          <Typography.Title level={4}>产品身份</Typography.Title>
          <div className="knowledge-detail-two-column">
            <div>
              <Form.Item
                name="canonicalName"
                label="产品规范名称"
                rules={[{ required: true, message: "请填写产品规范名称" }]}
              >
                <Input maxLength={255} placeholder="例如：Acme Knowledge Assistant" />
              </Form.Item>
              <Form.Item name="displayName" label="工作台展示名称">
                <Input maxLength={255} placeholder="不填则使用规范名称" />
              </Form.Item>
              <Form.Item name="brandName" label="品牌名称">
                <Input maxLength={255} />
              </Form.Item>
              <Form.Item name="productCategory" label="产品品类">
                <Input maxLength={128} placeholder="例如：enterprise_ai_service" />
              </Form.Item>
            </div>
            <div>
              <Form.Item name="officialEntity" label="官方主体">
                <Input maxLength={255} placeholder="公司或官方产品主体" />
              </Form.Item>
              <Form.Item name="officialUrl" label="产品官网">
                <Input type="url" placeholder="https://example.com/product" />
              </Form.Item>
              <Form.Item name="aliases" label="产品别名" extra="每行一个，或用逗号分隔。用于搜索与实体识别。">
                <Input.TextArea rows={5} />
              </Form.Item>
            </div>
          </div>

          <Typography.Title level={4}>研究边界</Typography.Title>
          <Form.Item
            name="expressionFocus"
            label="希望市场记住的表达重点"
            rules={[{ required: true, message: "请说明产品的表达重点" }]}
            extra="描述产品为谁解决什么问题、最希望建立的认知，以及必须讲清楚的差异。"
          >
            <Input.TextArea rows={6} maxLength={4000} showCount />
          </Form.Item>
          <Form.Item
            name="forbiddenFocus"
            label="禁止或谨慎表达"
            extra="每行一个，例如尚未上线能力、未经证实的效果数字、不能公开的客户名称。"
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <div className="knowledge-detail-two-column">
            <Form.Item name="researchMarkets" label="研究市场">
              <Select mode="tags" tokenSeparators={[","]} />
            </Form.Item>
            <Form.Item name="languages" label="研究语言">
              <Select mode="tags" tokenSeparators={[","]} />
            </Form.Item>
          </div>
          <Form.Item name="targetChannels" label="目标内容渠道">
            <Select
              mode="multiple"
              options={[
                { value: "wechat", label: "微信公众号" },
                { value: "official_website", label: "官网/博客" },
                { value: "zhihu", label: "知乎" },
                { value: "xiaohongshu", label: "小红书" },
                { value: "csdn", label: "CSDN" }
              ]}
            />
          </Form.Item>
          <Space>
            <Button type="primary" loading={saving} onClick={submit}>创建并进入资料准备</Button>
            <Link href="/products"><Button>取消</Button></Link>
          </Space>
        </Form>
      </Card>
    </>
  );
}
