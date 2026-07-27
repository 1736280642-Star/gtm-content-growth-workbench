"use client";

import { Button, Drawer, Form, Input, Radio, Select, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { CreateFreeExpressionInput, FreeContentExpressionTypeSummary, FreeProductionCatalog, FreeProductionChannel } from "@/lib/v5/free-production-contracts";
import { FREE_PRODUCTION_CHANNELS, freeProductionChannelLabels } from "@/lib/v5/free-production-contracts";

export function CreateExpressionDrawer({ open, catalog, saving, onClose, onSubmit }: { open: boolean; catalog: FreeProductionCatalog; saving?: boolean; onClose: () => void; onSubmit: (input: CreateFreeExpressionInput) => void }) {
  const [form] = Form.useForm<CreateFreeExpressionInput>();
  const [mobile, setMobile] = useState(false);
  const channel = Form.useWatch("channel", form) as FreeProductionChannel | undefined;
  const productId = Form.useWatch("productId", form);
  const product = catalog.products.find((item) => item.productId === productId);
  const systemExpressions = useMemo(() => catalog.expressionTypes.filter((item): item is FreeContentExpressionTypeSummary => Boolean(item.activeVersion?.systemManaged)), [catalog.expressionTypes]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)"); const update = () => setMobile(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const firstProduct = catalog.products[0];
    form.setFieldsValue({ name: "", baseTypeId: systemExpressions[0]?.typeId, productId: firstProduct?.productId, knowledgeSnapshotIds: firstProduct?.knowledgeBases.map((item) => item.sourceSnapshotId) || [], channel: "wechat_official_account", publishingConnectionId: catalog.channelReadiness.find((item) => item.channel === "wechat_official_account")?.accounts[0]?.id, description: "", visualSuggestionMode: "placeholders" });
  }, [catalog, form, open, systemExpressions]);

  return (
    <Drawer className="create-expression-drawer" title="新建表达" open={open} onClose={onClose} placement={mobile ? "bottom" : "right"} height={mobile ? "88vh" : undefined} width={mobile ? undefined : 520} extra={<span className="drawer-step-label">保存后自动生成</span>} footer={<div className="drawer-action-row"><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={() => void form.validateFields().then(onSubmit)}>保存并使用</Button></div>}>
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label="表达名称" rules={[{ required: true }, { min: 2 }, { max: 30 }]}><Input placeholder="例如：ADP 客服落地复盘" /></Form.Item>
        <Form.Item name="baseTypeId" label="基础文章类型" rules={[{ required: true }]}><Select options={systemExpressions.map((item) => ({ value: item.typeId, label: item.activeVersion!.name }))} /></Form.Item>
        <Form.Item name="productId" label="产品" rules={[{ required: true }]}><Select options={catalog.products.map((item) => ({ value: item.productId, label: item.name }))} onChange={(value) => { const selected = catalog.products.find((item) => item.productId === value); form.setFieldValue("knowledgeSnapshotIds", selected?.knowledgeBases.map((item) => item.sourceSnapshotId) || []); }} /></Form.Item>
        <Form.Item name="knowledgeSnapshotIds" label="知识范围" rules={[{ required: true }]}><Select mode="multiple" options={product?.knowledgeBases.map((item) => ({ value: item.sourceSnapshotId, label: item.name }))} /></Form.Item>
        <Form.Item name="channel" label="目标渠道" rules={[{ required: true }]}><Radio.Group optionType="button" buttonStyle="solid" options={FREE_PRODUCTION_CHANNELS.map((item) => ({ value: item, label: freeProductionChannelLabels[item] }))} onChange={(event) => form.setFieldValue("publishingConnectionId", catalog.channelReadiness.find((item) => item.channel === event.target.value)?.accounts[0]?.id)} /></Form.Item>
        <Form.Item name="publishingConnectionId" label="发布账号"><Select allowClear placeholder="无默认连接时可暂不选择" options={catalog.channelReadiness.find((item) => item.channel === channel)?.accounts.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="description" label="表达说明" extra="系统会从说明中解析受众、重点、语气和标题策略；不能覆盖产品事实与承诺边界。" rules={[{ required: true }, { max: 1000 }]}><Input.TextArea autoSize={{ minRows: 5, maxRows: 9 }} placeholder="说明想写什么、面向谁、希望读者理解或采取什么行动。" /></Form.Item>
        <Form.Item name="visualSuggestionMode" label="正文视觉素材建议" valuePropName="checked" getValueFromEvent={(checked) => checked ? "placeholders" : "off"} getValueProps={(value) => ({ checked: value === "placeholders" })}><Switch checkedChildren="显示占位建议" unCheckedChildren="关闭" /></Form.Item>
      </Form>
    </Drawer>
  );
}
