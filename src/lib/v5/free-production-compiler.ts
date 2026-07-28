import { createHash, randomUUID } from "node:crypto";
import type {
  ContentLayoutNode,
  DraftSection,
  FreeContentExpressionTypeVersion,
  FreeProductionBatch,
  FreeProductionInputSnapshot,
  RiskAndGapItem
} from "./free-production-contracts";
import { FREE_PRODUCTION_CHANNELS } from "./free-production-contracts";

export function getCalendarMonthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("月份格式必须为 YYYY-MM。");
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { monthStart: `${month}-01`, monthEnd: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function assertFreeProductionChannel(value: string) {
  if (!FREE_PRODUCTION_CHANNELS.includes(value as (typeof FREE_PRODUCTION_CHANNELS)[number])) throw new Error("渠道只允许官网、知乎和公众号。");
}

export function createInitialRisks(expression: FreeContentExpressionTypeVersion): RiskAndGapItem[] {
  return expression.requiredInputSchema.map((item) => ({
    id: `risk-${randomUUID()}`,
    key: item.key,
    title: item.label,
    reason: item.reason,
    status: item.defaultStatus,
    inputSchema: item.inputSchema,
    affectedSectionKeys: item.affectedSectionKeys
  }));
}

export function summarizeRisks(risks: RiskAndGapItem[]) {
  return {
    ready: risks.filter((item) => item.status === "ready").length,
    needsInput: risks.filter((item) => item.status === "needs_input").length,
    needsApproval: risks.filter((item) => item.status === "needs_approval").length,
    warning: risks.filter((item) => item.status === "warning").length,
    blocked: risks.filter((item) => item.status === "blocked").length
  };
}

export function compileGenerationInput(input: {
  batch: FreeProductionBatch;
  expression: FreeContentExpressionTypeVersion;
  expressionPlanId: string;
  productRuleSnapshot: Record<string, unknown>;
  knowledgeSnapshots: Array<Record<string, unknown>>;
  brandBaseline: Record<string, unknown>;
  supplementalFacts?: Record<string, string>;
}): FreeProductionInputSnapshot {
  const createdAt = new Date().toISOString();
  const partial = {
    id: `free-input-${randomUUID()}`,
    productExpressionRuleSnapshot: input.productRuleSnapshot,
    knowledgeSnapshots: input.knowledgeSnapshots,
    brandExpressionBaselineSnapshot: input.brandBaseline,
    freeContentExpressionPresetSnapshot: input.expression,
    sourceRuleVersion: input.expression.sourceRuleVersion,
    sourceRuleDigest: input.expression.sourceRuleDigest,
    audienceLens: input.expression.audienceLensPolicy,
    titleStrategy: input.expression.defaultTitleStrategyKey,
    channelRuleSnapshot: input.expression.channelBinding,
    supplementalFacts: input.supplementalFacts || {},
    expressionPlanId: input.expressionPlanId,
    createdAt
  };
  return { ...partial, snapshotHash: createHash("sha256").update(JSON.stringify(partial)).digest("hex") };
}

export function buildWechatLayout(input: { selectedTitle: string; summary: string; sections: Array<{ sectionKey: string; heading: string; markdown: string }> }): ContentLayoutNode[] {
  const nodes: ContentLayoutNode[] = [
    { id: "brand-bar", type: "brand_bar", text: "JOTO AI" },
    { id: "title", type: "title", text: input.selectedTitle },
    { id: "summary", type: "summary", text: input.summary }
  ];
  input.sections.forEach((section, index) => {
    nodes.push({ id: `heading-${index}`, type: "section_heading", text: section.heading, sectionKey: section.sectionKey });
    section.markdown.split(/\n{2,}/).map((text) => text.replace(/^#+\s*/, "").trim()).filter(Boolean).forEach((text, paragraphIndex) => nodes.push({ id: `paragraph-${index}-${paragraphIndex}`, type: "paragraph", text, sectionKey: section.sectionKey }));
  });
  nodes.push({ id: "brand-footer", type: "brand_footer", text: "让 AI 承担重复工作，让人保留专业判断与最终决策。" });
  return nodes;
}

export function sanitizePublishMarkdown(markdown: string) {
  return markdown
    .replace(/<!--\s*(?:visual-suggestion|internal-check|missing-input)[\s\S]*?-->/gi, "")
    .replace(/^>\s*(?:配图建议|素材建议|内部核验|待补充)[:：].*$/gm, "")
    .replace(/\[\[(?:VISUAL|MISSING|INTERNAL):[^\]]+\]\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function contentDigest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function mergeRegeneratedSections(current: DraftSection[], generated: DraftSection[], affectedSectionKeys: string[]) {
  const affected = new Set(affectedSectionKeys);
  const replacements = new Map(generated.map((section) => [section.sectionKey, section]));
  return current.map((section) => affected.has(section.sectionKey) ? replacements.get(section.sectionKey) || section : section);
}
