"use client";

import {
  CheckCircleOutlined,
  EyeOutlined,
  PlusOutlined,
  RobotOutlined,
  StopOutlined,
  WarningOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { Key } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type {
  V5ContentCoverageRow,
  V5MonthlyQuestionLock,
  V5QuestionDecisionException,
  V5QuestionStatus,
  V5QuestionView,
  V5SemanticKeyword
} from "@/lib/v5/question-contracts";

type QuestionsResponse = {
  ok: true;
  data: {
    questions: V5QuestionView[];
    keywords: V5SemanticKeyword[];
    decisionExceptions: V5QuestionDecisionException[];
    coverage: V5ContentCoverageRow[];
    monthlyQuestionLocks: V5MonthlyQuestionLock[];
    stateVersion: number;
  };
};

const statusLabels: Record<V5QuestionStatus, string> = {
  available: "可用",
  observing: "观察",
  decision_required: "待决策",
  archived: "已归档"
};

const statusColors: Record<V5QuestionStatus, string> = {
  available: "green",
  observing: "gold",
  decision_required: "red",
  archived: "default"
};

const keywordStatusLabels: Record<V5SemanticKeyword["status"], string> = {
  effective: "有效",
  observing: "观察",
  excluded: "已排除"
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function questionStateReason(question: V5QuestionView) {
  if (question.conflictAssessment.hasConflict) {
    const labels = question.conflictAssessment.categories.map((item) => item === "semantic" ? "语义冲突" : "业务冲突");
    return `与现有问题池存在${labels.join("、") || "冲突"}`;
  }
  const reasons = [
    question.knowledgeReadiness.hasProductExpressionRulePackage ? "表达规则已匹配" : "缺少产品表达规则包",
    question.knowledgeReadiness.hasFactSourceMapping ? "事实来源已映射" : "缺少事实来源映射"
  ];
  return reasons.join(" · ");
}

export default function QuestionsKeywordsPage() {
  const {
    state: { workspaceSetting }
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [data, setData] = useState<QuestionsResponse["data"]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activeTab, setActiveTab] = useState("questions");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<V5QuestionStatus | "all">("all");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Key[]>([]);
  const [detailQuestion, setDetailQuestion] = useState<V5QuestionView>();
  const [editingQuestion, setEditingQuestion] = useState<V5QuestionView>();
  const [addOpen, setAddOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [selectedDecisionIds, setSelectedDecisionIds] = useState<Key[]>([]);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(currentMonth());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await callJsonApi<QuestionsResponse>("/api/v5/questions", { cache: "no-store" });
      setData(result.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "问题与关键词加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleQuestions = useMemo(() => (data?.questions || []).filter((item) => {
    const haystack = `${item.currentVersion.text} ${item.currentVersion.product || ""} ${item.keywords.join(" ")}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (statusFilter === "all" || item.status === statusFilter);
  }), [data?.questions, search, statusFilter]);
  const openDecisions = data?.decisionExceptions || [];
  const lockedQuestionIds = new Set((data?.monthlyQuestionLocks || []).filter((item) => item.month === month).map((item) => item.questionId));

  async function addQuestion() {
    const values = await form.validateFields();
    if (!data) return;
    setSaving(true);
    try {
      await callJsonApi(editingQuestion ? `/api/v5/questions/${editingQuestion.questionId}` : "/api/v5/questions", {
        method: editingQuestion ? "PATCH" : "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, editingQuestion?.rowVersion ?? data.stateVersion, editingQuestion ? "纠正系统对问题的理解" : "人工补充业务问题"),
          text: values.text,
          product: values.product,
          audience: values.audience,
          suggestedArticleTypes: values.articleTypes || [],
          keywords: values.keywords || []
        })
      });
      setAddOpen(false);
      setEditingQuestion(undefined);
      form.resetFields();
      await refresh();
      messageApi.success(editingQuestion ? "系统理解已纠正，并创建了新的问题版本。" : "问题已归纳，系统将按知识对象和冲突检查自动确定状态。");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "补充问题失败");
    } finally {
      setSaving(false);
    }
  }

  async function selectMonthlyQuestions() {
    if (!data || selectedQuestionIds.length === 0) return;
    setSaving(true);
    try {
      await callJsonApi("/api/v5/questions/select-monthly", {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, data.stateVersion, `选择 ${month} 月度目标问题并锁定版本`),
          month,
          questionIds: selectedQuestionIds.map(String)
        })
      });
      setSelectedQuestionIds([]);
      await refresh();
      messageApi.success(`已锁定 ${month} 的问题版本，后续自动优化不会改写本月计划。`);
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "选择月度目标失败");
    } finally {
      setSaving(false);
    }
  }

  async function resolveDecisions(exceptionIds: string[]) {
    if (!exceptionIds.length) return;
    const exceptions = openDecisions.filter((item) => exceptionIds.includes(item.exceptionId));
    setSaving(true);
    try {
      await callJsonApi("/api/v5/question-decision-exceptions/batch-resolve", {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, exceptions[0]?.rowVersion || 0, "采用问题边界冲突的系统建议"),
          resolutions: exceptions.map((item) => ({ exceptionId: item.exceptionId, action: "adopt_suggestion", expectedVersion: item.rowVersion }))
        })
      });
      setSelectedDecisionIds([]);
      await refresh();
      if (exceptions.length === openDecisions.length) setDecisionOpen(false);
      messageApi.success(`已处理 ${exceptions.length} 条待决策事项。`);
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "处理待决策事项失败");
    } finally {
      setSaving(false);
    }
  }

  async function excludeKeyword(keyword: V5SemanticKeyword) {
    const reason = "当前关键词与业务问题覆盖方向不匹配";
    setSaving(true);
    try {
      await callJsonApi(`/api/v5/semantic-keywords/${keyword.keywordId}/exclude`, {
        method: "POST",
        body: JSON.stringify({
          ...createV5WritePayload(workspaceSetting.currentRole, keyword.rowVersion, reason),
          reason
        })
      });
      await refresh();
      messageApi.success("关键词已排除，系统不会自动恢复该人工排除项。");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "排除关键词失败");
    } finally {
      setSaving(false);
    }
  }

  async function restoreKeyword(keyword: V5SemanticKeyword) {
    const reason = "人工确认恢复该关键词的系统维护";
    setSaving(true);
    try {
      await callJsonApi(`/api/v5/semantic-keywords/${keyword.keywordId}/restore`, {
        method: "POST",
        body: JSON.stringify({ ...createV5WritePayload(workspaceSetting.currentRole, keyword.rowVersion, reason), reason })
      });
      await refresh();
      messageApi.success("关键词已恢复，将继续由系统自动维护。 ");
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "恢复关键词失败");
    } finally {
      setSaving(false);
    }
  }

  function openQuestionEditor(question: V5QuestionView) {
    setEditingQuestion(question);
    form.setFieldsValue({
      text: question.currentVersion.text,
      product: question.currentVersion.product,
      audience: question.currentVersion.audience,
      articleTypes: question.currentVersion.suggestedArticleTypes,
      keywords: question.keywords
    });
    setDetailQuestion(undefined);
    setAddOpen(true);
  }

  const questionTab = (
    <Card className="foundation-panel" bordered={false}>
      <div className="foundation-toolbar">
        <Input.Search allowClear placeholder="搜索问题、产品或关键词" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "全部状态" },
            { value: "available", label: "可用" },
            { value: "observing", label: "观察" },
            { value: "decision_required", label: "待决策" }
          ]}
        />
        <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="月度目标月份" />
      </div>
      <Table
        rowKey="questionId"
        loading={loading}
        dataSource={visibleQuestions}
        rowSelection={{
          selectedRowKeys: selectedQuestionIds,
          onChange: setSelectedQuestionIds,
          getCheckboxProps: (record) => ({ disabled: record.status === "decision_required" || lockedQuestionIds.has(record.questionId) })
        }}
        locale={{ emptyText: <ActionEmpty title="尚未识别到问题" description="接入业务信号，或补充一个真实业务问题。" /> }}
        scroll={{ x: 1090 }}
        columns={[
          {
            title: "问题",
            dataIndex: ["currentVersion", "text"],
            width: 360,
            render: (_, record) => (
              <div className="foundation-question-cell">
                <strong>{record.currentVersion.text}</strong>
                <span>{record.currentVersion.product || "未识别产品"} · {record.currentVersion.audience || "未识别受众"}</span>
                <Space size={[4, 4]} wrap>{record.keywords.slice(0, 4).map((item) => <Tag key={item}>{item}</Tag>)}</Space>
              </div>
            )
          },
          {
            title: "文章类型建议",
            dataIndex: ["currentVersion", "suggestedArticleTypes"],
            width: 220,
            render: (items: string[]) => items.join("、") || "待自动归纳"
          },
          {
            title: "状态",
            width: 250,
            render: (_, record) => (
              <Space direction="vertical" size={3}>
                <Tag color={statusColors[record.status]}>{statusLabels[record.status]}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{questionStateReason(record)}</Typography.Text>
              </Space>
            )
          },
          {
            title: "来源",
            width: 120,
            render: (_, record) => <Tag>{record.currentVersion.trace.source === "demo" ? "demo" : "自动归纳"}</Tag>
          },
          {
            title: "操作",
            width: 100,
            fixed: "right" as const,
            render: (_, record) => <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailQuestion(record)}>查看</Button>
          }
        ]}
      />
      <div className="foundation-selection-bar">
        <Typography.Text>已选择 {selectedQuestionIds.length} 项；观察问题可保留为月度目标，正式生产仍需通过 Evidence Gate；待决策问题需先解决冲突。</Typography.Text>
        <Button type="primary" disabled={!selectedQuestionIds.length} loading={saving} onClick={selectMonthlyQuestions}>选择为本月目标问题</Button>
      </div>
    </Card>
  );

  const keywordTab = (
    <Card className="foundation-panel" bordered={false}>
      <Alert showIcon type="info" message="关键词由系统自动维护" description="系统按召回效果自动提取、关联和升降级；无需逐条审核、手动启用或分配角色。" />
      <Table
        rowKey="keywordId"
        loading={loading}
        dataSource={data?.keywords || []}
        scroll={{ x: 860 }}
        columns={[
          { title: "关键词", dataIndex: "text", width: 240, render: (value) => <strong>{value}</strong> },
          { title: "关联问题", dataIndex: "relatedQuestionIds", width: 110, render: (value: string[]) => value.length },
          { title: "关联实体", dataIndex: "relatedEntities", render: (value: string[]) => value.join(" / ") || "-" },
          { title: "覆盖效果", dataIndex: "recallScore", width: 170, render: (value: number) => <Progress percent={Math.round(value * 100)} size="small" /> },
          { title: "系统状态", dataIndex: "status", width: 110, render: (value: V5SemanticKeyword["status"]) => <Tag color={value === "effective" ? "green" : value === "observing" ? "gold" : "default"}>{keywordStatusLabels[value]}</Tag> },
          {
            title: "操作",
            width: 100,
            render: (_, record) => record.status === "excluded" ? <Button size="small" onClick={() => restoreKeyword(record)}>恢复</Button> : (
              <Popconfirm title="排除这个关键词？" description="系统不会自动恢复人工排除项。" onConfirm={() => excludeKeyword(record)}>
                <Button size="small" icon={<StopOutlined />} loading={saving}>排除</Button>
              </Popconfirm>
            )
          }
        ]}
      />
    </Card>
  );

  const coverageTab = (
    <Card className="foundation-panel" bordered={false}>
      <Table
        rowKey={(record) => `${record.questionVersionId}-${record.articleType}`}
        dataSource={data?.coverage || []}
        pagination={false}
        columns={[
          { title: "目标问题", dataIndex: "question", width: 360 },
          { title: "文章类型", dataIndex: "articleType", width: 180 },
          { title: "已发布 / 计划", render: (_, record) => `${record.publishedCount} / ${record.plannedCount}`, width: 140 },
          { title: "证据提示", dataIndex: "evidenceGap", render: (value) => value ? <Tag color="gold">{value}</Tag> : <Tag color="green">当前无缺口</Tag> }
        ]}
      />
    </Card>
  );

  return (
    <>
      {contextHolder}
      <PageHeader
        title="问题与关键词池"
        subtitle="系统自动归纳问题和关键词，人工只处理边界异常并选择月度目标。"
        titleExtra={<Tag color="blue" icon={<RobotOutlined />}>系统持续维护</Tag>}
        actions={
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>补充问题</Button>
            <Button danger={openDecisions.length > 0} icon={<WarningOutlined />} onClick={() => setDecisionOpen(true)}>待决策 {openDecisions.length}</Button>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading && !data} onRetry={refresh} />
      <div className="metric-grid">
        <MetricCard title="问题库" value={data?.questions.length || 0} suffix="项" />
        <MetricCard title="自动可用" value={data?.questions.filter((item) => item.status === "available").length || 0} suffix="项" />
        <MetricCard title="观察中" value={data?.questions.filter((item) => item.status === "observing").length || 0} suffix="项" />
        <MetricCard title="关键词库" value={data?.keywords.length || 0} suffix="个" />
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "questions", label: `问题库 ${data?.questions.length || 0}`, children: questionTab },
          { key: "keywords", label: `关键词库 ${data?.keywords.length || 0}`, children: keywordTab },
          { key: "coverage", label: "内容覆盖", children: coverageTab }
        ]}
      />

      <Drawer title="问题详情" open={Boolean(detailQuestion)} onClose={() => setDetailQuestion(undefined)} width={560}>
        {detailQuestion ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <div>
              <Typography.Text type="secondary">问题文本</Typography.Text>
              <Typography.Title level={4}>{detailQuestion.currentVersion.text}</Typography.Title>
            </div>
            <Descriptions column={1} size="small" title="系统理解" bordered>
              <Descriptions.Item label="产品或服务">{detailQuestion.currentVersion.product || "待识别"}</Descriptions.Item>
              <Descriptions.Item label="相关主体">{detailQuestion.currentVersion.entities.join("、") || "待识别"}</Descriptions.Item>
              <Descriptions.Item label="业务关系">{detailQuestion.currentVersion.relationship || "待识别"}</Descriptions.Item>
              <Descriptions.Item label="适用对象">{detailQuestion.currentVersion.audience || "待识别"}</Descriptions.Item>
              <Descriptions.Item label="系统建议文章类型">{detailQuestion.currentVersion.suggestedArticleTypes.join("、")}</Descriptions.Item>
              <Descriptions.Item label="状态依据">{questionStateReason(detailQuestion)}</Descriptions.Item>
            </Descriptions>
            <Alert
              showIcon
              type={detailQuestion.status === "decision_required" ? "warning" : "success"}
              message={`当前状态：${statusLabels[detailQuestion.status]}`}
              description={`当前为 v${detailQuestion.currentVersion.versionNumber}；被月度计划选择时会自动锁定该 questionVersionId。`}
            />
            <Button onClick={() => openQuestionEditor(detailQuestion)}>纠正系统理解</Button>
          </Space>
        ) : null}
      </Drawer>

      <Modal title={editingQuestion ? "纠正系统理解" : "补充问题"} open={addOpen} onCancel={() => { setAddOpen(false); setEditingQuestion(undefined); }} onOk={addQuestion} confirmLoading={saving} okText={editingQuestion ? "保存新版本" : "归纳并入池"}>
        <Form form={form} layout="vertical">
          <Form.Item name="text" label="业务问题" rules={[{ required: true, message: "请填写一个真实业务问题" }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item>
          <Form.Item name="product" label="相关产品（可选）"><Input placeholder="例如：腾讯云 ADP" /></Form.Item>
          <Form.Item name="audience" label="适用对象（可选）"><Input placeholder="例如：企业 AI 项目负责人" /></Form.Item>
          <Form.Item name="articleTypes" label="文章类型建议（可选）"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
          <Form.Item name="keywords" label="补充关键词（可选）"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`待决策 ${openDecisions.length}`}
        open={decisionOpen}
        onCancel={() => setDecisionOpen(false)}
        width={820}
        footer={[
          <Button key="close" onClick={() => setDecisionOpen(false)}>关闭</Button>,
          <Button key="all" icon={<CheckCircleOutlined />} disabled={!openDecisions.length} loading={saving} onClick={() => resolveDecisions(openDecisions.map((item) => item.exceptionId))}>全部采用系统建议</Button>,
          <Button key="selected" type="primary" disabled={!selectedDecisionIds.length} loading={saving} onClick={() => resolveDecisions(selectedDecisionIds.map(String))}>批量采用建议</Button>
        ]}
      >
        <Alert showIcon type="warning" message="这里只处理与现有问题池的语义或业务冲突" description="缺少产品表达规则包或事实来源映射的问题会自动进入观察，不会制造人工审核队列。" />
        <List
          rowKey="exceptionId"
          dataSource={openDecisions}
          locale={{ emptyText: <ActionEmpty title="没有待决策事项" description="系统会继续自动维护问题池。" /> }}
          renderItem={(item) => (
            <List.Item>
              <Space align="start">
                <input
                  type="checkbox"
                  aria-label={`选择 ${item.title}`}
                  checked={selectedDecisionIds.includes(item.exceptionId)}
                  onChange={(event) => setSelectedDecisionIds((current) => event.target.checked ? [...current, item.exceptionId] : current.filter((id) => id !== item.exceptionId))}
                />
                <div>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ margin: "4px 0" }}>{item.explanation}</Typography.Paragraph>
                  <Typography.Text>系统建议：{item.suggestion}</Typography.Text>
                </div>
              </Space>
              <Button size="small" onClick={() => resolveDecisions([item.exceptionId])}>采用</Button>
            </List.Item>
          )}
        />
      </Modal>
    </>
  );
}
