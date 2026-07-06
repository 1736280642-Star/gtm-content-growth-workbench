import type { ChannelKey, ContentType, DataConfidence, DistributionPlatformKey, DistributionTargetStatus, ProductKey, TaskStatus } from "./types";

export const channelLabels: Record<ChannelKey, string> = {
  wechat: "公众号",
  csdn: "CSDN",
  juejin: "掘金",
  zhihu_toutiao_general: "知乎/头条通用稿"
};

export const distributionPlatformLabels: Record<DistributionPlatformKey, string> = {
  weixin: "公众号",
  csdn: "CSDN",
  juejin: "掘金",
  zhihu: "知乎",
  toutiao: "今日头条"
};

export const fixedDistributionPlatforms: DistributionPlatformKey[] = ["juejin", "zhihu", "csdn", "weixin"];

export const channelDistributionTargets: Record<ChannelKey, DistributionPlatformKey[]> = {
  wechat: ["weixin"],
  csdn: ["csdn"],
  juejin: ["juejin"],
  zhihu_toutiao_general: ["zhihu"]
};

export const distributionTargetStatusLabels: Record<DistributionTargetStatus, string> = {
  pending: "待发送",
  checking: "检查中",
  auth_required: "需登录",
  ready: "可发送",
  sending: "发送中",
  draft_created: "草稿已创建",
  failed: "发送失败",
  cancelled: "已取消"
};

export const distributionTargetStatusColors: Record<DistributionTargetStatus, string> = {
  pending: "default",
  checking: "blue",
  auth_required: "gold",
  ready: "cyan",
  sending: "processing",
  draft_created: "green",
  failed: "red",
  cancelled: "default"
};

export const productLabels: Record<ProductKey, string> = {
  joto_brand: "JOTO 官方品牌",
  weike_guardrails: "唯客 AI 护栏"
};

export const contentTypeLabels: Record<ContentType, string> = {
  brand: "品牌",
  scenario: "场景",
  technical: "技术解释",
  faq: "FAQ",
  comparison: "对比",
  case: "案例"
};

export const statusLabels: Record<TaskStatus, string> = {
  planned: "计划中",
  confirmed: "已确认",
  rejected: "已驳回",
  generated: "已生成",
  qa_failed: "质检失败",
  pending_review: "待确认",
  approved: "已确认终稿",
  queued: "待发布",
  published: "已发布",
  url_filled: "已回填",
  measured: "已复盘"
};

export const confidenceLabels: Record<DataConfidence, string> = {
  real: "真实数据",
  imported: "导入数据",
  demo: "Demo 数据",
  pending: "待接入"
};

export const confidenceColors: Record<DataConfidence, string> = {
  real: "green",
  imported: "blue",
  demo: "default",
  pending: "gold"
};
