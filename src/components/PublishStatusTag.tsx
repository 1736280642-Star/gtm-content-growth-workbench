import { Tag } from "antd";
import type { PublishStatus } from "@/lib/v5-ui-mock-data";

const publishStatusLabels: Record<PublishStatus, string> = {
  scheduled: "已排程",
  waiting: "待发布",
  publishing: "发布中",
  published: "已发布",
  failed: "发布失败",
  manual_takeover: "人工接管"
};

const publishStatusColors: Record<PublishStatus, string> = {
  scheduled: "blue",
  waiting: "cyan",
  publishing: "processing",
  published: "green",
  failed: "red",
  manual_takeover: "orange"
};

export function PublishStatusTag({ status }: { status: PublishStatus }) {
  return <Tag color={publishStatusColors[status]}>{publishStatusLabels[status]}</Tag>;
}
