import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import type { RagEvidenceItem, RagFinalEvidencePack } from "./rag/contracts";
import type { FactTrace, HardRuleResult, SingleArticleActor, SingleArticleFailure } from "./single-article-contracts";
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

function sentencePunctuation(value: string) {
  const trimmed = value.trim().replace(/[。！？!?；;：:]+$/u, "");
  return trimmed ? `${trimmed}。` : "";
}

export function buildDeterministicEvidenceFallback(pack: RagFinalEvidencePack, title: string): FormalProviderOutput | undefined {
  const eligible = pack.evidenceItems.filter((item) => item.primaryClaimId && item.originalQuote.trim() && !item.originalQuote.includes("\n"));
  const boundary = eligible.find((item) => item.conditions.length || item.limitations.length || item.allowedUsage.includes("human_boundary"));
  const selected = [...(boundary ? [boundary] : []), ...eligible.filter((item) => item !== boundary)].slice(0, 10);
  if (selected.length < 8 || !boundary) return undefined;
  const facts = selected.map((item) => {
    const base = sentencePunctuation(item.normalizedClaim || item.summary);
    const boundaries = [...item.conditions, ...item.limitations];
    const sentence = boundaries.length
      ? sentencePunctuation(`${base.replace(/。$/u, "")}；适用边界：${boundaries.join("；")}`)
      : base;
    return {
      item,
      sentence,
      trace: {
        sentence,
        evidenceItemId: item.evidenceItemId,
        claimId: item.primaryClaimId!,
        sourceRevisionId: item.sourceRevisionId,
        originalQuote: item.originalQuote,
        sourceLocator: item.sourceLocator
      } satisfies FactTrace
    };
  });
  const ordinaryFacts = facts.filter(({ item }) => item !== boundary);
  const boundaryFacts = facts.filter(({ item }) => item === boundary);
  const render = ({ item, sentence }: typeof facts[number]) => `- ${sentence}\n> 原文：${item.originalQuote}`;
  return {
    markdown: [`# ${title}`, "## 已证实信息", ...ordinaryFacts.map(render), "## 适用边界与说明", ...boundaryFacts.map(render)].join("\n\n"),
    factTraces: facts.map(({ trace }) => trace)
  };
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

function resolveProvider(): AiProviderKey {
  const configured = String(process.env.V5_FORMAL_ARTICLE_PROVIDER || "qwen").trim().toLowerCase();
  if (configured === "qwen" || configured === "deepseek" || configured === "doubao") return configured;
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
        const originalQuote = typeof value.originalQuote === "string" ? value.originalQuote.trim() : undefined;
        const sourceLocator = value.sourceLocator && typeof value.sourceLocator === "object"
          ? value.sourceLocator as FactTrace["sourceLocator"]
          : undefined;
        return sentence && evidenceItemId && claimId && sourceRevisionId
          ? [{ sentence, evidenceItemId, claimId, sourceRevisionId, originalQuote, sourceLocator }]
          : [];
      })
    : [];
  return { markdown, factTraces };
}

function traceMatchesEvidence(trace: FactTrace, item: RagEvidenceItem) {
  return trace.sourceRevisionId === item.sourceRevisionId
    && Boolean(item.originalQuote.trim())
    && trace.originalQuote === item.originalQuote
    && JSON.stringify(trace.sourceLocator) === JSON.stringify(item.sourceLocator)
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

function factualLines(markdown: string) {
  return markdown.split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, ""))
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(">") && isFactSentence(line));
}

export function removeUnsupportedFormalPassages(output: FormalProviderOutput, evidenceItems: RagEvidenceItem[]) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  const acceptedTraces = output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item && traceMatchesEvidence(trace, item) && sentenceMatchesEvidence(trace.sentence, item));
  });
  const acceptedSentences = new Set(acceptedTraces.map((trace) => trace.sentence));
  const rejectedSentences = new Set(output.factTraces.filter((trace) => !acceptedSentences.has(trace.sentence)).map((trace) => trace.sentence));
  const lines = output.markdown.split(/\r?\n/);
  const keptLines = lines.filter((line) => {
    if ([...rejectedSentences].some((sentence) => line.includes(sentence))) return false;
    const normalized = line.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, "");
    if (!normalized || normalized.startsWith("#") || normalized.startsWith(">") || !isFactSentence(normalized)) return true;
    return [...acceptedSentences].some((sentence) => normalized.includes(sentence));
  });
  return {
    output: { markdown: keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), factTraces: acceptedTraces },
    removedCount: lines.length - keptLines.length + output.factTraces.length - acceptedTraces.length
  };
}

function isFactSentence(sentence: string) {
  const normalized = sentence.trim();
  return normalized.length >= 12 && /[。！？；：.!?;:]$/.test(normalized);
}

export function validateFormalProviderOutput(input: {
  output: FormalProviderOutput;
  title: string;
  evidenceItems: RagEvidenceItem[];
  blockedRuleTexts: string[];
  requiredFormatTexts: string[];
  checkedRuleCount: number;
}): HardRuleResult {
  const blockers: string[] = [];
  const markdown = input.output.markdown;
  if (!markdown) blockers.push("正文为空。");
  if (!markdown.startsWith(`# ${input.title}`)) blockers.push("正文必须以冻结标题作为一级标题。");
  if (input.requiredFormatTexts.some((text) => text.includes("分节")) && (markdown.match(/^##\s+\S+/gm) || []).length < 2) {
    blockers.push("正文分节不足，至少需要两个 Markdown 二级标题。");
  }
  const evidenceById = new Map(input.evidenceItems.map((item) => [item.evidenceItemId, item]));
  const validTraces = input.output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item
      && isFactSentence(trace.sentence)
      && markdown.includes(trace.sentence)
      && markdown.includes(item.originalQuote)
      && traceMatchesEvidence(trace, item)
      && sentenceMatchesEvidence(trace.sentence, item));
  });
  const uniqueFacts = new Set(validTraces.map((trace) => trace.sentence));
  if (validTraces.length !== input.output.factTraces.length) blockers.push("factTraces 包含无法匹配正文或 EvidenceItem 的记录。");
  if (uniqueFacts.size < 8) blockers.push(`可追溯事实句不足 8 条，当前为 ${uniqueFacts.size} 条。`);
  const untracedFacts = factualLines(markdown).filter((sentence) => ![...uniqueFacts].some((fact) => sentence.includes(fact)));
  if (untracedFacts.length) blockers.push(`正文包含 ${untracedFacts.length} 条没有 Claim 追溯的事实句。`);
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
  return {
    passed: blockers.length === 0,
    blockers,
    checkedRuleCount: input.checkedRuleCount,
    traceableFactCount: uniqueFacts.size
  };
}

function evidenceForProvider(pack: RagFinalEvidencePack) {
  return pack.evidenceItems.map((item) => ({
    evidenceItemId: item.evidenceItemId,
    primaryClaimId: item.primaryClaimId,
    claimIds: item.claimIds,
    sourceId: item.sourceId,
    sourceRevisionId: item.sourceRevisionId,
    sourceLocator: item.sourceLocator,
    title: item.title,
    summary: item.summary,
    originalQuote: item.originalQuote,
    normalizedClaim: item.normalizedClaim,
    conditions: item.conditions,
    limitations: item.limitations,
    allowedUsage: item.allowedUsage,
    forbiddenUsage: item.forbiddenUsage
  }));
}

function failure(code: string, message: string, nextAction: string): SingleArticleFailure {
  return { code, message, nextAction };
}

export async function generateFormalArticle(input: {
  operationId: string;
  idempotencyKey: string;
  pack: RagFinalEvidencePack;
  context: FormalGenerationContext;
  actor: SingleArticleActor;
}) {
  if (!["generatable", "generatable_with_downgrade"].includes(input.pack.decision)) {
    throw new FormalGenerationError(422, "evidence_not_generatable", "Final EvidencePack 未达到可生成状态，禁止调用正文模型。", "系统将在资料更新后自动重新检索。");
  }
  const provider = resolveProvider();
  const generationRunId = await beginFormalGenerationRun({
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    pack: input.pack,
    context: input.context,
    provider,
    actor: input.actor
  });
  const task = input.pack.taskSnapshot;
  const title = String(task.title || "").trim();
  const allowedExpressions = extractRuleTexts(input.context.allowedExpressions);
  const conditionalExpressions = extractRuleTexts(input.context.conditionalExpressions);
  const blockedExpressions = extractRuleTexts(input.context.blockedExpressions);
  const evidenceRequirements = extractRuleTexts(input.context.evidenceRequirements);
  const promptHardRules = extractRuleTexts(input.context.promptHardRules);
  const requiredFormat = extractRuleTexts(input.context.channelRequiredFormat);
  const prohibitedPatterns = extractRuleTexts(input.context.channelProhibitedPatterns);
  const checkedRuleCount = promptHardRules.length + blockedExpressions.length + prohibitedPatterns.length + requiredFormat.length;
  const systemPrompt = `${input.context.systemPrompt}\n\n你正在执行正式生产，必须只使用提供的 Final EvidencePack。不得补充常识、猜测、外部资料或未给出的能力。每个事实必须附上 EvidenceItem 中逐字一致的 originalQuote 与 sourceLocator；条件事实必须同时写出全部 conditions 和 limitations。输出必须是单个 JSON 对象，字段仅包含 markdown 和 factTraces。`;
  const userPrompt = `${input.context.userPromptTemplate}\n\n冻结任务：\n${JSON.stringify({
    title,
    productName: task.productName,
    channel: task.channel,
    contentType: task.contentType,
    platformContentType: task.platformContentType,
    targetAudience: task.targetAudience,
    sourceProblem: task.sourceProblem,
    ctaBoundary: input.context.ctaBoundary
  })}\n\n允许表达：\n${JSON.stringify(allowedExpressions)}\n条件表达：\n${JSON.stringify(conditionalExpressions)}\n禁止表达：\n${JSON.stringify([...blockedExpressions, ...prohibitedPatterns])}\n证据要求：\n${JSON.stringify(evidenceRequirements)}\n格式要求：\n${JSON.stringify(requiredFormat)}\n硬规则：\n${JSON.stringify(promptHardRules)}\n\nFinal EvidencePack：\n${JSON.stringify(evidenceForProvider(input.pack))}\n\n输出要求：markdown 必须以“# ${title}”开头，并至少包含两个二级标题；至少写出 8 个以完整标点结尾的事实句，其中至少 1 句必须说明适用条件或限制。每个事实句都必须在 factTraces 中给出原句、evidenceItemId、claimId、sourceRevisionId、逐字一致的 originalQuote 与 sourceLocator。正文必须展示对应 originalQuote；有 conditions 或 limitations 时必须逐项写入正文。`;
  let technicalRetryCount = 0;
  let automaticRepairCount = 0;
  let lastBlockers: string[] = [];
  let lastModel: string | undefined;
  let repairPrompt = userPrompt;
  for (let repairRound = 0; repairRound <= 2; repairRound += 1) {
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
    } catch (error) {
      lastBlockers = [error instanceof Error ? error.message : "正文输出格式不正确。"];
    }
    const repaired = output ? removeUnsupportedFormalPassages(output, input.pack.evidenceItems) : undefined;
    if (repaired?.removedCount) automaticRepairCount += 1;
    output = repaired?.output;
    const validated = output
      ? validateFormalProviderOutput({
          output,
          title,
          evidenceItems: input.pack.evidenceItems,
          blockedRuleTexts: [...blockedExpressions, ...prohibitedPatterns],
          requiredFormatTexts: requiredFormat,
          checkedRuleCount
        })
      : { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0 };
    const hardRuleResult: HardRuleResult = { ...validated, technicalRetryCount, automaticRepairCount };
    if (output && hardRuleResult.passed) {
      return completeFormalGeneration({
        operationId: input.operationId,
        generationRunId,
        pack: input.pack,
        context: input.context,
        title,
        markdown: output.markdown,
        factTraces: output.factTraces,
        hardRuleResult,
        providerModel: lastModel,
        actor: input.actor
      });
    }
    lastBlockers = hardRuleResult.blockers;
    if (repairRound < 2) {
      automaticRepairCount += 1;
      repairPrompt = `${userPrompt}\n\n系统自动检查发现以下可修复问题：\n${lastBlockers.join("\n")}\n请在不增加任何新事实、不改变冻结标题和证据绑定的前提下重写完整 JSON。`;
    }
  }

  const fallbackOutput = buildDeterministicEvidenceFallback(input.pack, title);
  if (fallbackOutput) {
    const fallbackValidation = validateFormalProviderOutput({
      output: fallbackOutput,
      title,
      evidenceItems: input.pack.evidenceItems,
      blockedRuleTexts: [...blockedExpressions, ...prohibitedPatterns],
      requiredFormatTexts: requiredFormat,
      checkedRuleCount
    });
    if (fallbackValidation.passed) {
      const hardRuleResult: HardRuleResult = {
        ...fallbackValidation,
        technicalRetryCount,
        automaticRepairCount: automaticRepairCount + 1
      };
      return completeFormalGeneration({
        operationId: input.operationId,
        generationRunId,
        pack: input.pack,
        context: input.context,
        title,
        markdown: fallbackOutput.markdown,
        factTraces: fallbackOutput.factTraces,
        hardRuleResult,
        providerModel: `${lastModel || provider}-evidence-fallback`,
        actor: input.actor
      });
    }
    lastBlockers = fallbackValidation.blockers;
  }

  const hardRuleFailure = failure("hard_rule_blocked", "正文经两轮自动修复后仍未通过，系统将保留上一份可用正文并记录本次运行。", "不需要逐条重试；系统会在批次恢复时重新处理。");
  const finalRuleResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0, technicalRetryCount, automaticRepairCount };
  await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: hardRuleFailure, hardRuleResult: finalRuleResult, actor: input.actor });
  throw new FormalGenerationError(422, hardRuleFailure.code, hardRuleFailure.message, hardRuleFailure.nextAction, lastBlockers, true);
}
