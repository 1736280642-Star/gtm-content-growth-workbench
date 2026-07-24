"use client";

import { Alert, Checkbox, Form, Input, Modal, Radio, Select, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import type {
  AiFrontendPlatform,
  CaptureEnvironmentStatus,
  FrontendCaptureCondition,
  ObservationQuestionReference
} from "@/lib/v5/observation-contracts";

interface CaptureFormValue {
  source: "formal" | "temporary";
  questionVersionId?: string;
  temporaryQuestionText?: string;
  platforms: AiFrontendPlatform[];
  locale: string;
  region: string;
  modelLabel: string;
}

export function NewCaptureTaskDialog({
  open,
  questions,
  environment,
  submitting,
  onCancel,
  onSubmit
}: {
  open: boolean;
  questions: ObservationQuestionReference[];
  environment: CaptureEnvironmentStatus;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    questionVersionId?: string;
    temporaryQuestionText?: string;
    platforms: AiFrontendPlatform[];
    condition: FrontendCaptureCondition;
  }) => Promise<void>;
}) {
  const [form] = Form.useForm<CaptureFormValue>();
  const [source, setSource] = useState<CaptureFormValue["source"]>(questions.length ? "formal" : "temporary");

  useEffect(() => {
    if (!questions.length) setSource("temporary");
  }, [questions.length]);

  async function submit() {
    const value = await form.validateFields();
    await onSubmit({
      questionVersionId: value.source === "formal" ? value.questionVersionId : undefined,
      temporaryQuestionText: value.source === "temporary" ? value.temporaryQuestionText : undefined,
      platforms: value.platforms,
      condition: {
        locale: value.locale,
        region: value.region,
        modelLabel: value.modelLabel,
        conversationMode: "new_conversation",
        personalizationMode: "off"
      }
    });
    form.resetFields();
  }

  return (
    <Modal
      title="新建单次采集任务"
      open={open}
      okText="立即开始采集"
      cancelText="取消"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={submit}
      width={680}
      destroyOnClose
    >
      <Form<CaptureFormValue>
        form={form}
        layout="vertical"
        initialValues={{
          source,
          platforms: ["chatgpt"],
          locale: "zh-CN",
          region: "上海",
          modelLabel: "平台默认"
        }}
      >
        <Form.Item label="问题来源" name="source" rules={[{ required: true }]}>
          <Radio.Group onChange={(event) => setSource(event.target.value)}>
            <Radio value="formal" disabled={!questions.length}>从正式问题池选择</Radio>
            <Radio value="temporary">临时测试问题</Radio>
          </Radio.Group>
        </Form.Item>
        {source === "formal" ? (
          <Form.Item label="问题" name="questionVersionId" rules={[{ required: true, message: "请选择问题" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="搜索并选择问题"
              options={questions.map((item) => ({ value: item.questionVersionId, label: item.text }))}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label="临时测试问题"
            name="temporaryQuestionText"
            extra="临时问题只用于本次测试，不会自动进入正式问题池。"
            rules={[{ required: true, message: "请输入临时测试问题" }, { max: 500 }]}
          >
            <Input.TextArea rows={3} placeholder="输入一个明确、可直接提交给 AI 平台的问题" />
          </Form.Item>
        )}
        <Form.Item label="AI 平台" name="platforms" rules={[{ required: true, message: "请选择平台" }]}>
          <Checkbox.Group>
            <Space wrap>
              <Checkbox value="chatgpt">ChatGPT</Checkbox>
              <Checkbox value="yuanbao" disabled>元宝 <Tag>尚未支持</Tag></Checkbox>
              <Checkbox value="doubao" disabled>豆包 <Tag>尚未支持</Tag></Checkbox>
              <Checkbox value="kimi" disabled>Kimi <Tag>尚未支持</Tag></Checkbox>
            </Space>
          </Checkbox.Group>
        </Form.Item>
        <div className="capture-condition-grid">
          <Form.Item label="语言" name="locale"><Select options={[{ value: "zh-CN", label: "中文" }]} /></Form.Item>
          <Form.Item label="地区" name="region"><Select options={[{ value: "上海", label: "上海" }, { value: "北京", label: "北京" }]} /></Form.Item>
          <Form.Item label="会话"><Select value="new_conversation" disabled options={[{ value: "new_conversation", label: "新会话" }]} /></Form.Item>
          <Form.Item label="个性化"><Select value="off" disabled options={[{ value: "off", label: "关闭" }]} /></Form.Item>
          <Form.Item label="模型" name="modelLabel"><Select options={[{ value: "平台默认", label: "平台默认" }]} /></Form.Item>
        </div>
        <Alert
          showIcon
          type={environment.runner.status === "ready" ? "success" : "warning"}
          message={environment.runner.status === "ready" ? "采集环境已就绪" : "Runner 离线，任务会等待浏览器环境"}
          description="P0 仅立即执行一次，不创建重复频率、固定日期或后台周期计划。"
        />
      </Form>
    </Modal>
  );
}
