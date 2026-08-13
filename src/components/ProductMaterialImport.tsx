"use client";

import { CloseOutlined, FileTextOutlined, LinkOutlined, PaperClipOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Form, Input, Select, Space, Tag, Upload, message } from "antd";
import type { RcFile, UploadFile } from "antd/es/upload/interface";
import { useMemo, useRef, useState } from "react";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";

const { Dragger } = Upload;

type ImportMode = "url" | "document" | "mixed";

export interface ProductMaterialTarget {
  productId: string;
  productName: string;
}

export interface ProductMaterialDraft {
  mode: ImportMode;
  urlsText?: string;
  fileCount: number;
}

export interface ProductMaterialImportResult {
  pipelineStatus: "queued" | "pending_config";
  missingConfiguration: string[];
  sourceIds: string[];
}

interface ManagedImportResponse {
  message?: string;
  data?: ProductMaterialImportResult;
}

const authorityOptions = [
  { value: "A2", label: "官方产品资料" },
  { value: "B1", label: "已确认的业务资料" },
  { value: "B2", label: "官方历史资料" }
];

export function ProductMaterialImport({
  productId,
  productName,
  officialUrl,
  title = "添加资料",
  description = "资料会自动归入当前产品，解析、整理和索引在后台完成。",
  submitLabel = "导入资料",
  beforeImport,
  onTargetResolved,
  onImported
}: {
  productId?: string;
  productName?: string;
  officialUrl?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  beforeImport?: (draft: ProductMaterialDraft) => Promise<ProductMaterialTarget>;
  onTargetResolved?: (target: ProductMaterialTarget) => void;
  onImported?: (target: ProductMaterialTarget, result: ProductMaterialImportResult) => void | Promise<void>;
}) {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [importResult, setImportResult] = useState<ManagedImportResponse["data"]>();
  const [resolvedTarget, setResolvedTarget] = useState<ProductMaterialTarget | undefined>(
    productId && productName ? { productId, productName } : undefined
  );
  const [partialFailure, setPartialFailure] = useState<string>();
  const idempotencyKeys = useRef({ url: crypto.randomUUID(), document: crypto.randomUUID() });
  const hasLegacyDoc = useMemo(() => fileList.some((file) => /\.doc$/i.test(file.name)), [fileList]);

  function resetImport() {
    setImportResult(undefined);
    idempotencyKeys.current = { url: crypto.randomUUID(), document: crypto.randomUUID() };
  }

  async function importMaterials() {
    const values = await form.validateFields();
    const files = fileList
      .map((file) => file.originFileObj)
      .filter((file): file is RcFile => Boolean(file));
    const urlsText = String(values.urlsText || "").trim();
    const hasUrls = Boolean(urlsText);
    const mode: ImportMode = hasUrls && files.length ? "mixed" : hasUrls ? "url" : "document";

    if (!hasUrls && !files.length) {
      messageApi.warning("请填写网页链接或选择需要导入的文件。");
      return;
    }

    setSaving(true);
    setImportResult(undefined);
    setPartialFailure(undefined);
    let target = resolvedTarget;
    try {
      if (!target) {
        if (!beforeImport) throw new Error("缺少产品归属，无法导入资料。");
        target = await beforeImport({
          mode,
          urlsText: hasUrls ? urlsText : undefined,
          fileCount: files.length
        });
        setResolvedTarget(target);
        onTargetResolved?.(target);
      }

      const results: ManagedImportResponse[] = [];
      const knowledgeBaseName = `${target.productName} 产品资料`;

      if (hasUrls) {
        results.push(await callJsonApi<ManagedImportResponse>("/api/v5/knowledge-imports/urls", {
          method: "POST",
          body: JSON.stringify({
            name: knowledgeBaseName,
            urlsText,
            productId: target.productId,
            authorityLevel: values.authorityLevel,
            publicUseConfirmed: values.publicUseConfirmed === true,
            idempotencyKey: idempotencyKeys.current.url
          })
        }));
      }

      if (files.length) {
        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));
        formData.append("name", knowledgeBaseName);
        formData.append("productId", target.productId);
        formData.append("authorityLevel", values.authorityLevel);
        formData.append("publicUseConfirmed", String(values.publicUseConfirmed === true));
        formData.append("idempotencyKey", idempotencyKeys.current.document);
        results.push(await callJsonApi<ManagedImportResponse>("/api/v5/knowledge-imports/documents", {
          method: "POST",
          body: formData
        }));
      }

      const resultData = results.map((result) => result.data).filter((item): item is NonNullable<ManagedImportResponse["data"]> => Boolean(item));
      const combinedResult = {
        pipelineStatus: resultData.some((item) => item.pipelineStatus === "pending_config") ? "pending_config" as const : "queued" as const,
        missingConfiguration: Array.from(new Set(resultData.flatMap((item) => item.missingConfiguration))),
        sourceIds: resultData.flatMap((item) => item.sourceIds)
      };
      setImportResult(combinedResult);
      form.setFieldsValue({ urlsText: "", publicUseConfirmed: false });
      setFileList([]);
      resetImport();
      setImportResult(combinedResult);
      messageApi.success(formatApiMessage(results[results.length - 1], "资料已导入，系统正在整理和建立索引。"));
      await onImported?.(target, combinedResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "资料导入失败，请检查资料后重试。";
      if (target && !productId) {
        setPartialFailure(`产品“${target.productName}”已创建，但资料尚未导入：${errorMessage}`);
      }
      messageApi.error(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="product-material-import">
      {contextHolder}
      <div className="product-material-import-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          urlsText: officialUrl || "",
          authorityLevel: officialUrl ? "A2" : "B1",
          publicUseConfirmed: false
        }}
      >
        <div className="product-material-source-grid">
          <section className="product-material-source-panel" aria-labelledby="product-material-url-title">
            <div className="product-material-source-title">
              <LinkOutlined />
              <div><strong id="product-material-url-title">网页链接</strong><span>每行一个，可一次添加官网、帮助文档和公开介绍页。</span></div>
            </div>
            <Form.Item name="urlsText" className="product-material-source-field">
              <Input.TextArea autoSize={{ minRows: 7, maxRows: 12 }} placeholder="https://example.com/product" />
            </Form.Item>
          </section>

          <section className="product-material-source-panel" aria-labelledby="product-material-file-title">
            <div className="product-material-source-title">
              <FileTextOutlined />
              <div><strong id="product-material-file-title">上传文件</strong><span>支持 PDF、Word、Markdown 和文本，一次最多 10 份。</span></div>
            </div>
            <div className="knowledge-document-upload product-material-source-field">
              <Dragger
                multiple
                accept=".pdf,.docx,.md,.markdown,.txt"
                fileList={fileList}
                showUploadList={false}
                beforeUpload={() => false}
                onChange={({ fileList: nextFileList }) => {
                  setFileList(nextFileList.slice(0, 10));
                  resetImport();
                }}
              >
                <p className="ant-upload-drag-icon"><FileTextOutlined /></p>
                <p>点击或拖拽上传资料</p>
                <p>可以和左侧网页链接一起导入。</p>
              </Dragger>
              {fileList.length ? (
                <div className="product-material-selected-files" aria-label={`已选择 ${fileList.length} 份资料`}>
                  <div className="product-material-selected-files-heading">
                    <span>已选择的资料</span>
                    <Tag color="blue">{fileList.length} / 10</Tag>
                  </div>
                  <ul>
                    {fileList.map((file) => (
                      <li key={file.uid}>
                        <PaperClipOutlined aria-hidden="true" />
                        <span className="product-material-selected-file-name" title={file.name}>{file.name}</span>
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<CloseOutlined />}
                          aria-label={`移除 ${file.name}`}
                          onClick={() => {
                            setFileList((current) => current.filter((item) => item.uid !== file.uid));
                            resetImport();
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {hasLegacyDoc ? <Alert showIcon type="warning" message="旧版 .doc 暂不支持，请转换为 .docx 后上传。" /> : null}
            </div>
          </section>
        </div>

        <div className="product-material-import-settings">
          <Form.Item label="资料性质" name="authorityLevel" rules={[{ required: true }]}>
            <Select options={authorityOptions} />
          </Form.Item>
          <Form.Item
            name="publicUseConfirmed"
            valuePropName="checked"
            rules={[{
              validator: (_, value) => value
                ? Promise.resolve()
                : Promise.reject(new Error("请确认资料的公开使用权限"))
            }]}
          >
            <Checkbox>我确认这些资料可用于公开内容生产与证据引用</Checkbox>
          </Form.Item>
        </div>

        {importResult ? (
          <Alert
            showIcon
            type={importResult.pipelineStatus === "queued" ? "success" : "warning"}
            message={importResult.pipelineStatus === "queued" ? "资料处理任务已开始" : "资料已保存，等待系统配置完成"}
            description={importResult.pipelineStatus === "queued"
              ? `已接收 ${importResult.sourceIds.length} 个资料来源，后续处理无需停留在本页。`
              : `仍缺少：${importResult.missingConfiguration.join("、")}`}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {partialFailure ? (
          <Alert
            showIcon
            type="warning"
            message="产品已创建，资料导入需要重试"
            description={partialFailure}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Space>
          <Button type="primary" loading={saving} onClick={() => void importMaterials()}>
            {partialFailure ? "重试导入资料" : submitLabel}
          </Button>
          <span className="product-material-import-helper">
            {beforeImport && !resolvedTarget ? "点击后将自动创建产品并导入资料" : "导入后可继续添加下一批资料"}
          </span>
        </Space>
      </Form>
    </div>
  );
}
