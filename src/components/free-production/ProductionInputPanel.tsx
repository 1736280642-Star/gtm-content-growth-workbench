"use client";

import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Checkbox, Form, Input, Select } from "antd";
import { useEffect } from "react";
import type { CreateFreeProductionInput, FreeContentExpressionTypeSummary, FreeProductionCatalog } from "@/lib/v5/free-production-contracts";

type ProductionFormValues = Pick<CreateFreeProductionInput, "productId" | "knowledgeSnapshotIds" | "expressionFocus" | "factItems" | "meetingText">;

const sourceModeLabels = {
  knowledge: "产品与知识库",
  facts: "事件事实",
  facts_with_meeting_text: "事件事实 + 会议文本"
};

export function ProductionInputPanel({ profile, catalog, loading, onBack, onGenerate }: { profile: FreeContentExpressionTypeSummary; catalog: FreeProductionCatalog; loading?: boolean; onBack: () => void; onGenerate: (values: ProductionFormValues) => void }) {
  const [form] = Form.useForm<ProductionFormValues>();
  const expression = profile.activeVersion!;
  const productId = Form.useWatch("productId", form);
  const product = catalog.products.find((item) => item.productId === productId);

  useEffect(() => {
    const firstProduct = catalog.products[0];
    form.resetFields();
    form.setFieldsValue({
      productId: expression.sourceMode === "knowledge" ? firstProduct?.productId : undefined,
      knowledgeSnapshotIds: expression.sourceMode === "knowledge" ? firstProduct?.knowledgeBases.map((item) => item.sourceSnapshotId) || [] : [],
      expressionFocus: "",
      factItems: expression.sourceMode === "knowledge" ? [] : [{ time: "", location: "", people: "", event: "", publicConfirmed: false }],
      meetingText: ""
    });
  }, [catalog.products, expression.freeContentExpressionTypeVersionId, expression.sourceMode, form]);

  return (
    <section className="production-input-panel">
      <div className="production-input-heading">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回内容类型</Button>
        <div><span>{sourceModeLabels[expression.sourceMode]}</span><h2>{expression.name}</h2><p>{expression.description}</p></div>
      </div>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={onGenerate}>
        {expression.sourceMode === "knowledge" ? (
          <div className="production-input-grid">
            <Form.Item name="productId" label="产品" rules={[{ required: true, message: "请选择产品" }]}>
              <Select placeholder="选择知识库对应产品" options={catalog.products.map((item) => ({ value: item.productId, label: item.name }))} onChange={(value) => form.setFieldValue("knowledgeSnapshotIds", catalog.products.find((item) => item.productId === value)?.knowledgeBases.map((item) => item.sourceSnapshotId) || [])} />
            </Form.Item>
            <Form.Item name="knowledgeSnapshotIds" label="资料" rules={[{ required: true, message: "请至少选择一份资料" }]}>
              <Select mode="multiple" placeholder="选择本次正文使用的资料" options={product?.knowledgeBases.map((item) => ({ value: item.sourceSnapshotId, label: item.name }))} />
            </Form.Item>
          </div>
        ) : (
          <Form.List name="factItems">
            {(fields, { add, remove }) => (
              <div className="production-fact-list">
                <div className="production-field-heading"><div><strong>事件事实</strong><span>每条事件都必须确认可以公开。</span></div><Button icon={<PlusOutlined />} onClick={() => add({ time: "", location: "", people: "", event: "", publicConfirmed: false })}>添加事件</Button></div>
                {fields.map(({ key, name, ...restField }, index) => (
                  <fieldset className="production-fact-row" key={key}>
                    <legend>事件 {index + 1}</legend>
                    <Form.Item {...restField} name={[name, "time"]} label="时间" rules={[{ required: true, message: "填写具体时间" }]}><Input placeholder="例如：2026 年 7 月 30 日 14:00" /></Form.Item>
                    <Form.Item {...restField} name={[name, "location"]} label="地点" rules={[{ required: true, message: "填写具体地点" }]}><Input placeholder="例如：东京国际会议中心" /></Form.Item>
                    <Form.Item {...restField} name={[name, "people"]} label="人物" rules={[{ required: true, message: "填写参与人物" }]}><Input placeholder="姓名、职务或可公开称谓" /></Form.Item>
                    <Form.Item {...restField} name={[name, "event"]} label="事件" rules={[{ required: true, message: "填写发生的事件" }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={1200} placeholder="客观描述发生了什么，不添加推测。" /></Form.Item>
                    <Form.Item {...restField} name={[name, "publicConfirmed"]} valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认该事件可以公开")) }]}><Checkbox>已确认以上事实可以公开</Checkbox></Form.Item>
                    {fields.length > 1 ? <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} aria-label={`删除事件 ${index + 1}`} /> : null}
                  </fieldset>
                ))}
              </div>
            )}
          </Form.List>
        )}
        {expression.sourceMode === "facts_with_meeting_text" ? (
          <Form.Item name="meetingText" label="会议文本" extra="只粘贴纯文本或 Markdown，不上传文件。" rules={[{ required: true, message: "请粘贴会议文本" }, { max: 100000, message: "会议文本不能超过 10 万字" }]}>
            <Input.TextArea className="meeting-text-input" autoSize={{ minRows: 12, maxRows: 24 }} showCount maxLength={100000} placeholder="在此粘贴会议逐字稿、整理稿或 Markdown 会议记录。" />
          </Form.Item>
        ) : null}
        <Form.Item name="expressionFocus" label="表达重点" rules={[{ required: true, message: "请填写本次表达重点" }, { max: 1200, message: "表达重点不能超过 1200 字" }]}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} showCount maxLength={1200} placeholder={expression.sourceMode === "knowledge" ? "例如：强调产品的核心竞争力，或通过什么观点引出产品重点。" : "例如：突出 JOTO 的实施交付能力，以及本次事件最值得被记住的判断。"} />
        </Form.Item>
        <div className="production-generate-action"><Button type="primary" size="large" htmlType="submit" icon={<ThunderboltOutlined />} loading={loading}>生成正文</Button></div>
      </Form>
    </section>
  );
}
