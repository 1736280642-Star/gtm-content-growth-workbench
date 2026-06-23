import { Empty, Space, Typography } from "antd";
import type { ReactNode } from "react";

interface ActionEmptyProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function ActionEmpty({ title, description, action }: ActionEmptyProps) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Space direction="vertical" size={6}>
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary">{description}</Typography.Text>
          {action}
        </Space>
      }
    />
  );
}
