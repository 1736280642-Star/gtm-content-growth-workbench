"use client";

import { Button, Descriptions, Space, Table, Tag, Timeline, Tooltip } from "antd";
import type { FrontendCaptureTask, FrontendCaptureTaskStatus } from "@/lib/v5/observation-contracts";

const statusLabels: Record<FrontendCaptureTaskStatus, string> = {
  draft: "草稿",
  environment_checking: "检查环境",
  queued: "排队中",
  waiting_for_browser: "等待浏览器",
  submitting_prompt: "输入问题",
  streaming: "接收回答",
  stabilizing: "等待稳定",
  capturing: "保存中",
  completed: "已完成",
  needs_login: "登录失效",
  adapter_mismatch: "适配器失配",
  interrupted: "已中断",
  timed_out: "已超时",
  capture_failed: "捕获失败",
  cancelled: "已取消"
};

function statusColor(status: FrontendCaptureTaskStatus) {
  if (status === "completed") return "green";
  if (["needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"].includes(status)) return "red";
  if (status === "waiting_for_browser") return "orange";
  return "blue";
}

export function FrontendCaptureTaskTable({
  tasks,
  selectedTaskIds,
  onSelectionChange,
  onViewAnswer,
  onCompare
}: {
  tasks: FrontendCaptureTask[];
  selectedTaskIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onViewAnswer: (task: FrontendCaptureTask) => void;
  onCompare: () => void;
}) {
  const selectedTasks = tasks.filter((item) => selectedTaskIds.includes(item.id));
  const sameQuestion = new Set(selectedTasks.map((item) => item.questionKey)).size <= 1;

  return (
    <div className="capture-task-table-shell">
      <Table
        rowKey="id"
        size="small"
        scroll={{ x: 900 }}
        dataSource={tasks}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        rowSelection={{
          selectedRowKeys: selectedTaskIds,
          preserveSelectedRowKeys: true,
          onChange: (keys) => onSelectionChange(keys.map(String).slice(-2)),
          getCheckboxProps: (record) => ({ disabled: record.status !== "completed" })
        }}
        expandable={{
          expandedRowRender: (task) => (
            <div className="capture-task-expanded">
              <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                <Descriptions.Item label="采集环境">Chrome {task.browserVersion || "待上报"} / 适配器 {task.adapterVersion || "待上报"}</Descriptions.Item>
                <Descriptions.Item label="条件">{task.condition.region} · {task.condition.locale} · 新会话 · 未个性化</Descriptions.Item>
                <Descriptions.Item label="SHA-256">{task.artifactId ? task.artifactId.replace("capture-artifact-", "").slice(0, 18) : "待生成"}</Descriptions.Item>
              </Descriptions>
              {task.failure ? (
                <div className="capture-recovery-note">
                  <strong>{task.failure.reason}</strong>
                  <span>已保留：{task.failure.retainedData.join("、") || "无"}；下一步：{task.failure.recoveryAction}</span>
                </div>
              ) : null}
              <Timeline
                className="capture-status-timeline"
                items={task.statusHistory.map((item) => ({ children: `${statusLabels[item.status]} · ${item.note}` }))}
              />
            </div>
          )
        }}
        columns={[
          { title: "任务时间", dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
          { title: "问题", dataIndex: "questionText", ellipsis: true, render: (value: string, task) => <div className="capture-question-cell"><strong>{value}</strong>{task.temporaryQuestion ? <Tag>临时问题</Tag> : null}</div> },
          { title: "平台", dataIndex: "platform", width: 110, render: () => "ChatGPT" },
          { title: "状态", dataIndex: "status", width: 120, render: (value: FrontendCaptureTaskStatus) => <Tag color={statusColor(value)}>{statusLabels[value]}</Tag> },
          {
            title: "结果",
            width: 180,
            render: (_, task) => task.status === "completed"
              ? <span>{task.answerId ? "回答已保存" : "等待回答"}</span>
              : task.failure
                ? <Tooltip title={task.failure.recoveryAction}><span className="capture-error-text">查看恢复路径</span></Tooltip>
                : <span className="muted">{statusLabels[task.status]}</span>
          },
          { title: "操作", width: 110, fixed: "right", render: (_, task) => <Button type="link" size="small" disabled={!task.answerId} onClick={() => onViewAnswer(task)}>查看回答</Button> }
        ]}
      />
      <div className="capture-selection-bar">
        <span>已选择 {selectedTaskIds.length} 项{!sameQuestion ? "，两次任务必须属于同一问题" : ""}</span>
        <Space>
          <Button onClick={() => onSelectionChange([])} disabled={!selectedTaskIds.length}>清空</Button>
          <Button type="primary" onClick={onCompare} disabled={selectedTaskIds.length !== 2 || !sameQuestion}>对比所选任务</Button>
        </Space>
      </div>
    </div>
  );
}
