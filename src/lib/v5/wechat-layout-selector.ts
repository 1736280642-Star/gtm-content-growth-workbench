import type {
  WechatLayoutCandidateScore,
  WechatLayoutFamily,
  WechatLayoutSelection,
  WechatLayoutTemplateId,
  WechatPresentationInput
} from "./wechat-presentation-contracts";

export const WECHAT_LAYOUT_SELECTOR_VERSION = "wechat-layout-selector.v1.0.0";

const templates: Array<{ id: WechatLayoutTemplateId; family: WechatLayoutFamily; active: boolean }> = [
  { id: "official-command", family: "official", active: true },
  { id: "official-blueprint", family: "official", active: true },
  { id: "official-cobalt", family: "official", active: true },
  { id: "official-graphite", family: "official", active: true },
  { id: "natural-fieldnotes", family: "natural", active: true },
  { id: "natural-notebook", family: "natural", active: true },
  { id: "natural-column", family: "natural", active: true },
  { id: "natural-calm", family: "natural", active: true }
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

export function selectWechatLayout(input: WechatPresentationInput): WechatLayoutSelection {
  const family = familyForContentType(input.platformContentType);
  const primary = primaryTemplateByContentType[input.platformContentType];
  if (!family || !primary) {
    return {
      status: "selection_blocked",
      selectorVersion: WECHAT_LAYOUT_SELECTOR_VERSION,
      businessReason: "内容类型尚未进入已批准的公众号排版规则，系统不会猜测模板。",
      candidates: []
    };
  }

  const candidates = templates.filter((item) => item.active && item.family === family).map<WechatLayoutCandidateScore>((item) => ({
    templateId: item.id,
    family: item.family,
    score: 20,
    matchedRules: [family === "official" ? "强推广内容锁定官方模板家族" : "弱推广内容锁定自然模板家族"]
  }));

  for (const candidate of candidates) {
    if (candidate.templateId === primary) add(candidate, 14, `内容类型匹配 ${input.platformContentType}`);
    const tags = new Set(input.articleStructureTags.map((tag) => tag.toLowerCase()));
    if (tags.has("steps") || tags.has("workflow")) {
      if (candidate.templateId === "official-blueprint" || candidate.templateId === "natural-column") add(candidate, 3, "正文包含步骤或流程结构");
    }
    if (tags.has("comparison") || tags.has("evidence")) {
      if (candidate.templateId === "official-graphite" || candidate.templateId === "natural-calm") add(candidate, 3, "正文强调对比或证据");
    }
    if (input.approvedImageRoles.length >= 3) {
      if (candidate.templateId === "official-cobalt" || candidate.templateId === "natural-notebook") add(candidate, 2, "多张已批准配图需要更清晰的视觉分段");
    }
    if (/决策|管理|企业/.test(input.targetAudience)) {
      if (candidate.templateId === "official-command" || candidate.templateId === "official-graphite") add(candidate, 2, "目标读者偏企业决策场景");
    }
    if (/强|产品|咨询|试用/.test(input.ctaType)) {
      if (candidate.family === "official") add(candidate, 1, "CTA 强度与官方模板一致");
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.templateId.localeCompare(b.templateId));
  const winner = candidates[0];
  const runnerUp = candidates[1];
  if (!winner || winner.score < 30 || (runnerUp && winner.score - runnerUp.score < 3)) {
    return {
      status: "selection_blocked",
      selectorVersion: WECHAT_LAYOUT_SELECTOR_VERSION,
      family,
      selectedScore: winner?.score,
      runnerUpScore: runnerUp?.score,
      businessReason: "候选模板分差不足，需先修正规则或内容元数据后重新运行。",
      candidates
    };
  }

  return {
    status: "selected",
    selectorVersion: WECHAT_LAYOUT_SELECTOR_VERSION,
    selectedTemplateId: winner.templateId,
    family,
    selectedScore: winner.score,
    runnerUpScore: runnerUp?.score,
    businessReason: `${winner.matchedRules.join("；")}，系统已确定唯一最优模板。`,
    candidates
  };
}
