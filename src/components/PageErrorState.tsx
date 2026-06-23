"use client";

import { Alert, Button } from "antd";

interface PageErrorStateProps {
  title?: string;
  message?: string;
  description?: string;
  loading?: boolean;
  onRetry?: () => void | Promise<unknown>;
}

export function PageErrorState({ title = "运行态数据同步失败", message, description, loading, onRetry }: PageErrorStateProps) {
  if (!message) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={title}
      description={description || `${message}。当前页面仍保留上一次成功加载的数据或本地兜底数据，请重试后再做关键判断。`}
      action={
        onRetry ? (
          <Button size="small" loading={loading} onClick={() => void onRetry()}>
            重试
          </Button>
        ) : undefined
      }
    />
  );
}
