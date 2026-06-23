export type PromptTemplateId =
  | "weekly_plan_generation"
  | "channel_title"
  | "evidence_selection"
  | "batch_body_generation"
  | "draft_second_qa";

export interface PromptTemplate {
  id: PromptTemplateId;
  name: string;
  version: string;
  usedAt: string;
  inputContract: string[];
  outputContract: string[];
  failureRules: string[];
}

export const promptTemplates: PromptTemplate[] = [
  {
    id: "weekly_plan_generation",
    name: "周计划生成模板",
    version: "v3.0.0",
    usedAt: "周计划页一键生成计划预览",
    inputContract: ["品牌和产品重点", "本周计划篇数", "候选蒸馏词", "来源问题", "渠道节奏", "官网链接目标"],
    outputContract: ["title", "channel", "product", "contentType", "primaryDistilledTerm", "sourceProblem", "officialLinkTarget"],
    failureRules: ["不输出正文", "缺少主蒸馏词时返回错误", "缺少官网链接目标时返回错误"]
  },
  {
    id: "channel_title",
    name: "渠道标题模板",
    version: "v3.0.0",
    usedAt: "周计划标题生成或编辑",
    inputContract: ["渠道", "产品", "内容类型", "主蒸馏词", "来源问题"],
    outputContract: ["title", "titleReason", "riskNote"],
    failureRules: ["标题必须体现用户问题", "标题不能堆关键词", "标题不能使用绝对化承诺"]
  },
  {
    id: "evidence_selection",
    name: "证据选择模板",
    version: "v3.0.0",
    usedAt: "今日发布批量生成前",
    inputContract: ["任务 Brief", "知识库类型", "可用 Chunk", "主蒸馏词", "官网链接目标"],
    outputContract: ["selectedChunkIds", "evidenceReason", "missingEvidence"],
    failureRules: ["选择 2 到 4 段证据", "竞品参考不能作为品牌事实", "证据不足时返回缺口"]
  },
  {
    id: "batch_body_generation",
    name: "批量正文生成模板",
    version: "v3.0.0",
    usedAt: "今日发布批量生成正文",
    inputContract: ["标题", "渠道", "产品", "主蒸馏词", "来源问题", "证据 Chunk", "官网链接目标"],
    outputContract: ["title", "summary", "content", "usedChunkIds", "primaryDistilledTerm"],
    failureRules: ["首段必须进入用户问题", "必须建立蒸馏词和 JOTO / 产品关系", "必须自然包含官网链接目标"]
  },
  {
    id: "draft_second_qa",
    name: "AI 二次质检模板",
    version: "v3.0.0",
    usedAt: "草稿预览页人工修改后",
    inputContract: ["原文", "人工修改片段", "主蒸馏词", "品牌词", "产品词", "官网链接目标"],
    outputContract: ["passed", "issues", "failedSegments", "copyAllowed"],
    failureRules: ["发现阻断项时 copyAllowed=false", "删除动作只允许删除失败片段", "保留可读失败原因"]
  }
];

export function getPromptTemplate(id: PromptTemplateId) {
  return promptTemplates.find((template) => template.id === id);
}
