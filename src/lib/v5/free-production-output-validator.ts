import type { ContentDraftArtifact, DraftSection, FreeContentExpressionTypeVersion } from "./free-production-contracts";
import { sanitizePublishMarkdown } from "./free-production-compiler";
import { findHumanWritingWechatIssues, isWechatContentChannel } from "./human-writing-wechat";

const forbiddenClaims = ["行业第一", "革命性", "颠覆性", "完全替代人", "100%", "绝对安全"];

export interface FreeProductionValidationResult {
  passed: boolean;
  repairableIssues: string[];
  blockingIssues: string[];
  advisoryIssues: string[];
}

export function validateFreeProductionOutput(input: { expression: FreeContentExpressionTypeVersion; productName: string; titleCandidates: string[]; summary: string; sections: DraftSection[] }) : FreeProductionValidationResult {
  const repairableIssues: string[] = [];
  const blockingIssues: string[] = [];
  const advisoryIssues: string[] = [];
  if (input.titleCandidates.length !== 3 || input.titleCandidates.some((title) => !title.trim())) repairableIssues.push("必须输出 3 个非空标题候选。");
  if (!input.summary.trim() || input.summary.length > 80) repairableIssues.push("摘要必须为 1 到 80 个字符。");
  const keys = input.sections.map((section) => section.sectionKey);
  if (JSON.stringify(keys) !== JSON.stringify(input.expression.structureModules)) repairableIssues.push("必选结构模块缺失或顺序不正确。");
  if (input.sections.some((section) => !section.heading.trim() || !section.markdown.trim())) repairableIssues.push("章节标题或正文为空。");
  if (input.sections.some((section) => !section.citations?.length || section.citations.some((citation) => !citation.claimText.trim() || !citation.sourceIds.length))) repairableIssues.push("每个章节都必须建立正文主张与真实来源 ID 的引用映射。");
  const article = input.sections.map((section) => `${section.heading}\n${section.markdown}`).join("\n\n");
  const forbidden = forbiddenClaims.filter((claim) => article.includes(claim) || input.titleCandidates.some((title) => title.includes(claim)));
  if (forbidden.length) blockingIssues.push(`命中无证据高风险结论：${forbidden.join("、")}`);
  if (input.expression.qualityGateConfig.requireHumanAiBoundary && !input.expression.structureModules.includes("human_ai_boundary") && !/人工|最终决策|专业判断/.test(article)) repairableIssues.push("正文缺少人机边界说明。");
  const minimumRatio = input.expression.qualityGateConfig.productMentionMinimumRatio;
  if (minimumRatio) {
    const firstProductIndex = article.indexOf(input.productName);
    if (firstProductIndex >= 0 && firstProductIndex / Math.max(article.length, 1) < minimumRatio) repairableIssues.push("行业洞察中的产品出现早于正文前 20%。");
  }
  const longParagraphs = article.split(/\n{2,}/).filter((paragraph) => paragraph.length > 350).length;
  if (longParagraphs) advisoryIssues.push(`${longParagraphs} 个段落偏长，建议发布前确认阅读节奏。`);
  if (isWechatContentChannel(input.expression.channelBinding.channel)) {
    repairableIssues.push(...findHumanWritingWechatIssues([input.titleCandidates[0] || "", input.summary, article].join("\n")));
  }
  return { passed: repairableIssues.length === 0 && blockingIssues.length === 0, repairableIssues, blockingIssues, advisoryIssues };
}

export function assertPublishPayloadSanitized(artifact: ContentDraftArtifact) {
  const sanitized = sanitizePublishMarkdown(artifact.articleBody);
  const blocked = ["配图建议", "素材建议", "内部核验", "待补充", "[[VISUAL:", "[[MISSING:", "[[INTERNAL:"].filter((value) => sanitized.includes(value));
  return { passed: blocked.length === 0, blocked, markdown: sanitized };
}
