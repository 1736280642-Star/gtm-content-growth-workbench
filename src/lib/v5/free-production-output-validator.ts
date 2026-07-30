import type {
  ContentDraftArtifact,
  DraftSection,
  FreeContentExpressionTypeVersion,
  FreeProductionSourceExcerpt
} from "./free-production-contracts";
import { sanitizePublishMarkdown } from "./free-production-compiler";

const forbiddenClaims = ["行业第一", "革命性", "颠覆性", "完全替代人", "100%", "绝对安全"];

export interface FreeProductionValidationResult {
  passed: boolean;
  repairableIssues: string[];
  blockingIssues: string[];
  advisoryIssues: string[];
}

function normalizedClaim(value: string) {
  return value.replace(/\s+/g, "").replace(/[“”"'`]/g, "");
}

export function validateFreeProductionCitations(sections: DraftSection[], sources: FreeProductionSourceExcerpt[]) {
  const issues: string[] = [];
  const safeSources = Array.isArray(sources) ? sources : [];
  const safeSections = Array.isArray(sections) ? sections : [];
  const sourceIds = new Set(safeSources.map((source) => source.id));
  if (!safeSources.length) issues.push("正文没有可追溯的来源片段。");
  if (!safeSections.length) issues.push("正文没有可核对的章节。");
  for (const section of safeSections) {
    if (!Array.isArray(section.citations) || !section.citations.length) {
      issues.push(`章节 ${section.sectionKey} 没有事实声明与来源映射。`);
      continue;
    }
    const sectionText = normalizedClaim(`${section.heading}${section.markdown}`);
    const citedClaims = new Set<string>();
    for (const citation of section.citations) {
      const claimText = normalizedClaim(citation.claimText || "");
      if (!claimText || !sectionText.includes(claimText)) issues.push(`章节 ${section.sectionKey} 的引用声明不在正文中。`);
      if (claimText) citedClaims.add(claimText);
      if (!citation.sourceIds?.length) issues.push(`章节 ${section.sectionKey} 的引用声明没有来源 ID。`);
      const unknownIds = (citation.sourceIds || []).filter((sourceId) => !sourceIds.has(sourceId));
      if (unknownIds.length) issues.push(`章节 ${section.sectionKey} 引用了不存在的来源 ID：${unknownIds.join("、")}。`);
    }
    const sentences = section.markdown
      .split(/[。！？!?；;\n]+/)
      .map((sentence) => normalizedClaim(sentence.replace(/^[-*#>\d.)、\s]+/, "")))
      .filter((sentence) => sentence.length >= 4);
    const uncovered = sentences.filter((sentence) => !citedClaims.has(sentence));
    if (uncovered.length) issues.push(`章节 ${section.sectionKey} 有 ${uncovered.length} 个句子没有逐句来源映射。`);
  }
  return { passed: issues.length === 0, issues };
}

export function validateFreeProductionOutput(input: { expression: FreeContentExpressionTypeVersion; productName: string; titleCandidates: string[]; summary: string; sections: DraftSection[]; sources?: FreeProductionSourceExcerpt[] }) : FreeProductionValidationResult {
  const repairableIssues: string[] = [];
  const blockingIssues: string[] = [];
  const advisoryIssues: string[] = [];
  if (input.titleCandidates.length !== 3 || input.titleCandidates.some((title) => !title.trim())) repairableIssues.push("必须输出 3 个非空标题候选。");
  if (!input.summary.trim() || input.summary.length > 80) repairableIssues.push("摘要必须为 1 到 80 个字符。");
  const keys = input.sections.map((section) => section.sectionKey);
  if (JSON.stringify(keys) !== JSON.stringify(input.expression.structureModules)) repairableIssues.push("必选结构模块缺失或顺序不正确。");
  if (input.sections.some((section) => !section.heading.trim() || !section.markdown.trim())) repairableIssues.push("章节标题或正文为空。");
  const article = input.sections.map((section) => `${section.heading}\n${section.markdown}`).join("\n\n");
  const forbidden = forbiddenClaims.filter((claim) => article.includes(claim) || input.titleCandidates.some((title) => title.includes(claim)));
  if (forbidden.length) blockingIssues.push(`命中无证据高风险结论：${forbidden.join("、")}`);
  if (input.sources) blockingIssues.push(...validateFreeProductionCitations(input.sections, input.sources).issues);
  if (input.expression.qualityGateConfig.requireHumanAiBoundary && !input.expression.structureModules.includes("human_ai_boundary") && !/人工|最终决策|专业判断/.test(article)) repairableIssues.push("正文缺少人机边界说明。");
  const minimumRatio = input.expression.qualityGateConfig.productMentionMinimumRatio;
  if (minimumRatio) {
    const firstProductIndex = article.indexOf(input.productName);
    if (firstProductIndex >= 0 && firstProductIndex / Math.max(article.length, 1) < minimumRatio) repairableIssues.push("行业洞察中的产品出现早于正文前 20%。");
  }
  const longParagraphs = article.split(/\n{2,}/).filter((paragraph) => paragraph.length > 350).length;
  if (longParagraphs) advisoryIssues.push(`${longParagraphs} 个段落偏长，建议发布前确认阅读节奏。`);
  return { passed: repairableIssues.length === 0 && blockingIssues.length === 0, repairableIssues, blockingIssues, advisoryIssues };
}

export function assertPublishPayloadSanitized(artifact: ContentDraftArtifact) {
  const sanitized = sanitizePublishMarkdown(artifact.articleBody);
  const blocked = ["配图建议", "素材建议", "内部核验", "待补充", "[[VISUAL:", "[[MISSING:", "[[INTERNAL:"].filter((value) => sanitized.includes(value));
  const citationValidation = validateFreeProductionCitations(artifact.sections, artifact.sourceExcerpts);
  return { passed: blocked.length === 0 && citationValidation.passed, blocked: [...blocked, ...citationValidation.issues], markdown: sanitized };
}
