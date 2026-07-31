"use client";

import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Tag, Upload, message } from "antd";
import type { RcFile, UploadFile } from "antd/es/upload/interface";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";

const { Dragger } = Upload;

const authorityOptions = [
  { value: "A2", label: "A2 - 官方产品资料" },
  { value: "B1", label: "B1 - 经确认的业务资料" },
  { value: "B2", label: "B2 - 官方历史内容" }
];

interface ManagedImportResponse {
  message?: string;
  data?: { pipelineStatus: "queued" | "pending_config"; batchIds: string[]; generatedClaims: number; missingConfiguration: string[] };
}

interface ProductListResponse {
  products: Array<{ productId: string; displayName: string }>;
}

export default function KnowledgeDocumentImportPage() {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsedFileSignature, setParsedFileSignature] = useState("");
  const [importResult, setImportResult] = useState<ManagedImportResponse["data"]>();
  const [productOptions, setProductOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const idempotencyKey = useRef(crypto.randomUUID());
  const hasLegacyDoc = useMemo(() => fileList.some((file) => /\.doc$/i.test(file.name)), [fileList]);
  const currentFileSignature = useMemo(
    () => fileList.map((file) => `${file.uid}:${file.name}:${file.size || 0}`).join("|"),
    [fileList]
  );

  useEffect(() => {
    let active = true;
    callJsonApi<ProductListResponse>("/api/v5/products")
      .then((result) => {
        if (!active) return;
        const requestedProductId = new URLSearchParams(window.location.search).get("productId");
        const options = (result.products || []).map((item) => ({
          value: item.productId,
          label: item.displayName
        }));
        setProductOptions(options);
        const requested = options.find((option) => option.value === requestedProductId);
        if (!form.getFieldValue("productId") && (requested || options[0])) {
          form.setFieldValue("productId", (requested || options[0]).value);
        }
      })
      .catch((error) => {
        if (active) messageApi.error(error instanceof Error ? error.message : "产品列表加载失败");
      })
      .finally(() => {
        if (active) setProductsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form, messageApi]);

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
      setParsedFileSignature(currentFileSignature);
      messageApi.success(formatApiMessage(result, result.data?.failedCount ? "文档已解析，部分文件需要处理。" : "文档已解析为 Markdown 预览。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "文档解析失败");
    } finally {
      setParsing(false);
    }
  }

  function updateFileList(nextFileList: UploadFile[]) {
    setFileList(nextFileList);
    setParsedFileSignature("");
    setImportResult(undefined);
    form.setFieldValue("contentPreview", "");
  }

  async function handleSave() {
    const values = await form.validateFields();
    const nativeFiles = fileList.map((file) => file.originFileObj).filter((file): file is RcFile => Boolean(file));
    if (!nativeFiles.length) {
      messageApi.warning("请先选择并解析需要导入的文档。");
      return;
    }
    setSaving(true);

    try {
      const formData = new FormData();
      nativeFiles.forEach((file) => formData.append("files", file));
      formData.append("name", values.name);
      formData.append("productId", values.productId);
      formData.append("authorityLevel", values.authorityLevel);
      formData.append("publicUseConfirmed", String(values.publicUseConfirmed === true));
      formData.append("idempotencyKey", idempotencyKey.current);
      const result = await callJsonApi<ManagedImportResponse>("/api/v5/knowledge-imports/documents", {
        method: "POST",
        body: formData
      });
      setImportResult(result.data);
      messageApi.success(formatApiMessage(result, "文档已托管，治理与索引任务已创建。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "文档导入失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="文档导入"
        subtitle="上传资料后由服务端托管正文，并自动进入 Claim、Snapshot、Embedding 与 OpenSearch 链路。"
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
        <Form form={form} layout="vertical" initialValues={{ authorityLevel: "B1", publicUseConfirmed: false }}>
          <div className="knowledge-detail-two-column">
            <div>
              <Form.Item label="知识库名称" name="name" rules={[{ required: true, message: "请填写知识库名称" }]}>
                <Input placeholder="例如：唯客产品资料包" />
              </Form.Item>
              <Form.Item label="所属产品" name="productId" rules={[{ required: true, message: "请选择资料所属产品" }]}>
                <Select
                  options={productOptions}
                  loading={productsLoading}
                  notFoundContent={<Link href="/products/new">先新增产品</Link>}
                />
              </Form.Item>
              <Form.Item label="来源权威等级" name="authorityLevel" rules={[{ required: true, message: "请选择来源权威等级" }]}>
                <Select options={authorityOptions} />
              </Form.Item>
              <Form.Item name="publicUseConfirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认公开内容生产权限")) }]}>
                <Checkbox>我确认资料可用于公开内容生产与证据引用</Checkbox>
              </Form.Item>
            </div>

            <div className="knowledge-document-upload">
              <Dragger
                multiple
                accept=".pdf,.docx,.md,.markdown,.txt"
                fileList={fileList}
                showUploadList={false}
                beforeUpload={() => false}
                onChange={({ fileList: nextFileList }) => updateFileList(nextFileList)}
              >
                <p>点击或拖拽上传文档</p>
                <p>支持 PDF / Word(docx) / Markdown，可一次上传多份。</p>
              </Dragger>
              <div className="knowledge-upload-selection">
                <div className="knowledge-upload-selection-header">
                  <Tag color={fileList.length ? "blue" : "gold"}>
                    {fileList.length ? `已选择 ${fileList.length} 份文档` : "未选择文档"}
                  </Tag>
                  <Space wrap>
                    <Button
                      type="primary"
                      disabled={!fileList.length}
                      loading={parsing}
                      onClick={handleParse}
                    >
                      解析并预览
                    </Button>
                    <Button disabled={!fileList.length || parsing} onClick={() => updateFileList([])}>
                      清空
                    </Button>
                  </Space>
                </div>
                {fileList.length ? (
                  <div className="knowledge-upload-file-list" role="list" aria-label="已选择的文档">
                    {fileList.map((file) => (
                      <div className="knowledge-upload-file-row" role="listitem" key={file.uid}>
                        <span className="knowledge-upload-file-name" title={file.name}>{file.name}</span>
                        <Button
                          type="text"
                          danger
                          size="small"
                          disabled={parsing}
                          onClick={() => updateFileList(fileList.filter((item) => item.uid !== file.uid))}
                        >
                          移除
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="knowledge-upload-empty">选择文件后会在这里显示完整清单。</p>
                )}
                {parsedFileSignature && parsedFileSignature === currentFileSignature ? (
                  <Tag color="green" className="knowledge-upload-parsed-tag">当前文件已解析</Tag>
                ) : null}
              </div>
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
            <Input.TextArea rows={12} readOnly placeholder="点击解析后显示 Markdown 预览。" />
          </Form.Item>
          {importResult ? (
            <Alert
              showIcon
              type={importResult.pipelineStatus === "queued" ? "success" : "warning"}
              message={importResult.pipelineStatus === "queued" ? "治理与索引任务已排队" : "资料已托管，等待基础设施配置"}
              description={importResult.pipelineStatus === "queued"
                ? "SourceAsset 与 SourceRevision 已创建，Worker 将继续提取 Claim、生成 Snapshot、Embedding 和 OpenSearch 索引。"
                : `仍缺少：${importResult.missingConfiguration.join(", ")}`}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>托管并启动治理</Button>
          </Space>
        </Form>
      </Card>
    </>
  );
}
