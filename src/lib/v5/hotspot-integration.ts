import type {
  ContentDraftArtifact,
  DraftSection,
  FreeContentExpressionTypeVersion,
  HotspotIntegrationPlan
} from "./free-production-contracts";
import type { AihotTrendItem } from "./aihot-trend-service";

export interface HotspotModelOutput {
  decision: "integrate" | "skip";
  hotspotId?: string;
  relevanceScore: number;
  selectionReason: string;
  writingAngle: string;
  affectedSectionKeys: string[];
  riskNotes: string[];
  titleCandidates: string[];
  summary: string;
  sections: DraftSection[];
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

export function parseHotspotModelOutput(content: string): HotspotModelOutput {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回热点融入 JSON 对象。");
  const value = record(JSON.parse(clean.slice(start, end + 1)));
  const sections = Array.isArray(value.sections) ? value.sections.flatMap((item): DraftSection[] => {
    const section = record(item);
    const sectionKey = typeof section.sectionKey === "string" ? section.sectionKey.trim() : "";
    const heading = typeof section.heading === "string" ? section.heading.trim() : "";
    const markdown = typeof section.markdown === "string" ? section.markdown.trim() : "";
    return sectionKey && heading && markdown ? [{ sectionKey, heading, markdown }] : [];
  }) : [];
  return {
    decision: value.decision === "skip" ? "skip" : "integrate",
    hotspotId: typeof value.hotspotId === "string" ? value.hotspotId.trim() || undefined : undefined,
    relevanceScore: Math.max(0, Math.min(100, Number(value.relevanceScore) || 0)),
    selectionReason: typeof value.selectionReason === "string" ? value.selectionReason.trim() : "",
    writingAngle: typeof value.writingAngle === "string" ? value.writingAngle.trim() : "",
    affectedSectionKeys: strings(value.affectedSectionKeys),
    riskNotes: strings(value.riskNotes),
    titleCandidates: strings(value.titleCandidates).slice(0, 3),
    summary: typeof value.summary === "string" ? value.summary.trim() : "",
    sections
  };
}

export function validateHotspotModelOutput(input: {
  output: HotspotModelOutput;
  expression: FreeContentExpressionTypeVersion;
  candidates: AihotTrendItem[];
}) {
  const issues: string[] = [];
  if (input.output.decision === "skip") return issues;
  if (!input.output.hotspotId || !input.candidates.some((item) => item.id === input.output.hotspotId)) issues.push("模型选择的热点不在本次候选池中。");
  if (input.output.relevanceScore < 65) issues.push("热点与当前文章的相关度不足 65 分。");
  if (!input.output.selectionReason) issues.push("缺少热点选择理由。");
  if (!input.output.writingAngle) issues.push("缺少热点写作角度。");
  if (!input.output.affectedSectionKeys.length) issues.push("模型没有声明需要改写的章节。");
  if (input.output.affectedSectionKeys.some((key) => !input.expression.structureModules.includes(key))) issues.push("模型声明了当前内容类型不存在的章节。");
  if (input.output.titleCandidates.length !== 3) issues.push("热点融入必须返回 3 个标题候选。");
  if (!input.output.summary || input.output.summary.length > 80) issues.push("热点融入摘要必须为 1 到 80 个字符。");
  const sectionKeys = input.output.sections.map((section) => section.sectionKey);
  if (input.output.affectedSectionKeys.some((key) => !sectionKeys.includes(key))) issues.push("热点融入结果缺少声明要改写的章节。");
  return issues;
}

export function collectHotspotRegressionIssues(input: {
  contractIssues: string[];
  baselineBlockingIssues: string[];
  baselineRepairableIssues: string[];
  nextBlockingIssues: string[];
  nextRepairableIssues: string[];
}) {
  const baselineBlocking = new Set(input.baselineBlockingIssues);
  const baselineRepairable = new Set(input.baselineRepairableIssues);
  return [
    ...input.contractIssues,
    ...input.nextBlockingIssues.filter((issue) => !baselineBlocking.has(issue)),
    ...input.nextRepairableIssues.filter((issue) => !baselineRepairable.has(issue))
  ];
}

export function buildHotspotIntegrationPrompt(input: {
  expression: FreeContentExpressionTypeVersion;
  artifact: ContentDraftArtifact;
  productName: string;
  productKnowledge: Array<Record<string, unknown>>;
  brandBaseline: Record<string, unknown>;
  candidates: AihotTrendItem[];
  excludedHotspotIds: string[];
}) {
  return {
    systemPrompt: [
      "你是企业微信公众号的热点编辑。",
      "你必须先结合当前内容类型的完整规则和现有正文判断热点是否真正适合，再决定是否融入。",
      "不要按内容类型套固定策略，不要为了响应任务强行蹭热点。没有自然连接时 decision 必须为 skip。",
      "热点摘要由 AIHOT 辅助生成，只能用于选题理解；数字、政策和原话不得从摘要扩写。",
      "产品能力只能来自 productKnowledge，不能从热点推导或补写。",
      "只改写 affectedSectionKeys，其他章节由系统保留。输出单一 JSON 对象，不输出解释或代码围栏。"
    ].join("\n"),
    userPrompt: JSON.stringify({
      task: "选择一个最适合当前文章的最新热点，给出自然结合角度，并重写必要章节。",
      currentContentTypeAndRules: input.expression,
      currentArticle: {
        title: input.artifact.selectedTitle,
        summary: input.artifact.summary,
        sections: input.artifact.sections
      },
      productContext: {
        productName: input.productName,
        knowledge: input.productKnowledge,
        brandBaseline: input.brandBaseline
      },
      hotspotCandidates: input.candidates,
      excludedHotspotIds: input.excludedHotspotIds,
      outputContract: {
        decision: "integrate | skip",
        hotspotId: "必须来自 hotspotCandidates；skip 时可省略",
        relevanceScore: "0-100",
        selectionReason: "说明为什么与当前文章和受众自然相关",
        writingAngle: "本次具体写作角度",
        affectedSectionKeys: "只能使用 currentContentTypeAndRules.structureModules 中的 key",
        riskNotes: ["需要人工留意的事实或表达风险"],
        titleCandidates: ["标题1", "标题2", "标题3"],
        summary: "80字以内",
        sections: [{ sectionKey: "只需返回受影响章节", heading: "章节标题", markdown: "章节正文" }]
      }
    })
  };
}

export function buildHotspotRepairPrompt(input: {
  originalUserPrompt: string;
  previousOutput: HotspotModelOutput;
  issues: string[];
  lockedHotspotId?: string;
}) {
  return JSON.stringify({
    originalRequest: JSON.parse(input.originalUserPrompt) as unknown,
    repairTask: "修订 previousOutput，使其通过全部确定性检查；不要重新选题，不要扩大改写章节，仍只输出单一完整 JSON 对象。",
    lockedHotspotId: input.lockedHotspotId,
    issuesToFix: input.issues,
    previousOutput: input.previousOutput
  });
}

export function createHotspotIntegrationPlan(input: {
  output: HotspotModelOutput;
  hotspot: AihotTrendItem;
  hotspotDataUpdatedAt: string;
  hotspotDataFreshness: "live" | "cached";
}): HotspotIntegrationPlan {
  return {
    provider: "aihot",
    hotspotId: input.hotspot.id,
    title: input.hotspot.title,
    summary: input.hotspot.summary,
    category: input.hotspot.category,
    sourceName: input.hotspot.sourceName,
    originalUrl: input.hotspot.originalUrl,
    aihotUrl: input.hotspot.aihotUrl,
    publishedAt: input.hotspot.publishedAt,
    relevanceScore: input.output.relevanceScore,
    selectionReason: input.output.selectionReason,
    writingAngle: input.output.writingAngle,
    affectedSectionKeys: input.output.affectedSectionKeys,
    riskNotes: input.output.riskNotes,
    hotspotDataUpdatedAt: input.hotspotDataUpdatedAt,
    hotspotDataFreshness: input.hotspotDataFreshness,
    integratedAt: new Date().toISOString()
  };
}
