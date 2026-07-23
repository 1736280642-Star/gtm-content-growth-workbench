"use client";

import { CheckCircleOutlined, DisconnectOutlined, SafetyCertificateOutlined, ToolOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Space, Tag } from "antd";
import type { CaptureEnvironmentStatus as CaptureEnvironmentStatusValue } from "@/lib/v5/observation-contracts";

const statusLabels = {
  connected: "已连接",
  disconnected: "未连接",
  pending_config: "待配置",
  ready: "可用",
  offline: "离线",
  needs_login: "需登录",
  adapter_mismatch: "结构待更新",
  unsupported: "尚未支持"
} as const;

function statusColor(status: string) {
  if (status === "ready" || status === "connected") return "green";
  if (status === "needs_login" || status === "adapter_mismatch") return "orange";
  if (status === "offline") return "red";
  return "default";
}

export function CaptureEnvironmentStatus({
  value,
  loading,
  onRefresh
}: {
  value: CaptureEnvironmentStatusValue;
  loading?: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="capture-environment-stack">
      {value.source === "pending_config" ? (
        <Alert
          showIcon
          type="warning"
          message="本地采集链路尚未就绪"
          description={value.runner.recoveryAction}
          action={<Button size="small" loading={loading} onClick={onRefresh}>重新检查</Button>}
        />
      ) : null}
      <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
        <Descriptions.Item label={<Space><SafetyCertificateOutlined />浏览器伴侣</Space>}>
          <Space wrap>
            <Tag color={statusColor(value.extension.status)}>{statusLabels[value.extension.status]}</Tag>
            <span>{value.extension.version || "版本待上报"}</span>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={<Space><ToolOutlined />本地 Runner</Space>}>
          <Space wrap>
            <Tag color={statusColor(value.runner.status)}>{statusLabels[value.runner.status]}</Tag>
            <span>队列 {value.runner.queueDepth}</span>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="隐私边界" span={2}>
          <Space wrap>
            <Tag icon={<CheckCircleOutlined />} color="green">不上传 Cookie</Tag>
            <Tag icon={<CheckCircleOutlined />} color="green">不上传密码或 Token</Tag>
            <Tag icon={<CheckCircleOutlined />} color="green">仅采集任务页面</Tag>
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <div className="capture-adapter-list">
        {value.adapters.map((adapter) => (
          <div className="capture-adapter-row" key={adapter.platform}>
            <div>
              <strong>{adapter.platform === "chatgpt" ? "ChatGPT" : adapter.platform}</strong>
              <span>{adapter.message}</span>
            </div>
            <Tag icon={adapter.status === "ready" ? <CheckCircleOutlined /> : <DisconnectOutlined />} color={statusColor(adapter.status)}>
              {statusLabels[adapter.status]}
            </Tag>
          </div>
        ))}
      </div>
    </div>
  );
}
