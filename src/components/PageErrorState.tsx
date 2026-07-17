"use client";

import { Alert, Button } from "antd";

interface PageErrorStateProps {
  title?: string;
  message?: string;
  description?: string;
  loading?: boolean;
  onRetry?: () => void | Promise<unknown>;
}

export function PageErrorState({ title = "数据加载失败", message, description, loading, onRetry }: PageErrorStateProps) {
  if (!message) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={title}
      description={description || `${message}。请重试并确认数据已更新，再继续处理关键事项。`}
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
