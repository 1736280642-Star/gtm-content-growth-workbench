import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import type { RagEvidenceItem, RagFinalEvidencePack } from "./rag/contracts";
import type { ProductionContractSnapshot } from "./content-production-contracts";
import type { FactTrace, HardRuleResult, SingleArticleActor, SingleArticleFailure } from "./single-article-contracts";
import {
  beginFormalGenerationRun,
  completeFormalGeneration,
  failFormalGenerationRun,
  recordGenerationPromptSnapshot,
  recordSingleArticleProgress,
  type FormalGenerationContext
} from "./single-article-production-repository";
import { entityRelationshipBlockers, missingRequiredCoreClaimIds } from "./production-fact-gates";

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

function assertionUnits(value: string) {
  const normalized = normalizeAssertion(value);
  const units = new Set<string>();
  for (const token of normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || []) {
    if (/^[a-z0-9]+$/.test(token)) {
      if (token.length >= 2) units.add(token);
      continue;
    }
    if (token.length === 1) units.add(token);
    for (let index = 0; index < token.length - 1; index += 1) units.add(token.slice(index, index + 2));
  }
  return units;
}

function sentenceMatchesEvidence(sentence: string, item: RagEvidenceItem) {
  const candidate = normalizeAssertion(sentence);
  const claim = normalizeAssertion(item.normalizedClaim || item.summary);
  const quote = normalizeAssertion(item.originalQuote);
  if (candidate.length < 4) return false;
  if (candidate === claim || quote.includes(candidate) || candidate.includes(claim)) return true;
  const candidateUnits = assertionUnits(sentence);
  const evidenceUnits = assertionUnits(`${item.normalizedClaim} ${item.summary} ${item.originalQuote}`);
  const shared = [...candidateUnits].filter((unit) => evidenceUnits.has(unit)).length;
  const requiredShared = Math.max(3, Math.min(6, Math.ceil(candidateUnits.size * 0.22)));
  return shared >= requiredShared;
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
  const namesAnEntity = /WorkBuddy|JOTO|腾讯(?:云)?|\bADP\b|\bCSP\b/i.test(normalized);
  const makesProductAssertion = /(?:是|属于|作为|认证|服务商|伙伴|支持|提供|具备|集成|部署|接入|实现|能够|可以|可用于|适用于|覆盖|兼容|上线|发布|能力|功能|机制)/i.test(normalized);
  return namesAnEntity && makesProductAssertion;
}

export function removeUnsupportedFormalPassages(output: FormalProviderOutput, evidenceItems: RagEvidenceItem[], fixedTexts: string[] = []) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  const acceptedTraces = output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item && isFactSentence(trace.sentence) && traceMatchesEvidence(trace, item) && sentenceMatchesEvidence(trace.sentence, item));
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

export function removeSyntheticGovernanceSentences(output: FormalProviderOutput, evidenceItems: RagEvidenceItem[]) {
  const originalCorpus = evidenceItems.map((item) => item.originalQuote).join("\n");
  const syntheticBoundaries = [...new Set(evidenceItems.flatMap((item) => [...item.conditions, ...item.limitations])
    .filter((boundary) => boundary.trim() && !originalCorpus.includes(boundary)))];
  if (!syntheticBoundaries.length) return { output, removedCount: 0 };
  let removedCount = 0;
  const lines = output.markdown.split(/\r?\n/).map((line) => {
    if (!line.trim() || line.trim().startsWith("#")) return line;
    const normalizedLine = normalizeAssertion(line);
    const labelledLine = /^(?:适用|前提|限制|边界)(?:条件|范围|要求)?/.test(normalizedLine);
    const lineDerivedFromInternalField = syntheticBoundaries.some((boundary) => normalizedLine.includes(normalizeAssertion(boundary)));
    if (labelledLine && lineDerivedFromInternalField) {
      removedCount += 1;
      return "";
    }
    let removeDependentSentence = false;
    const kept = splitProseSentences(line).filter((sentence) => {
      const normalized = normalizeAssertion(sentence);
      const derivedFromInternalField = syntheticBoundaries.some((boundary) => normalized.includes(normalizeAssertion(boundary)));
      if (derivedFromInternalField) {
        removeDependentSentence = true;
        removedCount += 1;
        return false;
      }
      if (removeDependentSentence && /^(?:这些|上述|这类|该类)(?:前置工作|条件|限制|要求|安排|设计)/.test(normalized)) {
        removeDependentSentence = false;
        removedCount += 1;
        return false;
      }
      removeDependentSentence = false;
      return true;
    });
    return kept.join("");
  }).filter((line) => line.trim());
  const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    output: { ...output, markdown, factTraces: output.factTraces.filter((trace) => markdown.includes(trace.sentence)) },
    removedCount
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

function replaceDisallowedColons(line: string) {
  if (!/[：:]/.test(line) || /(?:说|问|答|写道|回复)[^：:]{0,24}[：:]\s*[“「"]/.test(line)) return line;
  const protectedValues: string[] = [];
  const protectedLine = line.replace(/https?:\/\/[^\s)\]}，。；;]+|`[^`]*`/g, (value) => {
    protectedValues.push(value);
    return `__FORMAL_PROTECTED_${protectedValues.length - 1}__`;
  });
  return protectedLine.replace(/[：:]/g, "。")
    .replace(/__FORMAL_PROTECTED_(\d+)__/g, (_match, index) => protectedValues[Number(index)] || "");
}

export function repairFormalOutputLocally(output: FormalProviderOutput) {
  const seen = new Set<string>();
  const keptLines = output.markdown.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(">") || trimmed.startsWith("```")) {
      return [replaceDisallowedColons(line)];
    }
    const prefix = line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/)?.[0] || "";
    const prose = trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, "");
    const uniqueSentences = splitProseSentences(prose).filter((sentence) => {
      const normalized = normalizeAssertion(sentence);
      if (normalized.length < 16) return true;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    const repaired = replaceDisallowedColons(uniqueSentences.join(""));
    return repaired ? [`${prefix}${repaired}`] : [];
  });
  const markdown = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const traced = new Set<string>();
  const factTraces = output.factTraces.filter((trace) => {
    if (!markdown.includes(trace.sentence) || traced.has(trace.sentence)) return false;
    traced.add(trace.sentence);
    return true;
  });
  return { markdown, factTraces };
}

export function reconcileCoreClaimTraces(
  output: FormalProviderOutput,
  evidenceItems: RagEvidenceItem[],
  requiredCoreClaimIds: string[]
) {
  const traces = [...output.factTraces];
  const covered = new Set(traces.map((trace) => trace.claimId));
  const sentences = factualLines(output.markdown).filter(isProductClaimLine);
  for (const claimId of requiredCoreClaimIds) {
    if (covered.has(claimId)) continue;
    const evidence = evidenceItems.find((item) => item.claimIds.includes(claimId));
    if (!evidence) continue;
    const sentence = sentences.find((candidate) => sentenceMatchesEvidence(candidate, evidence));
    if (!sentence) continue;
    traces.push({
      sentence,
      evidenceItemId: evidence.evidenceItemId,
      claimId,
      sourceRevisionId: evidence.sourceRevisionId
    });
    covered.add(claimId);
  }
  return { ...output, factTraces: traces };
}

export function reconcileEvidenceFactTraces(
  output: FormalProviderOutput,
  evidenceItems: RagEvidenceItem[],
  fixedTexts: string[] = []
) {
  const traces = [...output.factTraces];
  const tracedSentences = new Set(traces.map((trace) => trace.sentence));
  const sentences = factualLines(output.markdown)
    .filter(isProductClaimLine)
    .filter((sentence) => !fixedTexts.some((text) => sentence.includes(text)));
  for (const sentence of sentences) {
    if (tracedSentences.has(sentence)) continue;
    const evidence = evidenceItems.find((item) =>
      Boolean(item.primaryClaimId) && sentenceMatchesEvidence(sentence, item)
    );
    if (!evidence?.primaryClaimId) continue;
    traces.push({
      sentence,
      evidenceItemId: evidence.evidenceItemId,
      claimId: evidence.primaryClaimId,
      sourceRevisionId: evidence.sourceRevisionId
    });
    tracedSentences.add(sentence);
  }
  return { ...output, factTraces: traces };
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
  const unsupportedGovernanceTexts = new Set(contract.evidencePack.evidenceItems.flatMap((item) => [...item.conditions, ...item.limitations])
    .filter((text) => text.trim() && !contract.evidencePack.evidenceItems.some((candidate) => candidate.originalQuote.includes(text))));
  const requiredCoreClaimIds = new Set(contract.validatorPolicy.requiredCoreClaimIds);
  const core = contract.evidencePack.evidenceItems.filter((item) =>
    item.claimIds.some((claimId) => requiredCoreClaimIds.has(claimId))
  );
  const limit = Math.min(16, Math.max(core.length + 6, 8));
  const selected: typeof contract.evidencePack.evidenceItems = [];
  const seen = new Set<string>();
  for (const item of [...core, ...contract.evidencePack.evidenceItems]) {
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
        conditions: item.conditions.filter((text) => item.originalQuote.includes(text)),
        limitations: item.limitations.filter((text) => item.originalQuote.includes(text)),
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
      conditionalExpressions: contract.productRule.conditionalExpressions.filter((text) => !unsupportedGovernanceTexts.has(text)).slice(0, 20),
      blockedExpressions: contract.productRule.blockedExpressions.slice(0, 30)
    },
    allowedExpressions: contract.allowedExpressions.slice(0, 20),
    conditionalExpressions: contract.conditionalExpressions.filter((text) => !unsupportedGovernanceTexts.has(text)).slice(0, 20),
    promptDirectives: contract.promptDirectives.filter((text) => !/所有条件和限制必须进入正文/.test(text)).slice(0, 30)
  };
}

function ensureTerminalPunctuation(value: string) {
  const trimmed = value.trim();
  return /[。！？；，.!?;:]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function requiredTracePlan(contract: ReturnType<typeof createFormalModelContract>) {
  const required = new Set(contract.validatorPolicy.requiredCoreClaimIds);
  const seenClaims = new Set<string>();
  return contract.evidencePack.evidenceItems
    .filter((item) => item.primaryClaimId && item.claimIds.some((claimId) => required.has(claimId)))
    .filter((item) => {
      if (!item.primaryClaimId || seenClaims.has(item.primaryClaimId)) return false;
      seenClaims.add(item.primaryClaimId);
      return true;
    })
    .map((item) => ({
      sentence: ensureTerminalPunctuation(item.summary.replace(/[。！？；，.!?;:]$/, "")),
      evidenceItemId: item.evidenceItemId,
      claimId: item.primaryClaimId,
      sourceRevisionId: item.sourceRevisionId,
      conditions: item.conditions,
      limitations: item.limitations
    }));
}

export function ensureRequiredCoreClaimEvidence(
  output: FormalProviderOutput,
  evidenceItems: RagEvidenceItem[],
  requiredCoreClaimIds: string[]
) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  const valid = output.factTraces.filter((trace) => {
    const item = evidenceById.get(trace.evidenceItemId);
    return Boolean(item && isFactSentence(trace.sentence) && traceMatchesEvidence(trace, item) && sentenceMatchesEvidence(trace.sentence, item) && output.markdown.includes(trace.sentence));
  });
  const usedClaims = new Set(valid.map((trace) => trace.claimId));
  const additions: Array<{ sentence: string; item: RagEvidenceItem }> = [];
  for (const claimId of requiredCoreClaimIds) {
    if (usedClaims.has(claimId)) continue;
    const item = evidenceItems.find((candidate) => candidate.claimIds.includes(claimId));
    if (!item?.primaryClaimId) continue;
    const sourceSentence = (item.originalQuote || item.normalizedClaim || item.summary).trim();
    let sentence = ensureTerminalPunctuation(sourceSentence);
    if (!sentence || sentence.length < 12 || additions.some((entry) => entry.sentence === sentence)) continue;
    if (/^(?:把|将)/.test(sourceSentence)) sentence = ensureTerminalPunctuation(`在实际落地中，需要${sourceSentence}`);
    if (output.markdown.includes(sentence)) continue;
    additions.push({ sentence, item });
  }
  if (!additions.length) return output;

  const blocks = output.markdown.split(/\n{2,}/);
  const paragraphIndex = blocks.findIndex((block, index) => index > 0 && !block.trim().startsWith("#") && /WorkBuddy|JOTO/i.test(block));
  const additionText = additions.map(({ sentence }) => sentence).join("\n");
  if (paragraphIndex >= 0) blocks[paragraphIndex] = `${blocks[paragraphIndex].trimEnd()}\n${additionText}`;
  else blocks.push(additionText);
  const markdown = blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
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
  requiredCoreClaimIds: string[];
  entityIdentity: ProductionContractSnapshot["validatorPolicy"]["entityIdentity"];
  fixedExpressions?: ProductionContractSnapshot["fixedExpressions"];
}): HardRuleResult {
  const blockers: string[] = [];
  const markdown = input.output.markdown;
  if (!markdown) blockers.push("正文为空。");
  if (!markdown.startsWith(`# ${input.title}`)) blockers.push("正文必须以冻结标题作为一级标题。");
  const emptySections = markdown.split(/^##\s+\S+.*$/gm).slice(1).filter((section) => !section.trim());
  if (emptySections.length) blockers.push(`正文包含 ${emptySections.length} 个空章节。`);
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
  const coveredClaimIds = new Set(validTraces.map((trace) => trace.claimId));
  const missingCoreClaimIds = missingRequiredCoreClaimIds(input.requiredCoreClaimIds, coveredClaimIds);
  if (missingCoreClaimIds.length) blockers.push(`当前选题的核心 Claim 未覆盖：${missingCoreClaimIds.join("、")}。`);
  const fixedTexts = (input.fixedExpressions || []).map((item) => item.text);
  const untracedFacts = factualLines(markdown).filter(isProductClaimLine).filter((sentence) => !fixedTexts.some((text) => sentence.includes(text))
    && !validTraces.some((trace) => {
      const item = evidenceById.get(trace.evidenceItemId);
      return sentence === trace.sentence || Boolean(item && sentenceMatchesEvidence(sentence, item));
    }));
  if (untracedFacts.length) blockers.push(`正文包含 ${untracedFacts.length} 条没有 Claim 追溯的事实句。`);
  blockers.push(...entityRelationshipBlockers(markdown, input.entityIdentity));
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

function isNonRetryableProviderError(message: string) {
  return /invalid.*(api|key|model)|unauthorized|forbidden|permission|quota|insufficient|account|billing|model.*not.*found|401|403/i.test(message);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
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
  await recordSingleArticleProgress({ operationId: input.operationId, progressStage: "provider_preflight" });
  const preflight = await callAiProvider({
    provider,
    systemPrompt: "You are a provider connectivity probe.",
    userPrompt: "Reply with OK only.",
    temperature: 0,
    maxTokens: 2,
    timeoutMs: Number(process.env.AI_PROVIDER_PREFLIGHT_TIMEOUT_MS || 8_000)
  });
  if (!preflight.ok) {
    const pendingConfig = preflight.status === "pending_config";
    throw new FormalGenerationError(
      pendingConfig ? 503 : 502,
      pendingConfig ? "provider_pending_config" : "provider_preflight_failed",
      pendingConfig ? "正式正文 Provider 尚未配置。" : "正式正文 Provider 最小预检失败。",
      pendingConfig ? "补齐所选 Provider 的 API Key、Model 与 Base URL 后重试。" : "检查模型、账户权限和网络后，系统可复用同一任务创建新的幂等操作。",
      pendingConfig ? preflight.missingConfig : [preflight.errorMessage || "Provider preflight failed."]
    );
  }
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
  await recordSingleArticleProgress({ operationId: input.operationId, progressStage: "calling_provider" });
  const title = input.contract.task.title;
  const blockedExpressions = input.contract.validatorPolicy.prohibitedTerms;
  const prohibitedPatterns = input.contract.expressionRule.prohibitedTerms;
  const requiredFormat = input.contract.promptDirectives;
  const checkedRuleCount = input.contract.promptDirectives.length + input.contract.validatorPolicy.prohibitedTerms.length
    + (input.contract.fixedExpressions || []).reduce((total, item) => total + item.positions.length, 0);
  const systemPrompt = "你是一名面向企业决策者的中文内容作者。你的首要任务是写出自然、连贯、让真实读者愿意读下去的文章，同时严格遵守已冻结的事实合同。产品能力、身份、认证、数字和适用边界只能来自 EvidenceItem；普通的场景解释、判断过程和段落过渡可以自然表达，但不得把常识扩展成新的产品事实。不得虚构案例、客户、数据、亲历或引语。核心 Claim 可以保持原义自然改写，不得把证据逐条抄成清单。严禁把原始摘录、EvidenceItem、Claim ID、审计 JSON 或模型说明展示给读者。输出必须是单个 JSON 对象，字段仅包含 markdown 和 factTraces；factTraces 仅含 sentence、evidenceItemId、claimId、sourceRevisionId。";
  const modelContract = createFormalModelContract(input.contract);
  const tracePlan = requiredTracePlan(modelContract);
  const userPrompt = `请依据以下冻结的 ProductionContractSnapshot 生成视图写作：\n${JSON.stringify(modelContract)}\n\n以下 tracePlan 是当前选题必须覆盖的核心事实。请保持事实含义不变，用适合上下文的自然中文表达；不要逐字抄写，不要把它们集中成“事实清单”。conditions、limitations 是系统内部治理字段，只用于避免扩大产品能力；除非对应 originalQuote 本身逐字包含该表述，否则不得在正文中增加“适用条件”“限制条件”“前提是”等说明，更不得把字段内容机械拼接为新句子。正文中实际承载产品事实的完整句子必须写入 factTraces，并原样复制对应的 evidenceItemId、claimId、sourceRevisionId：\n${JSON.stringify(tracePlan)}\n\n正文必须以“# ${title}”开头。围绕一个清晰的读者问题形成连续主线，先让读者理解现实困境，再给出判断、产品作用和采用边界。文章类型中的结构模块是写作参考，不是必须逐项填满的目录；根据内容自然使用 3 至 5 个二级标题。篇幅遵循合同的 minLength 与 maxLength，不为凑字数加入空泛管理建议。正文中的产品事实必须绑定 EvidenceItem 和 Claim，并覆盖 tracePlan 中的核心 Claim；非产品性的解释负责连接事实、说明它们对判断和行动的意义。validatorPolicy.entityIdentity 是身份关系的唯一权威定义。没有正式证据时不要写案例、效果数据、ROI、价格或竞品结论。避免口号、同义反复、短句清单和说明书语气。固定文案由系统按位置确定性装配，模型无需自行添加。`;
  const expressionSnapshot = input.pack.taskSnapshot.platformExpressionSnapshot;
  const expressionRecord = expressionSnapshot && typeof expressionSnapshot === "object"
    ? expressionSnapshot as Record<string, unknown>
    : {};
  const brief = {
    title,
    articleType: typeof expressionRecord.articleTypeName === "string"
      ? expressionRecord.articleTypeName
      : input.contract.task.contentType,
    channel: input.contract.task.channel,
    targetAudience: input.contract.task.targetAudience,
    questionToAnswer: input.contract.task.coreProblem,
    promotionGoal: input.contract.task.promotionGoal,
    writingDirection: [
      "围绕一个读者问题形成连续主线，不按证据逐条展开。",
      "从真实决策困境进入，说明产品作用、采用路径和人工判断边界。",
      "结构模块是参考，不是固定目录；没有证据时不补写案例或效果数据。"
    ],
    coreFacts: tracePlan.map((item) => item.sentence),
    entityIdentity: input.contract.validatorPolicy.entityIdentity,
    fixedExpressions: input.contract.fixedExpressions,
    factualRules: [
      "正文中的产品事实都能关联到知识库 Claim。",
      "当前选题的核心 Claim 已覆盖。",
      "产品身份和实体关系正确。",
      "固定文案按指定位置逐字出现。"
    ],
    userRevisionRequirements: (input.contract.expressionRule.calibrationDirectives || [])
      .filter((item) => item.startsWith("用户对上一版样文的修改要求："))
  };
  await recordGenerationPromptSnapshot({ generationRunId, systemPrompt, userPrompt, brief });
  let technicalRetryCount = 0;
  let automaticRepairCount = 0;
  let lastBlockers: string[] = [];
  let lastTraceableFactCount = 0;
  let lastModel: string | undefined;
  let repairPrompt = userPrompt;
  let providerCallCount = 0;
  let providerDurationMs = 0;
  let providerInputTokens = 0;
  let providerOutputTokens = 0;
  const maximumProviderCalls = boundedInteger(process.env.AI_PROVIDER_FORMAL_MAX_CALLS, 3, 1, 3);
  const maximumAttemptsPerRound = boundedInteger(process.env.AI_PROVIDER_FORMAL_MAX_ATTEMPTS_PER_ROUND, 2, 1, 2);
  const providerTimeoutMs = boundedInteger(process.env.AI_PROVIDER_FORMAL_TIMEOUT_MS, 180_000, 30_000, 300_000);
  const generationDeadlineMs = boundedInteger(process.env.AI_PROVIDER_FORMAL_DEADLINE_MS, 360_000, 60_000, 600_000);
  const generationDeadlineAt = Date.now() + generationDeadlineMs;
  for (let repairRound = 0; repairRound <= 1; repairRound += 1) {
    let providerContent = "";
    for (let attempt = 1; attempt <= maximumAttemptsPerRound; attempt += 1) {
      const remainingMs = generationDeadlineAt - Date.now();
      if (providerCallCount >= maximumProviderCalls || remainingMs < 1_000) {
        lastBlockers = [`正式正文生成超过全局时间预算 ${generationDeadlineMs}ms，已停止继续调用模型。`];
        break;
      }
      const result = await callAiProvider({
        provider,
        systemPrompt,
        userPrompt: repairPrompt,
        temperature: 0.2,
        timeoutMs: Math.min(providerTimeoutMs, remainingMs)
      });
      providerCallCount += 1;
      providerDurationMs += result.metrics.durationMs;
      providerInputTokens += result.metrics.inputTokens || 0;
      providerOutputTokens += result.metrics.outputTokens || 0;
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
      if (isNonRetryableProviderError(lastBlockers[0])) break;
      if (attempt < maximumAttemptsPerRound && providerCallCount < maximumProviderCalls) {
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)));
      }
    }
    if (!providerContent) {
      const deadlineExceeded = Date.now() >= generationDeadlineAt || lastBlockers.some((item) => item.includes("全局时间预算"));
      const providerFailure = deadlineExceeded
        ? failure("provider_deadline_exceeded", "正式正文生成已达到整篇时间上限，系统停止继续重试。", "当前任务已安全失败；稍后由批次恢复，不需要重复点击。")
        : failure("provider_failed", "正式正文 Provider 连续失败，系统已记录并等待批次级自动恢复。", "查看批次顶部服务状态；不需要逐条重试。");
      const recoveryResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0, technicalRetryCount, automaticRepairCount, providerCallCount, providerDurationMs, providerInputTokens, providerOutputTokens };
      await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: providerFailure, hardRuleResult: recoveryResult, actor: input.actor });
      throw new FormalGenerationError(deadlineExceeded ? 504 : 502, providerFailure.code, providerFailure.message, providerFailure.nextAction, lastBlockers, true);
    }

    let output: FormalProviderOutput | undefined;
    await recordSingleArticleProgress({ operationId: input.operationId, progressStage: "local_repair" });
    try {
      output = parseFormalProviderOutput(providerContent);
    } catch (error) {
      lastBlockers = [error instanceof Error ? error.message : "正文输出格式不正确。"];
    }
    const repaired = output ? removeUnsupportedFormalPassages(output, input.pack.evidenceItems, (input.contract.fixedExpressions || []).map((item) => item.text)) : undefined;
    if (repaired?.removedCount) automaticRepairCount += 1;
    const governanceCleaned = repaired?.output ? removeSyntheticGovernanceSentences(repaired.output, input.pack.evidenceItems) : undefined;
    if (governanceCleaned?.removedCount) automaticRepairCount += 1;
    output = governanceCleaned?.output;
    if (output) {
      output = repairFormalOutputLocally(output);
      output = reconcileCoreClaimTraces(output, input.pack.evidenceItems, input.contract.validatorPolicy.requiredCoreClaimIds);
      output = ensureRequiredCoreClaimEvidence(output, input.pack.evidenceItems, input.contract.validatorPolicy.requiredCoreClaimIds);
      output = reconcileEvidenceFactTraces(
        output,
        input.pack.evidenceItems,
        (input.contract.fixedExpressions || []).map((item) => item.text)
      );
      output = { ...output, markdown: placeFixedExpressions(output.markdown, input.contract.fixedExpressions) };
    }
    await recordSingleArticleProgress({ operationId: input.operationId, progressStage: "quality_validation" });
    const validated = output
      ? validateFormalProviderOutput({
          output,
          title,
          channel: input.contract.task.channel,
          evidenceItems: input.pack.evidenceItems,
          blockedRuleTexts: [...blockedExpressions, ...prohibitedPatterns],
          requiredFormatTexts: requiredFormat,
          checkedRuleCount,
          requiredCoreClaimIds: input.contract.validatorPolicy.requiredCoreClaimIds,
          entityIdentity: input.contract.validatorPolicy.entityIdentity,
          fixedExpressions: input.contract.fixedExpressions
        })
      : { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0 };
    const hardRuleResult: HardRuleResult = { ...validated, technicalRetryCount, automaticRepairCount, providerCallCount, providerDurationMs, providerInputTokens, providerOutputTokens };
    lastTraceableFactCount = hardRuleResult.traceableFactCount;
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
      if (providerCallCount >= maximumProviderCalls || generationDeadlineAt - Date.now() < 1_000) break;
      automaticRepairCount += 1;
      await recordSingleArticleProgress({ operationId: input.operationId, progressStage: "calling_provider" });
      repairPrompt = `${userPrompt}\n\n系统自动检查发现以下可修复问题：\n${lastBlockers.join("\n")}\n请在不增加任何新事实、不改变冻结标题和证据绑定的前提下重写完整 JSON。`;
    }
  }

  const hardRuleFailure = failure("hard_rule_blocked", "正文在同一生产合同下完成一次受限修复后仍未通过，系统不会继续改写。", "请在异常中心查看具体规则；如需调整表达，请提交样稿反馈生成新的校准版本。");
  const finalRuleResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: lastTraceableFactCount, technicalRetryCount, automaticRepairCount, providerCallCount, providerDurationMs, providerInputTokens, providerOutputTokens };
  await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: hardRuleFailure, hardRuleResult: finalRuleResult, actor: input.actor });
  throw new FormalGenerationError(422, hardRuleFailure.code, hardRuleFailure.message, hardRuleFailure.nextAction, lastBlockers, true);
}
