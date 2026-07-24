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
        return sentence && evidenceItemId && claimId && sourceRevisionId ? [{ sentence, evidenceItemId, claimId, sourceRevisionId }] : [];
      })
    : [];
  return { markdown, factTraces };
}

function traceMatchesEvidence(trace: FactTrace, item: RagEvidenceItem) {
  return trace.sourceRevisionId === item.sourceRevisionId
    && Boolean(item.originalQuote.trim())
    && (trace.claimId === item.primaryClaimId || item.claimIds.includes(trace.claimId));
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
    return Boolean(item && isFactSentence(trace.sentence) && markdown.includes(trace.sentence) && traceMatchesEvidence(trace, item));
  });
  const uniqueFacts = new Set(validTraces.map((trace) => trace.sentence));
  if (validTraces.length !== input.output.factTraces.length) blockers.push("factTraces 包含无法匹配正文或 EvidenceItem 的记录。");
  if (uniqueFacts.size < 8) blockers.push(`可追溯事实句不足 8 条，当前为 ${uniqueFacts.size} 条。`);
  const boundaryEvidenceIds = new Set(input.evidenceItems
    .filter((item) => item.allowedUsage.includes("human_boundary") || item.conditions.length || item.limitations.length)
    .map((item) => item.evidenceItemId));
  if (!boundaryEvidenceIds.size) {
    blockers.push("Final EvidencePack 缺少限制或人工边界证据。");
  } else if (!validTraces.some((trace) => boundaryEvidenceIds.has(trace.evidenceItemId))) {
    blockers.push("正文缺少可追溯到限制或人工边界证据的事实句。");
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
  if (input.pack.decision !== "generatable") {
    throw new FormalGenerationError(422, "evidence_not_generatable", "Final EvidencePack 未达到 generatable，禁止调用正文模型。", "按 EvidencePack 缺口补充证据并重新冻结。");
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
  const systemPrompt = `${input.context.systemPrompt}\n\n你正在执行正式生产，必须只使用提供的 Final EvidencePack。不得补充常识、猜测、外部资料或未给出的能力。输出必须是单个 JSON 对象，字段仅包含 markdown 和 factTraces。`;
  const userPrompt = `${input.context.userPromptTemplate}\n\n冻结任务：\n${JSON.stringify({
    title,
    productName: task.productName,
    channel: task.channel,
    contentType: task.contentType,
    platformContentType: task.platformContentType,
    targetAudience: task.targetAudience,
    sourceProblem: task.sourceProblem,
    ctaBoundary: input.context.ctaBoundary
  })}\n\n允许表达：\n${JSON.stringify(allowedExpressions)}\n条件表达：\n${JSON.stringify(conditionalExpressions)}\n禁止表达：\n${JSON.stringify([...blockedExpressions, ...prohibitedPatterns])}\n证据要求：\n${JSON.stringify(evidenceRequirements)}\n格式要求：\n${JSON.stringify(requiredFormat)}\n硬规则：\n${JSON.stringify(promptHardRules)}\n\nFinal EvidencePack：\n${JSON.stringify(evidenceForProvider(input.pack))}\n\n输出要求：markdown 必须以“# ${title}”开头，并至少包含两个二级标题；至少写出 8 个以完整标点结尾的事实句，其中至少 1 句必须说明适用条件、限制或人工边界。每个事实句都必须在 factTraces 中给出原句、evidenceItemId、claimId、sourceRevisionId，且四者必须与提供的证据完全一致。`;
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

  const hardRuleFailure = failure("hard_rule_blocked", "正文经两轮自动修复后仍未通过，系统将保留上一份可用正文并记录本次运行。", "不需要逐条重试；系统会在批次恢复时重新处理。");
  const finalRuleResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0, technicalRetryCount, automaticRepairCount };
  await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: hardRuleFailure, hardRuleResult: finalRuleResult, actor: input.actor });
  throw new FormalGenerationError(422, hardRuleFailure.code, hardRuleFailure.message, hardRuleFailure.nextAction, lastBlockers, true);
}
