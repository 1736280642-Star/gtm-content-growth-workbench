"use client";

import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Tag, Upload, message } from "antd";
import type { RcFile, UploadFile } from "antd/es/upload/interface";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { KnowledgeBase } from "@/lib/types";

const { Dragger } = Upload;

const knowledgeTypeOptions: Array<{ value: KnowledgeBase["type"]; label: string }> = [
  { value: "brand", label: "品牌事实" },
  { value: "product", label: "产品知识" },
  { value: "official_blog", label: "官网博客" },
  { value: "channel_history", label: "渠道历史" },
  { value: "competitor", label: "竞品参考" },
  { value: "custom", label: "用户自定义" }
];

function detectSourceType(files: UploadFile[]) {
  if (files.some((file) => /\.pdf$/i.test(file.name))) return "pdf";
  if (files.some((file) => /\.(doc|docx)$/i.test(file.name))) return "docx";
  if (files.some((file) => /\.(md|markdown)$/i.test(file.name))) return "markdown";
  return "manual";
}

export default function KnowledgeDocumentImportPage() {
  const {
    state: { knowledgeBases }
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasLegacyDoc = useMemo(() => fileList.some((file) => /\.doc$/i.test(file.name)), [fileList]);
  const rulePackageOptions = knowledgeBases
    .filter((item) => item.productExpressionRuleDraft)
    .map((item) => ({
      value: item.id,
      label: `${item.name}（${item.productExpressionRuleDraft?.version || "草稿"}）`
    }));

  async function handleParse() {
    const nativeFiles = fileList.map((file) => file.originFileObj).filter((file): file is RcFile => Boolean(file));

    if (!nativeFiles.length) {
      messageApi.warning("请先选择需要解析的文档。");
      return;
    }

    setParsing(true);

    try {
      const formData = new FormData();

      for (const file of nativeFiles) {
        formData.append("files", file);
      }

      const result = await callJsonApi<{ data?: { contentPreview?: string; failedCount?: number } }>("/api/knowledge-bases/parse-documents", {
        method: "POST",
        body: formData
      });
      const contentPreview = result.data?.contentPreview || "";
      form.setFieldsValue({ contentPreview });
      messageApi.success(formatApiMessage(result, result.data?.failedCount ? "文档已解析，部分文件需要处理。" : "文档已解析为 Markdown 预览。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "文档解析失败");
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const result = await callJsonApi<{ data?: { knowledgeBase?: KnowledgeBase } }>("/api/knowledge-bases", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          sourceType: detectSourceType(fileList),
          status: "enabled",
          title: values.name,
          manualText: values.contentPreview,
          productExpressionSource: Boolean(values.productExpressionSource),
          productExpressionRulePackageMode: values.productExpressionSource ? values.rulePackageMode || "new" : "none",
          linkedProductExpressionRulePackageId: values.rulePackageMode === "existing" ? values.linkedProductExpressionRulePackageId : undefined
        })
      });
      const id = result.data?.knowledgeBase?.id;
      messageApi.success(formatApiMessage(result, "文档知识库已保存为待向量化。"));
      if (id) {
        window.location.href = `/knowledge/${id}`;
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存知识库失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="文档导入"
        subtitle="上传 PDF / Word / Markdown 资料，解析为 Markdown 预览后保存为待向量化知识库。"
        actions={
          <Space>
            <Link href="/knowledge/import">
              <Button>返回内容导入</Button>
            </Link>
            <Link href="/knowledge">
              <Button>知识库列表</Button>
            </Link>
          </Space>
        }
      />

      <Card>
        <Form form={form} layout="vertical" initialValues={{ type: "product", productExpressionSource: false, rulePackageMode: "new" }}>
          <div className="knowledge-detail-two-column">
            <div>
              <Form.Item label="知识库名称" name="name" rules={[{ required: true, message: "请填写知识库名称" }]}>
                <Input placeholder="例如：唯客产品资料包" />
              </Form.Item>
              <Form.Item label="知识库类型" name="type">
                <Select options={knowledgeTypeOptions} />
              </Form.Item>
              <Form.Item label="资料用途" name="usageScope">
                <Input.TextArea rows={3} placeholder="例如：产品表达、FAQ、销售资料、官网证据" />
              </Form.Item>
              <Form.Item name="productExpressionSource" valuePropName="checked">
                <Checkbox>作为产品表达规则包来源</Checkbox>
              </Form.Item>
              <Form.Item shouldUpdate={(prev, next) => prev.productExpressionSource !== next.productExpressionSource || prev.rulePackageMode !== next.rulePackageMode}>
                {({ getFieldValue }) =>
                  getFieldValue("productExpressionSource") ? (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Form.Item label="规则包处理方式" name="rulePackageMode" style={{ marginBottom: 0 }}>
                        <Select
                          options={[
                            { value: "new", label: "新建产品表达规则包" },
                            { value: "existing", label: "关联已有规则包" }
                          ]}
                        />
                      </Form.Item>
                      {getFieldValue("rulePackageMode") === "existing" ? (
                        <Form.Item
                          label="选择已有规则包"
                          name="linkedProductExpressionRulePackageId"
                          rules={[{ required: true, message: "请选择要关联的产品表达规则包" }]}
                        >
                          <Select options={rulePackageOptions} placeholder="选择已有规则包" />
                        </Form.Item>
                      ) : null}
                    </Space>
                  ) : null
                }
              </Form.Item>
            </div>

            <div>
              <Dragger
                multiple
                accept=".pdf,.docx,.md,.markdown,.txt"
                fileList={fileList}
                beforeUpload={() => false}
                onChange={({ fileList: nextFileList }) => setFileList(nextFileList)}
              >
                <p>点击或拖拽上传文档</p>
                <p>支持 PDF / Word(docx) / Markdown，可一次上传多份。</p>
              </Dragger>
              <Space wrap style={{ marginTop: 16 }}>
                <Button type="primary" disabled={!fileList.length} loading={parsing} onClick={handleParse}>解析</Button>
                <Tag color={fileList.length ? "blue" : "gold"}>{fileList.length ? `已选择 ${fileList.length} 份文档` : "未选择文档"}</Tag>
              </Space>
              {hasLegacyDoc ? (
                <Alert
                  showIcon
                  type="warning"
                  message="旧版 .doc 解析边界"
                  description="旧版 .doc 二进制格式暂不支持直接解析，请先转换为 .docx 后上传。PDF 和 .docx 会走服务端真实文本解析。"
                  style={{ marginTop: 16 }}
                />
              ) : null}
            </div>
          </div>

          <Form.Item label="Markdown 解析预览" name="contentPreview" style={{ marginTop: 24 }} rules={[{ required: true, message: "请先解析文档生成预览" }]}>
            <Input.TextArea rows={12} placeholder="点击解析后显示 Markdown 预览。" />
          </Form.Item>
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>保存为待向量化</Button>
            <Link href="/knowledge/vectorize">
              <Button>去切片与向量化</Button>
            </Link>
          </Space>
        </Form>
      </Card>
    </>
  );
}
