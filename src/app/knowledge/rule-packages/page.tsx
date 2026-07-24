"use client";

import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, List, Select, Space, Tabs, Tag, message } from "antd";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { KnowledgeBase, ProductExpressionRuleDraft } from "@/lib/types";

const ruleStatusLabels: Record<ProductExpressionRuleDraft["status"], string> = {
  draft: "草稿",
  active: "已生效",
  archived: "已归档"
};

const ruleStatusColors: Record<ProductExpressionRuleDraft["status"], string> = {
  draft: "gold",
  active: "green",
  archived: "default"
};

export default function KnowledgeRulePackagesPage() {
  const {
    state: { knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const selectedKnowledgeBase = knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId);
  const ruleDraft = selectedKnowledgeBase?.productExpressionRuleDraft;
  const linkedKnowledgeBases = selectedKnowledgeBaseId
    ? knowledgeBases.filter((item) => item.linkedProductExpressionRulePackageId === selectedKnowledgeBaseId)
    : [];
  const ruleSourceOptions = useMemo(
    () =>
      knowledgeBases.map((item) => ({
        value: item.id,
        label: `${item.name}（${item.chunks?.length || 0} 段）`
      })),
    [knowledgeBases]
  );
  const rulePackageRows = knowledgeBases.filter((item) => item.productExpressionRuleDraft);

  async function handleGenerate() {
    const values = await form.validateFields();
    const sourceId = values.sourceKnowledgeBaseId as string;
    setSaving(true);

    try {
      await callJsonApi(`/api/knowledge-bases/${sourceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          usageScope: values.description,
          productExpressionSource: true
        })
      });
      const result = await callJsonApi(`/api/knowledge-bases/${sourceId}/product-expression`, {
        method: "POST",
        body: JSON.stringify({ action: "regenerate" })
      });
      setSelectedKnowledgeBaseId(sourceId);
      await refresh();
      messageApi.success(formatApiMessage(result, "产品表达规则包草稿已生成。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成规则包失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRuleAction(action: "activate" | "rollback" | "discard") {
    if (!selectedKnowledgeBase) return;

    setSaving(true);
    try {
      const result = await callJsonApi(`/api/knowledge-bases/${selectedKnowledgeBase.id}/product-expression`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "规则包已更新。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "规则包操作失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveManualEdit() {
    if (!selectedKnowledgeBase || !ruleDraft) return;

    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const nextDraft: ProductExpressionRuleDraft = {
        ...ruleDraft,
        summary: values.summary || ruleDraft.summary,
        doExpressions: String(values.doExpressions || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        dontExpressions: String(values.dontExpressions || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        boundaryNotes: String(values.boundaryNotes || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      };
      const result = await callJsonApi(`/api/knowledge-bases/${selectedKnowledgeBase.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          productExpressionSource: true,
          productExpressionRuleDraft: nextDraft
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "规则包草稿已保存。"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存规则包草稿失败");
    } finally {
      setSaving(false);
    }
  }

  function syncRuleDraftToForm(nextRuleDraft?: ProductExpressionRuleDraft) {
    form.setFieldsValue({
      summary: nextRuleDraft?.summary || "",
      doExpressions: nextRuleDraft?.doExpressions?.join("\n") || "",
      dontExpressions: nextRuleDraft?.dontExpressions?.join("\n") || "",
      boundaryNotes: nextRuleDraft?.boundaryNotes?.join("\n") || ""
    });
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="产品表达规则包"
        subtitle="从已有知识库生成允许表达、禁止表达和边界提示；草稿确认后才进入业务生成链路。"
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
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      <Tabs
        items={[
          {
            key: "create",
            label: "新建规则包",
            children: (
              <Card>
                <Alert
                  showIcon
                  type="info"
                  message="规则包是治理资产"
                  description="新生成内容先作为草稿存在，必须人工确认生效；版本差异、回滚和风险边界继续保留。"
                  style={{ marginBottom: 16 }}
                />
                <Form form={form} layout="vertical">
                  <Form.Item label="产品名称" name="productName" rules={[{ required: true, message: "请填写产品名称" }]}>
                    <Input placeholder="例如：JOTO / 唯客护栏" />
                  </Form.Item>
                  <Form.Item label="说明" name="description">
                    <Input.TextArea rows={3} placeholder="说明这个规则包服务的产品表达边界。" />
                  </Form.Item>
                  <Form.Item label="选择已有知识库" name="sourceKnowledgeBaseId" rules={[{ required: true, message: "请选择来源知识库" }]}>
                    <Select
                      options={ruleSourceOptions}
                      placeholder="选择知识库来源"
                      onChange={(value) => {
                        setSelectedKnowledgeBaseId(value);
                        const nextKb = knowledgeBases.find((item) => item.id === value);
                        syncRuleDraftToForm(nextKb?.productExpressionRuleDraft);
                      }}
                    />
                  </Form.Item>
                  <Button type="primary" loading={saving} onClick={handleGenerate}>
                    生成规则包草稿
                  </Button>
                </Form>
              </Card>
            )
          },
          {
            key: "edit",
            label: "编辑与确认",
            children: (
              <Card>
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <Select
                    value={selectedKnowledgeBaseId}
                    onChange={(value) => {
                      setSelectedKnowledgeBaseId(value);
                      const nextKb = knowledgeBases.find((item) => item.id === value);
                      syncRuleDraftToForm(nextKb?.productExpressionRuleDraft);
                    }}
                    options={ruleSourceOptions}
                    placeholder="选择规则包来源知识库"
                    style={{ width: 360 }}
                  />
                  {selectedKnowledgeBase && ruleDraft ? (
                    <>
                      <Descriptions size="small" column={3}>
                        <Descriptions.Item label="来源知识库">{selectedKnowledgeBase.name}</Descriptions.Item>
                        <Descriptions.Item label="版本">{ruleDraft.version}</Descriptions.Item>
                        <Descriptions.Item label="状态">
                          <Tag color={ruleStatusColors[ruleDraft.status]}>{ruleStatusLabels[ruleDraft.status]}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="来源切片">{ruleDraft.sourceChunkCount}</Descriptions.Item>
                        <Descriptions.Item label="生成时间">{ruleDraft.generatedAt || "-"}</Descriptions.Item>
                        <Descriptions.Item label="生效时间">{ruleDraft.activatedAt || "-"}</Descriptions.Item>
                        <Descriptions.Item label="关联导入资料">{linkedKnowledgeBases.length}</Descriptions.Item>
                      </Descriptions>
                      {linkedKnowledgeBases.length ? (
                        <Alert
                          showIcon
                          type="warning"
                          message="有新资料关联到当前规则包"
                          description="这些资料已经在导入时关联到该规则包，但不会自动覆盖已生效版本。请确认内容后生成新草稿或手动编辑规则。"
                        />
                      ) : null}
                      <Form form={form} layout="vertical" initialValues={{ keepVersionBoundary: true }}>
                        <Form.Item label="规则摘要" name="summary" initialValue={ruleDraft.summary}>
                          <Input.TextArea rows={3} />
                        </Form.Item>
                        <Form.Item label="允许表达" name="doExpressions" initialValue={ruleDraft.doExpressions.join("\n")}>
                          <Input.TextArea rows={6} />
                        </Form.Item>
                        <Form.Item label="禁止表达" name="dontExpressions" initialValue={ruleDraft.dontExpressions.join("\n")}>
                          <Input.TextArea rows={6} />
                        </Form.Item>
                        <Form.Item label="边界提示" name="boundaryNotes" initialValue={ruleDraft.boundaryNotes.join("\n")}>
                          <Input.TextArea rows={5} />
                        </Form.Item>
                        <Form.Item name="keepVersionBoundary" valuePropName="checked">
                          <Checkbox disabled>保留草稿、版本差异与回滚边界</Checkbox>
                        </Form.Item>
                        <Space wrap>
                          <Button loading={saving} onClick={handleSaveManualEdit}>
                            保存草稿
                          </Button>
                          <Button type="primary" loading={saving} onClick={() => handleRuleAction("activate")}>
                            确认生效
                          </Button>
                          <Button loading={saving} onClick={() => handleRuleAction("rollback")}>
                            回滚上一版本
                          </Button>
                          {ruleDraft.status === "draft" ? (
                            <Button danger loading={saving} onClick={() => handleRuleAction("discard")}>
                              放弃草稿
                            </Button>
                          ) : null}
                        </Space>
                      </Form>
                      {linkedKnowledgeBases.length ? (
                        <List
                          size="small"
                          header="关联导入资料"
                          dataSource={linkedKnowledgeBases}
                          renderItem={(item) => (
                            <List.Item
                              actions={[
                                <Link key="detail" href={`/knowledge/${item.id}`}>
                                  查看资料
                                </Link>
                              ]}
                            >
                              <List.Item.Meta
                                title={item.name}
                                description={`${item.lastSyncedAt || "-"} / ${item.vectorizationStatus || "pending_config"}`}
                              />
                            </List.Item>
                          )}
                        />
                      ) : null}
                    </>
                  ) : (
                    <ActionEmpty title="请选择已有规则包" description="可以先从左侧新建，也可以选择已经标记为产品表达来源的知识库。" />
                  )}
                </Space>
              </Card>
            )
          },
          {
            key: "list",
            label: "已有规则包",
            children: (
              <Card>
                <List
                  dataSource={rulePackageRows}
                  locale={{ emptyText: <ActionEmpty title="暂无规则包" description="选择知识库来源后生成第一版产品表达规则包。" /> }}
                  renderItem={(item: KnowledgeBase) => {
                    const draft = item.productExpressionRuleDraft;
                    const linkedCount = knowledgeBases.filter((source) => source.linkedProductExpressionRulePackageId === item.id).length;
                    return (
                      <List.Item
                        actions={[
                          <Button key="select" size="small" onClick={() => {
                            setSelectedKnowledgeBaseId(item.id);
                            syncRuleDraftToForm(draft);
                          }}>
                            编辑
                          </Button>,
                          <Link key="detail" href={`/knowledge/${item.id}`}>
                            查看知识库
                          </Link>
                        ]}
                      >
                        <List.Item.Meta
                          title={item.name}
                          description={draft ? `${draft.version} / ${ruleStatusLabels[draft.status]} / ${draft.sourceChunkCount} 段来源 / ${linkedCount} 条关联资料` : "未生成"}
                        />
                      </List.Item>
                    );
                  }}
                />
              </Card>
            )
          }
        ]}
      />
    </>
  );
}
