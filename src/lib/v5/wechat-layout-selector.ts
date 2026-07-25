import type {
  WechatLayoutCandidateScore,
  WechatLayoutFamily,
  WechatLayoutTemplateDefinition,
  WechatLayoutTemplateId,
  WechatPresentationInput,
  WechatTemplateRecommendation
} from "./wechat-presentation-contracts";

export const WECHAT_LAYOUT_RECOMMENDER_VERSION = "wechat-layout-recommender.v2.0.0";
export const WECHAT_LAYOUT_TEMPLATE_VERSION = "wechat-layout-templates.v1.0.0";

export const WECHAT_LAYOUT_TEMPLATES: WechatLayoutTemplateDefinition[] = [
  { templateId: "official-command", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "official", name: "官方指挥型", description: "强标题、清晰结论和正式层级。", bestFor: "产品介绍、企业决策和明确转化", active: true },
  { templateId: "official-blueprint", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "official", name: "官方蓝图型", description: "强调步骤、模块和发布节奏。", bestFor: "发布矩阵、实施路径和方案说明", active: true },
  { templateId: "official-cobalt", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "official", name: "官方钴蓝型", description: "适合多图和能力层级表达。", bestFor: "产品能力、架构和多模块内容", active: true },
  { templateId: "official-graphite", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "official", name: "官方石墨型", description: "克制正式，突出证据和对比。", bestFor: "选型、对比和管理层阅读", active: true },
  { templateId: "natural-fieldnotes", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "natural", name: "自然现场笔记型", description: "从具体经历展开，保留观察感。", bestFor: "个人体验、复盘和现场故事", active: true },
  { templateId: "natural-notebook", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "natural", name: "自然研究手记型", description: "温和分段，适合解释问题机制。", bestFor: "痛点教育、研究观察和知识梳理", active: true },
  { templateId: "natural-column", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "natural", name: "自然专栏型", description: "观点连续，章节路径明确。", bestFor: "工具指南、方法文章和个人专栏", active: true },
  { templateId: "natural-calm", version: WECHAT_LAYOUT_TEMPLATE_VERSION, family: "natural", name: "自然克制型", description: "留白充足，强调长期判断。", bestFor: "趋势判断、科普和弱推广内容", active: true }
];

const primaryTemplateByContentType: Record<string, WechatLayoutTemplateId> = {
  explicit_product_intro: "official-command",
  explicit_launch_matrix: "official-blueprint",
  implicit_personal_review: "natural-fieldnotes",
  implicit_painpoint_education: "natural-notebook",
  implicit_tool_guide: "natural-column",
  implicit_trend_judgment: "natural-calm"
};

function familyForContentType(platformContentType: string): WechatLayoutFamily | undefined {
  if (platformContentType.startsWith("explicit_")) return "official";
  if (platformContentType.startsWith("implicit_")) return "natural";
  return undefined;
}

function add(score: WechatLayoutCandidateScore, points: number, rule: string) {
  score.score += points;
  score.matchedRules.push(rule);
}

export function recommendWechatLayout(input: WechatPresentationInput): WechatTemplateRecommendation {
  const family = familyForContentType(input.platformContentType);
  const primary = primaryTemplateByContentType[input.platformContentType];
  if (!family || !primary) {
    return {
      status: "recommendation_unavailable",
      recommenderVersion: WECHAT_LAYOUT_RECOMMENDER_VERSION,
      businessReason: "当前内容类型没有稳定推荐规则，请人工查看全部模板后选择。",
      candidates: []
    };
  }

  const candidates = WECHAT_LAYOUT_TEMPLATES
    .filter((item) => item.active && item.family === family)
    .map<WechatLayoutCandidateScore>((item) => ({
      templateId: item.templateId,
      family: item.family,
      score: 20,
      matchedRules: [family === "official" ? "内容属于正式表达" : "内容属于自然表达"]
    }));

  for (const candidate of candidates) {
    if (candidate.templateId === primary) add(candidate, 14, `内容类型匹配 ${input.platformContentType}`);
    const tags = new Set(input.articleStructureTags.map((tag) => tag.toLowerCase()));
    if ((tags.has("steps") || tags.has("workflow")) && ["official-blueprint", "natural-column"].includes(candidate.templateId)) add(candidate, 3, "正文包含步骤或流程结构");
    if ((tags.has("comparison") || tags.has("evidence")) && ["official-graphite", "natural-calm"].includes(candidate.templateId)) add(candidate, 3, "正文强调对比或证据");
    if (input.approvedImageRoles.length >= 3 && ["official-cobalt", "natural-notebook"].includes(candidate.templateId)) add(candidate, 2, "多张配图需要更清晰的视觉分段");
    if (/决策|管理|企业/.test(input.targetAudience) && ["official-command", "official-graphite"].includes(candidate.templateId)) add(candidate, 2, "目标读者偏企业决策场景");
  }

  candidates.sort((a, b) => b.score - a.score || a.templateId.localeCompare(b.templateId));
  const winner = candidates[0];
  const runnerUp = candidates[1];
  if (!winner || winner.score < 30 || (runnerUp && winner.score - runnerUp.score < 3)) {
    return {
      status: "recommendation_unavailable",
      recommenderVersion: WECHAT_LAYOUT_RECOMMENDER_VERSION,
      family,
      businessReason: "候选模板差异不足，系统不预选；请人工查看全部模板后选择。",
      candidates
    };
  }

  return {
    status: "recommended",
    recommenderVersion: WECHAT_LAYOUT_RECOMMENDER_VERSION,
    recommendedTemplateId: winner.templateId,
    family,
    businessReason: `${winner.matchedRules.join("；")}。这是系统建议，仍需人工确认。`,
    candidates
  };
}

export function getActiveWechatTemplate(templateId: string) {
  return WECHAT_LAYOUT_TEMPLATES.find((item) => item.templateId === templateId && item.active);
}
