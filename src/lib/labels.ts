import type { ChannelKey, ContentType, DataConfidence, ProductKey, TaskStatus } from "./types";

export const channelLabels: Record<ChannelKey, string> = {
  wechat: "公众号",
  csdn: "CSDN",
  juejin: "掘金",
  zhihu_toutiao_general: "知乎/头条通用稿"
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

