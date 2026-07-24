"use client";

import { SwapOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Select, Space, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import type { CaptureComparison, FrontendCaptureTask } from "@/lib/v5/observation-contracts";

export function CaptureComparisonWorkspace({ tasks, initialTaskIds, result, loading, onCompare }: {
  tasks: FrontendCaptureTask[];
  initialTaskIds?: string[];
  result?: CaptureComparison;
  loading?: boolean;
  onCompare: (baselineTaskId: string, comparisonTaskId: string) => Promise<void>;
}) {
  const completed = tasks.filter((item) => item.status === "completed" && item.answerId);
  const [questionKey, setQuestionKey] = useState(() => completed.find((item) => initialTaskIds?.includes(item.id))?.questionKey || completed[0]?.questionKey);
  const questionTasks = useMemo(() => completed.filter((item) => item.questionKey === questionKey), [completed, questionKey]);
  const [baselineTaskId, setBaselineTaskId] = useState(initialTaskIds?.[0]);
  const [comparisonTaskId, setComparisonTaskId] = useState(initialTaskIds?.[1]);
  const baseline = completed.find((item) => item.id === baselineTaskId);
  const comparison = completed.find((item) => item.id === comparisonTaskId);
  const conditionMismatch = Boolean(baseline && comparison && (
    baseline.platform !== comparison.platform ||
    JSON.stringify(baseline.condition) !== JSON.stringify(comparison.condition) ||
    baseline.adapterVersion !== comparison.adapterVersion
  ));
  const questionOptions = Array.from(new Map(completed.map((item) => [item.questionKey, item.questionText])).entries()).map(([value, label]) => ({ value, label }));
  const taskOptions = questionTasks.map((item) => ({ value: item.id, label: `${new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })} / ChatGPT / ${item.condition.region}` }));

  if (!completed.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="至少完成两次同一问题的单次采集后，才能生成任务对比。" />;

  return (
    <div className="capture-comparison-workspace">
      <div className="capture-comparison-controls">
        <label><span>问题</span><Select value={questionKey} options={questionOptions} onChange={(value) => { setQuestionKey(value); setBaselineTaskId(undefined); setComparisonTaskId(undefined); }} /></label>
        <label><span>基准任务</span><Select value={baselineTaskId} options={taskOptions} onChange={setBaselineTaskId} placeholder="选择一次历史任务" /></label>
        <Button aria-label="交换任务" icon={<SwapOutlined />} onClick={() => { setBaselineTaskId(comparisonTaskId); setComparisonTaskId(baselineTaskId); }} />
        <label><span>对比任务</span><Select value={comparisonTaskId} options={taskOptions.filter((item) => item.value !== baselineTaskId)} onChange={setComparisonTaskId} placeholder="选择另一次历史任务" /></label>
        <Button type="primary" loading={loading} disabled={!baselineTaskId || !comparisonTaskId || baselineTaskId === comparisonTaskId} onClick={() => onCompare(baselineTaskId!, comparisonTaskId!)}>生成对比</Button>
      </div>
      {conditionMismatch ? <Alert showIcon type="warning" message="两次采集条件不一致" description="仍可比较，但结果只表示两个样本的差异，不生成趋势结论。" /> : <Alert showIcon type="info" message="任务对比不等于趋势分析" description="即使条件一致，P0 也只描述两次采集样本的差异，不推断平台全局变化。" />}
      {result ? (
        <div className="capture-comparison-result">
          <Alert showIcon type={result.conditionsMatched ? "info" : "warning"} message={result.warning} />
          {result.conditionDifferences.length ? <div className="capture-condition-differences"><strong>条件差异</strong><Space wrap>{result.conditionDifferences.map((item) => <Tag key={item.field}>{item.field}: {item.baselineValue} → {item.comparisonValue}</Tag>)}</Space></div> : null}
          <Table rowKey="label" size="small" pagination={false} dataSource={result.metrics} columns={[
            { title: "指标", dataIndex: "label" },
            { title: "基准任务", dataIndex: "baseline" },
            { title: "对比任务", dataIndex: "comparison" },
            { title: "样本差异", dataIndex: "change" }
          ]} />
          <div className="semantic-change-list"><strong>回答语义差异</strong>{result.semanticChanges.length ? result.semanticChanges.map((item, index) => <div key={`${item.type}-${index}`}><Tag color={item.type === "added" ? "green" : item.type === "removed" ? "red" : "default"}>{item.type === "added" ? "+" : item.type === "removed" ? "-" : "="}</Tag><span>{item.text}</span></div>) : <span>未检测到可展示的结构化差异。</span>}</div>
        </div>
      ) : null}
    </div>
  );
}
