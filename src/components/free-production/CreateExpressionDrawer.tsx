"use client";

import { Button, Drawer, Form, Input, Select } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { CreateFreeExpressionInput, FreeContentExpressionTypeSummary, FreeProductionCatalog } from "@/lib/v5/free-production-contracts";

const sourceModeOptions = [
  { value: "knowledge", label: "产品与知识库" },
  { value: "facts", label: "事件事实" },
  { value: "facts_with_meeting_text", label: "事件事实 + 会议文本" }
];

export function CreateExpressionDrawer({ open, catalog, saving, onClose, onSubmit }: { open: boolean; catalog: FreeProductionCatalog; saving?: boolean; onClose: () => void; onSubmit: (input: CreateFreeExpressionInput) => void }) {
  const [form] = Form.useForm<CreateFreeExpressionInput>();
  const [mobile, setMobile] = useState(false);
  const systemExpressions = useMemo(() => catalog.expressionTypes.filter((item): item is FreeContentExpressionTypeSummary => Boolean(item.activeVersion?.systemManaged)), [catalog.expressionTypes]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)"); const update = () => setMobile(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const base = systemExpressions[0]?.activeVersion;
    form.setFieldsValue({ name: "", baseTypeId: systemExpressions[0]?.typeId, sourceMode: base?.sourceMode || "knowledge", description: "", visualSuggestionMode: "placeholders" });
  }, [catalog, form, open, systemExpressions]);

  return (
    <Drawer className="create-expression-drawer" title="新建类型" open={open} onClose={onClose} placement={mobile ? "bottom" : "right"} height={mobile ? "88vh" : undefined} width={mobile ? undefined : 520} extra={<span className="drawer-step-label">保存后填写本次资料</span>} footer={<div className="drawer-action-row"><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={() => void form.validateFields().then(onSubmit)}>保存类型</Button></div>}>
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label="类型名称" rules={[{ required: true }, { min: 2 }, { max: 30 }]}><Input placeholder="例如：客户交付复盘" /></Form.Item>
        <Form.Item name="baseTypeId" label="基础内容类型" rules={[{ required: true }]}><Select options={systemExpressions.map((item) => ({ value: item.typeId, label: item.activeVersion!.name }))} onChange={(value) => form.setFieldValue("sourceMode", systemExpressions.find((item) => item.typeId === value)?.activeVersion?.sourceMode)} /></Form.Item>
        <Form.Item name="sourceMode" label="资料入口" rules={[{ required: true }]}><Select options={sourceModeOptions} /></Form.Item>
        <Form.Item name="description" label="类型说明" extra="说明这个类型面向谁、需要表达什么；具体产品和资料在每次生产时选择。" rules={[{ required: true }, { max: 1000 }]}><Input.TextArea autoSize={{ minRows: 5, maxRows: 9 }} placeholder="例如：用于复盘客户现场的任务变化，强调可核验结果和人工判断边界。" /></Form.Item>
      </Form>
    </Drawer>
  );
}
