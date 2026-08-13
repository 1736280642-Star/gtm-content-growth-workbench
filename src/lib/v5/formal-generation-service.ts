import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import type { RagEvidenceItem, RagFinalEvidencePack } from "./rag/contracts";
import type { ProductionContractSnapshot } from "./content-production-contracts";
import type { FactTrace, HardRuleResult, SingleArticleActor, SingleArticleFailure } from "./single-article-contracts";
import { findHumanWritingWechatIssues, isWechatContentChannel } from "./human-writing-wechat";
import {
  beginFormalGenerationRun,
  completeFormalGeneration,
  failFormalGenerationRun,
  type FormalGenerationContext
} from "./single-article-production-repository";

export class FormalGenerationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly nextAction: string,
    public readonly details?: string[],
    public readonly recorded = false
  ) {
    super(message);
    this.name = "FormalGenerationError";
  }
}

interface FormalProviderOutput {
  markdown: string;
  factTraces: FactTrace[];
}

const explicitRuleFields = ["text", "description", "action", "pattern", "value", "label"] as const;

export function extractRuleTexts(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => extractRuleTexts(item));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = explicitRuleFields.flatMap((field) => extractRuleTexts(record[field]));
  const nested = ["rules", "items", "requirements", "boundaries", "conditions", "limitations"]
    .flatMap((field) => extractRuleTexts(record[field]));
  return Array.from(new Set([...direct, ...nested]));
}

function resolveProvider(override?: string): AiProviderKey {
  const configured = String(override || process.env.V5_FORMAL_ARTICLE_PROVIDER || "qwen").trim().toLowerCase();
  if (configured === "qwen" || configured === "deepseek" || configured === "doubao" || configured === "zhipu") return configured;
  throw new FormalGenerationError(503, "formal_provider_invalid", "正式正文 Provider 配置不受支持。", "将 V5_FORMAL_ARTICLE_PROVIDER 配置为 qwen、deepseek 或 doubao。");
}

function providerJson(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Provider 未返回 JSON 对象。");
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

export function parseFormalProviderOutput(content: string): FormalProviderOutput {
  const parsed = providerJson(content);
  const markdown = typeof parsed.markdown === "string" ? parsed.markdown.trim() : "";
  const factTraces = Array.isArray(parsed.factTraces)
    ? parsed.factTraces.flatMap((item): FactTrace[] => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        const sentence = typeof value.sentence === "string" ? value.sentence.trim() : "";
        const evidenceItemId = typeof value.evidenceItemId === "string" ? value.evidenceItemId.trim() : "";
        const claimId = typeof value.claimId === "string" ? value.claimId.trim() : "";
        const sourceRevisionId = typeof value.sourceRevisionId === "string" ? value.sourceRevisionId.trim() : "";
        return sentence && evidenceItemId && claimId && sourceRevisionId
          ? [{ sentence, evidenceItemId, claimId, sourceRevisionId }]
          : [];
      })
    : [];
  return { markdown, factTraces };
}

function traceMatchesEvidence(trace: FactTrace, item: RagEvidenceItem) {
  return trace.sourceRevisionId === item.sourceRevisionId
    && Boolean(item.originalQuote.trim())
    && (trace.claimId === item.primaryClaimId || item.claimIds.includes(trace.claimId));
}

function normalizeAssertion(value: string) {
  return value.replace(/[`*_>#|\[\]（）()“”‘’'"：:，,。.!！?？；;、\s-]+/g, "").toLocaleLowerCase();
}

function sentenceMatchesEvidence(sentence: string, item: RagEvidenceItem) {
  const candidate = normalizeAssertion(sentence);
  const claim = normalizeAssertion(item.normalizedClaim || item.summary);
  const quote = normalizeAssertion(item.originalQuote);
  return candidate.length >= 4 && (candidate === claim || quote.includes(candidate) || candidate.includes(claim));
}

function splitProseSentences(value: string) {
  return value.match(/[^。！？!?；;]+[。！？!?；;]+|[^。！？!?；;]+$/g)?.map((item) => item.trim()).filter(Boolean) || [];
}

function proseSentences(markdown: string) {
  return markdown.split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, ""))
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(">"))
    .flatMap(splitProseSentences);
}

function factualLines(markdown: string) {
  return proseSentences(markdown).filter(isFactSentence);
}

function isProductClaimLine(line: string) {
  const normalized = line.trim();
  if (!normalized) return false;
  return /WorkBuddy|JOTO|腾讯|ADP|CSP|认证|官方|产品|平台|系统|服务商|支持|提供|具备|集成|部署|接入|实现|能够|可用于|适用于|覆盖|兼容|上线|发布/i.test(normalized);
}

export function removeUnsupportedFormalPassages(output: FormalProviderOutput, evidenceItems: RagEvidenceItem[], fixedTexts: string[] = []) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  const acceptedTraces = output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item && traceMatchesEvidence(trace, item) && sentenceMatchesEvidence(trace.sentence, item));
  });
  const acceptedSentences = new Set(acceptedTraces.map((trace) => trace.sentence));
  const rejectedSentences = new Set(output.factTraces.filter((trace) => !acceptedSentences.has(trace.sentence)).map((trace) => trace.sentence));
  const lines = output.markdown.split(/\r?\n/);
  let removedSentenceCount = 0;
  const keptLines = lines.map((line) => {
    const normalized = line.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, "");
    if (!normalized || normalized.startsWith("#") || normalized.startsWith(">")) return line;
    const keptSentences = splitProseSentences(normalized).filter((sentence) => {
      if ([...rejectedSentences].some((rejected) => sentence.includes(rejected))) {
        removedSentenceCount += 1;
        return false;
      }
      if (!isFactSentence(sentence) || fixedTexts.some((text) => sentence.includes(text))) return true;
      if ([...acceptedSentences].some((accepted) => sentence === accepted)) return true;
      if (isProductClaimLine(sentence)) {
        removedSentenceCount += 1;
        return false;
      }
      return true;
    });
    return keptSentences.join("");
  }).filter((line) => line.trim());
  return {
    output: { markdown: keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), factTraces: acceptedTraces },
    removedCount: removedSentenceCount + output.factTraces.length - acceptedTraces.length
  };
}

export function placeFixedExpressions(markdown: string, rules: ProductionContractSnapshot["fixedExpressions"] = []) {
  let result = markdown.trim();
  for (const rule of rules) {
    if (rule.text === "JOTO 作为腾讯CSP授权合作伙伴") {
      result = placeJotoOfficialPositioning(result, rule.positions);
      continue;
    }
    result = result.split(rule.text).join("").replace(/\n{3,}/g, "\n\n").trim();
    for (const position of rule.positions) {
      if (position === "opening") {
        const titleEnd = result.indexOf("\n");
        result = titleEnd >= 0
          ? `${result.slice(0, titleEnd)}\n\n${rule.text}\n${result.slice(titleEnd + 1).trimStart()}`
          : `${result}\n\n${rule.text}`;
      } else if (position === "ending") {
        result = `${result.trimEnd()}\n\n${rule.text}`;
      } else {
        const lastHeading = result.lastIndexOf("\n## ");
        result = lastHeading >= 0
          ? `${result.slice(0, lastHeading).trimEnd()}\n\n${rule.text}\n${result.slice(lastHeading)}`
          : `${result.trimEnd()}\n\n${rule.text}`;
      }
    }
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function mergeJotoPositioningIntoParagraph(paragraph: string, fixedText: string) {
  const servicePattern = /(?:我们\s*)?JOTO\s*团队(?:可|可以)?在([^。！？\n]*?)提供/g;
  const forPattern = /JOTO\s*团队为([^。！？\n]*?)提供/g;
  if (servicePattern.test(paragraph)) {
    servicePattern.lastIndex = 0;
    return paragraph.replace(servicePattern, `${fixedText}，可在$1提供`);
  }
  if (forPattern.test(paragraph)) {
    forPattern.lastIndex = 0;
    return paragraph.replace(forPattern, `${fixedText}，可为$1提供`);
  }
  return "";
}

function placeJotoOfficialPositioning(markdown: string, positions: Array<"opening" | "body" | "ending">) {
  const fixedText = "JOTO 作为腾讯CSP授权合作伙伴";
  const cleaned = markdown
    .replaceAll(`${fixedText}。`, "")
    .replaceAll(`${fixedText}，`, "")
    .replaceAll(fixedText, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const blocks = cleaned.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const proseIndexes = blocks.map((block, index) => ({ block, index }))
    .filter(({ block }) => (!block.startsWith("#") || /JOTO\s*团队/.test(block)) && !/^\[[^\]]+]\(https?:\/\//i.test(block));
  const firstH2 = blocks.findIndex((block) => /^##\s+/.test(block));
  const openingCandidates = proseIndexes.filter(({ index }) => firstH2 < 0 || index < firstH2);
  const endingCandidates = [...proseIndexes].reverse();

  const integrate = (candidates: typeof proseIndexes) => {
    for (const { block, index } of candidates) {
      const merged = mergeJotoPositioningIntoParagraph(block, fixedText);
      if (!merged) continue;
      blocks[index] = merged;
      return true;
    }
    return false;
  };

  for (const position of positions) {
    const candidates = position === "opening" ? openingCandidates : position === "ending" ? endingCandidates : proseIndexes;
    if (integrate(candidates)) continue;
    const fallback = `${fixedText}，可在约定项目范围内提供项目实施、交付培训与后续支持。`;
    if (position === "opening") {
      const titleIndex = blocks.findIndex((block) => /^#\s+/.test(block));
      blocks.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, fallback);
    } else if (position === "ending") {
      const linkIndex = blocks.findIndex((block) => /^\[[^\]]+]\(https?:\/\//i.test(block));
      blocks.splice(linkIndex >= 0 ? linkIndex : blocks.length, 0, fallback);
    } else {
      const lastHeading = blocks.map((block, index) => /^##\s+/.test(block) ? index : -1).filter((index) => index >= 0).at(-1);
      blocks.splice(lastHeading ?? blocks.length, 0, fallback);
    }
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function createFormalModelContract(contract: ProductionContractSnapshot) {
  const minimum = contract.validatorPolicy.minTraceableFactCount;
  const limit = Math.min(16, Math.max(minimum + 4, minimum));
  const boundary = contract.evidencePack.evidenceItems.filter((item) =>
    item.allowedUsage.includes("human_boundary") || item.conditions.length > 0 || item.limitations.length > 0
  );
  const selected: typeof contract.evidencePack.evidenceItems = [];
  const seen = new Set<string>();
  for (const item of [...boundary, ...contract.evidencePack.evidenceItems]) {
    if (seen.has(item.evidenceItemId)) continue;
    seen.add(item.evidenceItemId);
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return {
    ...contract,
    evidencePack: {
      ...contract.evidencePack,
      evidenceItems: selected.map((item) => ({
        evidenceItemId: item.evidenceItemId,
        claimIds: item.claimIds,
        primaryClaimId: item.primaryClaimId,
        sourceRevisionId: item.sourceRevisionId,
        summary: item.summary,
        canonicalUrl: item.canonicalUrl,
        allowedUsage: item.allowedUsage,
        conditions: item.conditions,
        limitations: item.limitations,
        lifecycleStatus: item.lifecycleStatus,
        status: item.status
      })),
      gaps: contract.evidencePack.gaps.slice(0, 10),
      conflicts: contract.evidencePack.conflicts.slice(0, 10),
      outdatedEvidence: contract.evidencePack.outdatedEvidence.slice(0, 10),
      unverifiedClaims: contract.evidencePack.unverifiedClaims.slice(0, 10)
    },
    productRule: {
      ...contract.productRule,
      allowedExpressions: contract.productRule.allowedExpressions.slice(0, 20),
      conditionalExpressions: contract.productRule.conditionalExpressions.slice(0, 20),
      blockedExpressions: contract.productRule.blockedExpressions.slice(0, 30)
    },
    allowedExpressions: contract.allowedExpressions.slice(0, 20),
    conditionalExpressions: contract.conditionalExpressions.slice(0, 20),
    promptDirectives: contract.promptDirectives.slice(0, 30)
  };
}

function ensureTerminalPunctuation(value: string) {
  const trimmed = value.trim();
  return /[。！？；，.!?;:]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function requiredTracePlan(contract: ReturnType<typeof createFormalModelContract>) {
  const items = contract.evidencePack.evidenceItems.filter((item) => item.primaryClaimId);
  const boundaryItems = items.filter((item) => item.conditions.length || item.limitations.length || item.allowedUsage.includes("human_boundary"));
  const selected = [...boundaryItems, ...items.filter((item) => !boundaryItems.includes(item))];
  return selected
    .slice(0, contract.validatorPolicy.minTraceableFactCount)
    .map((item) => ({
      sentence: ensureTerminalPunctuation([
        item.summary.replace(/[。！？；，.!?;:]$/, ""),
        ...item.conditions,
        ...item.limitations
      ].filter(Boolean).join("。")),
      evidenceItemId: item.evidenceItemId,
      claimId: item.primaryClaimId,
      sourceRevisionId: item.sourceRevisionId,
      conditions: item.conditions,
      limitations: item.limitations
    }));
}

export function ensureMinimumTraceableEvidence(
  output: FormalProviderOutput,
  evidenceItems: RagEvidenceItem[],
  minimum: number,
  fixedTexts: string[] = []
) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  const valid = output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item && traceMatchesEvidence(trace, item) && sentenceMatchesEvidence(trace.sentence, item) && output.markdown.includes(trace.sentence));
  });
  const sentences = new Set(valid.map((trace) => trace.sentence));
  const additions: Array<{ sentence: string; item: RagEvidenceItem }> = [];
  for (const item of evidenceItems) {
    if (sentences.size + additions.length >= minimum) break;
    if (!item.primaryClaimId) continue;
    let sentence = ensureTerminalPunctuation(item.summary || item.normalizedClaim);
    if (!sentence || sentence.length < 12 || sentences.has(sentence) || additions.some((entry) => entry.sentence === sentence)) continue;
    if (output.markdown.includes(sentence)) {
      const boundary = [...item.conditions, ...item.limitations].map((value) => value.trim()).find(Boolean);
      sentence = ensureTerminalPunctuation(`${sentence.replace(/[。！？；，.!?;:]$/, "")}${boundary ? `；适用条件是${boundary}` : "；这条信息用于当前选型判断"}`);
    }
    additions.push({ sentence, item });
  }
  if (!additions.length) return output;

  const boundaryNotes = additions.flatMap(({ item }) => [...item.conditions, ...item.limitations])
    .map((value) => value.trim())
    .filter(Boolean);
  const section = [
    "## 判断时要看清的事实",
    ...additions.map(({ sentence }) => `- ${sentence}`),
    ...boundaryNotes.map((note) => `> 适用条件：${note}`)
  ].join("\n");
  const endingText = fixedTexts.find((text) => output.markdown.trimEnd().endsWith(text));
  const markdown = endingText
    ? `${output.markdown.trimEnd().slice(0, -endingText.length).trimEnd()}\n\n${section}\n\n${endingText}`
    : `${output.markdown.trimEnd()}\n\n${section}`;
  return {
    markdown,
    factTraces: [
      ...valid,
      ...additions.map(({ sentence, item }) => ({
        sentence,
        evidenceItemId: item.evidenceItemId,
        claimId: item.primaryClaimId!,
        sourceRevisionId: item.sourceRevisionId
      }))
    ]
  };
}

function isFactSentence(sentence: string) {
  const normalized = sentence.trim();
  return normalized.length >= 12 && /[。！？；：.!?;:]$/.test(normalized);
}

export function validateFormalProviderOutput(input: {
  output: FormalProviderOutput;
  title: string;
  channel?: string;
  evidenceItems: RagEvidenceItem[];
  blockedRuleTexts: string[];
  requiredFormatTexts: string[];
  checkedRuleCount: number;
  minTraceableFactCount: number;
  fixedExpressions?: ProductionContractSnapshot["fixedExpressions"];
}): HardRuleResult {
  const blockers: string[] = [];
  const markdown = input.output.markdown;
  if (!markdown) blockers.push("正文为空。");
  if (!markdown.startsWith(`# ${input.title}`)) blockers.push("正文必须以冻结标题作为一级标题。");
  if (input.requiredFormatTexts.some((text) => text.includes("分节")) && (markdown.match(/^##\s+\S+/gm) || []).length < 2) {
    blockers.push("正文分节不足，至少需要两个 Markdown 二级标题。");
  }
  const emptySections = markdown.split(/^##\s+\S+.*$/gm).slice(1).filter((section) => !section.trim());
  if (emptySections.length) blockers.push(`正文包含 ${emptySections.length} 个空章节。`);
  const visibleLength = markdown.replace(/^#+\s+/gm, "").replace(/\s+/g, "").length;
  if (visibleLength < 1200) blockers.push(`正文有效长度不足 1200 字，当前约 ${visibleLength} 字。`);
  const evidenceById = new Map(input.evidenceItems.map((item) => [item.evidenceItemId, item]));
  const validTraces = input.output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item
      && isFactSentence(trace.sentence)
      && markdown.includes(trace.sentence)
      && traceMatchesEvidence(trace, item)
      && sentenceMatchesEvidence(trace.sentence, item));
  });
  const uniqueFacts = new Set(validTraces.map((trace) => trace.sentence));
  if (validTraces.length !== input.output.factTraces.length) blockers.push("factTraces 包含无法匹配正文或 EvidenceItem 的记录。");
  if (uniqueFacts.size < input.minTraceableFactCount) blockers.push(`可追溯事实句不足 ${input.minTraceableFactCount} 条，当前为 ${uniqueFacts.size} 条。`);
  const fixedTexts = (input.fixedExpressions || []).map((item) => item.text);
  const untracedFacts = factualLines(markdown).filter(isProductClaimLine).filter((sentence) => !fixedTexts.some((text) => sentence.includes(text))
    && ![...uniqueFacts].some((fact) => sentence === fact));
  if (untracedFacts.length) blockers.push(`正文包含 ${untracedFacts.length} 条没有 Claim 追溯的事实句。`);
  const sentenceCounts = new Map<string, number>();
  for (const sentence of proseSentences(markdown)) {
    if (fixedTexts.some((text) => sentence.includes(text))) continue;
    const normalized = normalizeAssertion(sentence);
    if (normalized.length < 16) continue;
    sentenceCounts.set(normalized, (sentenceCounts.get(normalized) || 0) + 1);
  }
  const duplicatedSentenceCount = [...sentenceCounts.values()].filter((count) => count > 1).length;
  if (duplicatedSentenceCount) blockers.push(`正文包含 ${duplicatedSentenceCount} 组重复句。`);
  const siteFragmentPattern = /\b(?:Trusted by|Contact Us|Learn More|Read More|Get Started|Book a Demo|Sign Up)\b/i;
  const siteFragments = proseSentences(markdown).filter((sentence) => siteFragmentPattern.test(sentence));
  if (siteFragments.length) blockers.push(`正文混入 ${siteFragments.length} 条网页导航或站点残片。`);
  const boundaryEvidenceIds = new Set(input.evidenceItems
    .filter((item) => item.allowedUsage.includes("human_boundary") || item.conditions.length || item.limitations.length)
    .map((item) => item.evidenceItemId));
  if (!boundaryEvidenceIds.size) {
    blockers.push("Final EvidencePack 缺少限制或人工边界证据。");
  } else if (!validTraces.some((trace) => boundaryEvidenceIds.has(trace.evidenceItemId))) {
    blockers.push("正文缺少可追溯到限制或人工边界证据的事实句。");
  }
  for (const trace of validTraces) {
    const item = evidenceById.get(trace.evidenceItemId)!;
    const missingBoundaries = [...item.conditions, ...item.limitations].filter((boundary) => !markdown.includes(boundary));
    if (missingBoundaries.length) blockers.push(`条件事实 ${trace.claimId} 缺少适用条件或限制：${missingBoundaries.join("；")}`);
  }
  for (const text of input.blockedRuleTexts) {
    if (text.length >= 4 && markdown.toLocaleLowerCase().includes(text.toLocaleLowerCase())) {
      blockers.push(`正文命中禁止表达：${text}`);
    }
  }
  for (const rule of input.fixedExpressions || []) {
    const occurrences = markdown.split(rule.text).length - 1;
    if (occurrences !== rule.positions.length) {
      blockers.push(`固定文案必须逐字出现 ${rule.positions.length} 次，当前为 ${occurrences} 次。`);
      continue;
    }
    const firstHeading = markdown.indexOf("\n## ");
    const lastHeading = markdown.lastIndexOf("\n## ");
    const openingEnd = firstHeading >= 0 ? firstHeading : Math.floor(markdown.length * 0.25);
    const endingStart = lastHeading > firstHeading ? lastHeading : Math.floor(markdown.length * 0.7);
    const zones = {
      opening: markdown.slice(markdown.indexOf("\n") + 1, openingEnd),
      body: markdown.slice(openingEnd, endingStart),
      ending: markdown.slice(endingStart)
    };
    for (const position of rule.positions) {
      if (!zones[position].includes(rule.text)) blockers.push(`固定文案未逐字出现在指定位置：${position}。`);
    }
  }
  if (isWechatContentChannel(input.channel || "")) blockers.push(...findHumanWritingWechatIssues(markdown));
  return {
    passed: blockers.length === 0,
    blockers,
    checkedRuleCount: input.checkedRuleCount,
    traceableFactCount: uniqueFacts.size
  };
}

function failure(code: string, message: string, nextAction: string): SingleArticleFailure {
  return { code, message, nextAction };
}

export async function generateFormalArticle(input: {
  operationId: string;
  idempotencyKey: string;
  pack: RagFinalEvidencePack;
  context: FormalGenerationContext;
  productionContractId: string;
  contract: ProductionContractSnapshot;
  actor: SingleArticleActor;
  providerOverride?: string;
}) {
  if (!["generatable", "generatable_with_downgrade"].includes(input.pack.decision)) {
    throw new FormalGenerationError(422, "evidence_not_generatable", "Final EvidencePack 未达到可生成状态，禁止调用正文模型。", "系统将在资料更新后自动重新检索。");
  }
  const provider = resolveProvider(input.providerOverride);
  const generationRunId = await beginFormalGenerationRun({
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    pack: input.pack,
    context: input.context,
    productionContractId: input.productionContractId,
    productionContractHash: input.contract.contractHash,
    provider,
    actor: input.actor
  });
  const title = input.contract.task.title;
  const blockedExpressions = input.contract.validatorPolicy.prohibitedTerms;
  const prohibitedPatterns = input.contract.expressionRule.prohibitedTerms;
  const requiredFormat = input.contract.promptDirectives;
  const checkedRuleCount = input.contract.promptDirectives.length + input.contract.validatorPolicy.prohibitedTerms.length
    + (input.contract.fixedExpressions || []).reduce((total, item) => total + item.positions.length, 0);
  const systemPrompt = "你正在执行已冻结的正式内容生产合同。只能执行合同，不得自行选择策略、文章类型、事实、CTA 或补充外部知识。产品能力、身份、认证、数字和适用边界必须来自 EvidenceItem 并逐句追溯；解释性文字只能说明这些事实对读者判断和行动顺序的影响，不得衍生新产品事实。不得虚构案例、客户、数据、亲历或引语。EvidenceItem.originalQuote 仅供内部事实核验，严禁把原始摘录、审计 JSON、sourceRevisionId 或模型说明展示在读者正文中。输出必须是单个 JSON 对象，字段仅包含 markdown 和 factTraces；factTraces 仅含 sentence、evidenceItemId、claimId、sourceRevisionId。";
  const modelContract = createFormalModelContract(input.contract);
  const tracePlan = requiredTracePlan(modelContract);
  const userPrompt = `请严格执行以下不可变 ProductionContractSnapshot 生成视图：\n${JSON.stringify(modelContract)}\n\n以下 tracePlan 中的句子必须逐字、各一次自然写入正文，并原样复制绑定字段到 factTraces；每个事实句单独成段，不得把 tracePlan 或证据 ID 展示给读者：\n${JSON.stringify(tracePlan)}\n\n正文必须以“# ${title}”开头，并满足合同中的结构、长度、表达、证据、人工边界和渠道规则。请写 1800 至 2200 个中文字符，至少使用 4 个有实际内容的 Markdown 二级标题。至少生成 ${input.contract.validatorPolicy.minTraceableFactCount} 个互不重复的可追溯事实句；每句逐字使用 tracePlan 的 sentence，并原样绑定对应 evidenceItemId、claimId、sourceRevisionId。事实句之间用自然中文解释这些事实如何影响读者的判断、实施顺序与验收动作，每段必须增加新的事实、区分、动作或后果。正文和标题都不要使用破折号或提示性冒号；不要写“不是……而是……”“并非……只是……”等翻案句；不要堆口号，不得虚构案例、数据或亲历。固定文案由系统按位置确定性装配，模型无需自行添加。完整不可变合同仍由系统持久化并用于最终校验；此生成视图只删减与本次写作无关的冗余证据。`;
  let technicalRetryCount = 0;
  let automaticRepairCount = 0;
  let lastBlockers: string[] = [];
  let lastModel: string | undefined;
  let repairPrompt = userPrompt;
  for (let repairRound = 0; repairRound <= 1; repairRound += 1) {
    let providerContent = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await callAiProvider({ provider, systemPrompt, userPrompt: repairPrompt, temperature: 0.2 });
      if (result.ok && result.content) {
        providerContent = result.content;
        lastModel = result.model;
        break;
      }
      if (result.status === "pending_config") {
        const providerFailure = failure("provider_pending_config", "正式正文 Provider 尚未配置。", "补齐所选 Provider 的 API Key、Model 与 Base URL 后，系统将自动恢复当前批次。");
        await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "pending_config", failure: providerFailure, actor: input.actor });
        throw new FormalGenerationError(503, providerFailure.code, providerFailure.message, providerFailure.nextAction, result.missingConfig, true);
      }
      technicalRetryCount += 1;
      lastBlockers = [result.errorMessage || "Provider 调用失败。"];
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)));
    }
    if (!providerContent) {
      const providerFailure = failure("provider_failed", "正式正文 Provider 连续失败，系统已记录并等待批次级自动恢复。", "查看批次顶部服务状态；不需要逐条重试。");
      const recoveryResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0, technicalRetryCount, automaticRepairCount };
      await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: providerFailure, hardRuleResult: recoveryResult, actor: input.actor });
      throw new FormalGenerationError(502, providerFailure.code, providerFailure.message, providerFailure.nextAction, lastBlockers, true);
    }

    let output: FormalProviderOutput | undefined;
    try {
      output = parseFormalProviderOutput(providerContent);
      output = { ...output, markdown: placeFixedExpressions(output.markdown, input.contract.fixedExpressions) };
    } catch (error) {
      lastBlockers = [error instanceof Error ? error.message : "正文输出格式不正确。"];
    }
    const repaired = output ? removeUnsupportedFormalPassages(output, input.pack.evidenceItems, (input.contract.fixedExpressions || []).map((item) => item.text)) : undefined;
    if (repaired?.removedCount) automaticRepairCount += 1;
    output = repaired?.output
      ? ensureMinimumTraceableEvidence(
          repaired.output,
          input.pack.evidenceItems,
          input.contract.validatorPolicy.minTraceableFactCount,
          (input.contract.fixedExpressions || []).map((item) => item.text)
        )
      : undefined;
    const validated = output
      ? validateFormalProviderOutput({
          output,
          title,
          channel: input.contract.task.channel,
          evidenceItems: input.pack.evidenceItems,
          blockedRuleTexts: [...blockedExpressions, ...prohibitedPatterns],
          requiredFormatTexts: requiredFormat,
          checkedRuleCount,
          minTraceableFactCount: input.contract.validatorPolicy.minTraceableFactCount,
          fixedExpressions: input.contract.fixedExpressions
        })
      : { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0 };
    const hardRuleResult: HardRuleResult = { ...validated, technicalRetryCount, automaticRepairCount };
    if (output && hardRuleResult.passed) {
      return completeFormalGeneration({
        operationId: input.operationId,
        generationRunId,
        pack: input.pack,
        context: input.context,
        productionContractId: input.productionContractId,
        productionContractHash: input.contract.contractHash,
        title,
        markdown: output.markdown,
        factTraces: output.factTraces,
        hardRuleResult,
        providerModel: lastModel,
        actor: input.actor
      });
    }
    lastBlockers = hardRuleResult.blockers;
    if (repairRound < 1) {
      automaticRepairCount += 1;
      repairPrompt = `${userPrompt}\n\n系统自动检查发现以下可修复问题：\n${lastBlockers.join("\n")}\n请在不增加任何新事实、不改变冻结标题和证据绑定的前提下重写完整 JSON。`;
    }
  }

  const hardRuleFailure = failure("hard_rule_blocked", "正文在同一生产合同下完成一次受限修复后仍未通过，系统不会继续改写。", "请在异常中心查看具体规则；如需调整表达，请提交样稿反馈生成新的校准版本。");
  const finalRuleResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0, technicalRetryCount, automaticRepairCount };
  await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: hardRuleFailure, hardRuleResult: finalRuleResult, actor: input.actor });
  throw new FormalGenerationError(422, hardRuleFailure.code, hardRuleFailure.message, hardRuleFailure.nextAction, lastBlockers, true);
}
