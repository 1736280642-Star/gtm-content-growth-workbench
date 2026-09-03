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
import {
  buildArticleSemanticJudgePrompt,
  evaluateArticleQualityRubric,
  evaluateBusinessChainRubric,
  parseArticleSemanticJudge
} from "./production-rubrics";
import { JOTO_ADP_CSP_IDENTITY, normalizeJotoAdpIdentityPhrasing } from "./geo-product-identity";
import { analyzePromotionSubjectCoverage, promotionCapabilityLabels } from "./promotion-subject-policy";
import { analyzeGovernedFaqCoverage, parseGovernedFaqItems, placeGovernedFaqBeforeCta } from "./faq-governance-policy";

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
  const rawMarkdown = typeof parsed.markdown === "string" ? parsed.markdown.trim() : "";
  // Some OpenAI-compatible providers double-escape Markdown newlines inside
  // an otherwise valid JSON response. Convert them only when the decoded
  // value contains no real line break, so legitimate code literals stay
  // untouched. Without this guard an entire article is parsed as one line and
  // every H2/paragraph quality check incorrectly sees an empty structure.
  const markdown = rawMarkdown && !/[\r\n]/.test(rawMarkdown) && /\\+[rn]/.test(rawMarkdown)
    ? rawMarkdown.replace(/\\+r\\+n|\\+n|\\+r/g, "\n").trim()
    : rawMarkdown;
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

function belongsToFixedExpression(sentence: string, fixedText: string) {
  const normalizedSentence = normalizeAssertion(sentence);
  const normalizedFixedText = normalizeAssertion(fixedText);
  return Boolean(normalizedSentence && normalizedFixedText)
    && (normalizedFixedText.includes(normalizedSentence) || normalizedSentence.includes(normalizedFixedText));
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

function markdownTableDataRows(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  return lines.filter((line, index) => {
    const trimmed = line.trim();
    if (!/^\|.+\|$/.test(trimmed) || /^\|?\s*:?-{3,}/.test(trimmed)) return false;
    const next = lines[index + 1]?.trim() || "";
    return !/^\|?\s*:?-{3,}/.test(next);
  });
}

function quantitativeTokens(value: string) {
  return Array.from(new Set(value.match(/\d+(?:\.\d+)?(?:%|％|万\+?|倍|天|周|月|小时|分钟|秒)?/g) || []));
}

function isProductClaimLine(line: string) {
  const normalized = line.trim();
  if (!normalized) return false;
  const withoutAnswerPrefix = normalized.replace(/^(?:\*\*)?A[：:](?:\*\*)?\s*/i, "");
  const isVerificationGuidance = /^(?:(?:企业|读者|采购方|决策者|选型时|评估时)[，,]?)?(?:应当?|建议|需要|可先|可以先|优先)(?:通过)?(?:核对|确认|查验|验证|比较|询问|检查)/.test(withoutAnswerPrefix);
  const containsEmbeddedProductFact = /(?:JOTO|腾讯(?:云)?|\bADP\b).{0,40}(?:提供|具备|支持|覆盖|集成|部署|实现|能够|可用于|适用于|认证为|授权为)/i.test(withoutAnswerPrefix);
  const isNormativeSelectionReasoning = (
    /^(?:企业|读者|采购方|决策者).{0,35}(?:需要|应当?|必须|建议|优先)/.test(withoutAnswerPrefix)
    || /^(?:在|对于).{0,35}(?:选型|考察|实施|核验|评估).{0,35}(?:需要|应当?|必须|建议|优先)/.test(withoutAnswerPrefix)
    || /^(?:通过|基于|由此|因此|这意味着).{0,45}企业(?:可以|能够|可|需要)/.test(withoutAnswerPrefix)
  );
  // A decision instruction (for example, "应核对……") does not itself
  // assert that the named product has a capability. FAQ governance still
  // requires every answer to contain a separate Claim-backed fact, while an
  // embedded product assertion remains subject to the normal fact gate.
  if ((isVerificationGuidance || isNormativeSelectionReasoning) && !containsEmbeddedProductFact) return false;
  if (/^(?:围绕|本文将|下文将).*(?:问题|判断|梳理|核对|展开)/.test(normalized)) return false;
  if (/(?:构成|作为).{0,18}(?:核验|判断|决策|评估).{0,8}(?:基准|依据)|(?:可以|可)拆解为以下|这些场景的共同特点|在评估\s*JOTO\s*时.{0,24}(?:核对|确认)/i.test(normalized)) return false;
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
  // A trace is model-authored metadata, not authority to delete prose. When a
  // trace is invalid, discard only the trace and keep the sentence available
  // for deterministic reconciliation. If no EvidenceItem can support it, the
  // final validator blocks the untraced product assertion and asks the model
  // for one bounded repair. This prevents a metadata mismatch from collapsing
  // a coherent article to headings while preserving fail-closed fact safety.
  const markdown = output.markdown.replace(/\n{3,}/g, "\n\n").trim();
  return {
    output: { markdown, factTraces: acceptedTraces },
    removedCount: output.factTraces.length - acceptedTraces.length
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
    if (rule.text === "JOTO是腾讯云ADP CSP授权服务商") {
      result = placeJotoOfficialPositioning(result, rule.positions);
      continue;
    }
    result = result.split(/\r?\n/).map((line) => {
      if (!line.trim() || line.trim().startsWith("#")) return line;
      return splitProseSentences(line).filter((sentence) => !belongsToFixedExpression(sentence, rule.text)).join("");
    }).filter((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

export function containsBlockedAssertion(markdown: string, text: string) {
  const lowerMarkdown = markdown.toLocaleLowerCase();
  const lowerText = text.toLocaleLowerCase();
  let from = 0;
  while (from < lowerMarkdown.length) {
    const index = lowerMarkdown.indexOf(lowerText, from);
    if (index < 0) return false;
    const prefix = lowerMarkdown.slice(Math.max(0, index - 18), index).replace(/[\s“”‘’'"：:，,。.!！?？；;、]+/g, "");
    if (!/(?:避免|不得|不要|不能|不应|不会|拒绝|防止|切勿|不做|不作|警惕|核对)$/.test(prefix)) return true;
    from = index + lowerText.length;
  }
  return false;
}

function repairHeadingPunctuation(line: string) {
  const match = line.match(/^(\s*#{1,6}\s+)(.+)$/);
  if (!match) return line;
  let text = match[2].trim().replace(/[。.]+/g, "：").replace(/[，,；;：:、]+$/g, "");
  const questionCount = (text.match(/[？?]/g) || []).length;
  if (questionCount > 1) {
    let seen = 0;
    text = text.replace(/[？?]/g, () => (++seen < questionCount ? "，" : "？"));
  }
  return `${match[1]}${text}`;
}

export function repairFormalOutputLocally(output: FormalProviderOutput, protectedTexts: string[] = []) {
  const seen = new Set<string>();
  const keptLines = output.markdown.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return [repairHeadingPunctuation(line)];
    if (!trimmed || trimmed.startsWith(">") || trimmed.startsWith("```")) return [line];
    if (protectedTexts.some((text) => text && trimmed.includes(text))) return [line];
    const prefix = line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/)?.[0] || "";
    const prose = trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, "");
    const uniqueSentences = splitProseSentences(prose).filter((sentence) => {
      const normalized = normalizeAssertion(sentence);
      if (protectedTexts.some((text) => text && sentence.includes(text))) {
        seen.add(normalized);
        return true;
      }
      if (normalized.length < 16) return true;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    const repaired = uniqueSentences.join("");
    return repaired ? [`${prefix}${repaired}`] : [];
  });
  const markdown = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const traced = new Set<string>();
  const factTraces = output.factTraces.filter((trace) => {
    const key = `${trace.sentence}\u0000${trace.claimId}`;
    if (!markdown.includes(trace.sentence) || traced.has(key)) return false;
    traced.add(key);
    return true;
  });
  return { markdown, factTraces };
}

function removeEmptyMarkdownSections(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!/^##\s+/.test(lines[index].trim())) {
      kept.push(lines[index]);
      index += 1;
      continue;
    }
    let next = index + 1;
    while (next < lines.length && !/^##\s+/.test(lines[next].trim())) next += 1;
    const body = lines.slice(index + 1, next).some((line) => line.trim() && !/^#{3,6}\s+/.test(line.trim()));
    if (body) kept.push(...lines.slice(index, next));
    index = next;
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function ensureGeoMissionOpening(
  markdown: string,
  title: string,
  mission: ProductionContractSnapshot["geoMission"],
  fixedTexts: string[] = []
) {
  const lines = markdown.split(/\r?\n/);
  const titleLineIndex = lines.findIndex((line) => line.trim() === `# ${title}` || /^#\s+/.test(line.trim()));
  const firstHeadingIndex = lines.findIndex((line, index) => index > titleLineIndex && /^##\s+/.test(line.trim()));
  const naturalOpening = lines.slice(Math.max(0, titleLineIndex + 1), firstHeadingIndex >= 0 ? firstHeadingIndex : lines.length)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !fixedTexts.some((text) => text && line.includes(text)))
    .join("\n");
  const primaryName = mission.entityGraph.nodes.find((item) => item.entityId === mission.primaryEntityId)?.name || "";
  const aligned = primaryName && naturalOpening.includes(primaryName)
    && mission.titlePromiseDimensions.some((item) => containsAssertionMeaning(naturalOpening, item));
  if (aligned) return markdown;
  const promise = mission.titlePromiseDimensions.join("、") || mission.articleRole;
  const inserted = `围绕“${mission.primaryQuestion}”，下文按${promise}展开，并说明证据边界和采用时需要核对的事项。`;
  const insertAt = titleLineIndex >= 0 ? titleLineIndex + 1 : 0;
  lines.splice(insertAt, 0, "", inserted, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function containsAssertionMeaning(text: string, value: string) {
  const normalizedText = normalizeAssertion(text);
  const normalizedValue = normalizeAssertion(value);
  if (!normalizedValue) return true;
  if (normalizedText.includes(normalizedValue)) return true;
  const terms = value.split(/[、，。；：\s]|以及|并且|和|与|及/).map(normalizeAssertion).filter((item) => item.length >= 3);
  return terms.some((item) => normalizedText.includes(item));
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
    .filter((sentence) => !fixedTexts.some((text) => belongsToFixedExpression(sentence, text)));
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

export function reconcileGovernedFaqFactTraces(
  output: FormalProviderOutput,
  contract: ProductionContractSnapshot,
  evidenceItems: RagEvidenceItem[]
) {
  const traces = [...output.factTraces];
  const traced = new Set(traces.map((trace) => `${trace.sentence}\u0000${trace.claimId}`));
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceItemId, item]));
  for (const faq of parseGovernedFaqItems(output.markdown)) {
    const sentences = splitProseSentences(faq.answer).filter((sentence) => sentence.length >= 8 && output.markdown.includes(sentence));
    for (const candidate of contract.faqPlan.evidenceCandidates) {
      const evidence = evidenceById.get(candidate.evidenceItemId);
      if (!evidence || !evidence.claimIds.includes(candidate.claimId)) continue;
      const sentence = sentences.find((item) => sentenceMatchesEvidence(item, evidence));
      if (!sentence) continue;
      const key = `${sentence}\u0000${candidate.claimId}`;
      if (!traced.has(key)) {
        traces.push({
          sentence,
          evidenceItemId: candidate.evidenceItemId,
          claimId: candidate.claimId,
          sourceRevisionId: candidate.sourceRevisionId
        });
        traced.add(key);
      }
      break;
    }
  }
  return { ...output, factTraces: traces };
}

function placeJotoOfficialPositioning(markdown: string, positions: Array<"opening" | "body" | "ending">) {
  const fixedText = JOTO_ADP_CSP_IDENTITY;
  const cleaned = normalizeJotoAdpIdentityPhrasing(markdown, { exactIdentityWillBeAssembled: true })
    .replaceAll(`在落地服务关系上，${fixedText}。`, "")
    .replaceAll(`在落地服务关系上，${fixedText}，`, "")
    .replaceAll(`${fixedText}。`, "")
    .replaceAll(`${fixedText}，`, "")
    .replaceAll(fixedText, "")
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim() || line.trim().startsWith("#")) return line;
      return splitProseSentences(line).filter((sentence) =>
        !/JOTO\s*(?:是|作为).{0,24}腾讯云\s*ADP\s*CSP\s*授权服务商/i.test(sentence)
      ).join("");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const blocks = cleaned.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  for (const position of positions) {
    // The approved identity is a system-owned block. Never merge it into a
    // model-authored evidence sentence: doing so changes both its meaning and
    // the immutable fact-trace text after generation.
    const rendered = `在落地服务关系上，${fixedText}。`;
    if (position === "opening") {
      const titleIndex = blocks.findIndex((block) => /^#\s+/.test(block));
      const firstHeadingIndex = blocks.findIndex((block, index) => index > titleIndex && /^##\s+/.test(block));
      const openingParagraphIndex = blocks.findIndex((block, index) =>
        index > titleIndex && (firstHeadingIndex < 0 || index < firstHeadingIndex) && !/^#{1,6}\s+/.test(block)
      );
      if (openingParagraphIndex >= 0) blocks[openingParagraphIndex] = `${blocks[openingParagraphIndex]}${rendered}`;
      else blocks.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, rendered);
    } else if (position === "ending") {
      const linkIndex = blocks.findIndex((block) => /^\[[^\]]+]\(https?:\/\//i.test(block));
      blocks.splice(linkIndex >= 0 ? linkIndex : blocks.length, 0, rendered);
    } else {
      const lastHeading = blocks.map((block, index) => /^##\s+/.test(block) ? index : -1).filter((index) => index >= 0).at(-1);
      blocks.splice(lastHeading ?? blocks.length, 0, rendered);
    }
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function createFormalModelContract(contract: ProductionContractSnapshot) {
  const requiredCoreClaimIds = new Set([
    ...contract.validatorPolicy.requiredCoreClaimIds,
    ...(contract.faqPlan?.evidenceCandidates || []).map((item) => item.claimId)
  ]);
  const core = contract.evidencePack.evidenceItems.filter((item) =>
    item.claimIds.some((claimId) => requiredCoreClaimIds.has(claimId))
  );
  const limit = Math.min(7, Math.max(core.length + 1, 5));
  const selected: typeof contract.evidencePack.evidenceItems = [];
  const seen = new Set<string>();
  for (const item of [...core, ...contract.evidencePack.evidenceItems]) {
    if (seen.has(item.evidenceItemId)) continue;
    seen.add(item.evidenceItemId);
    selected.push(item);
    if (selected.length >= limit) break;
  }
  const mission = contract.geoMission;
  const graph = mission?.entityGraph;
  const fixedTexts = (contract.fixedExpressions || []).map((item) => item.text);
  const governedMissionText = (value: string) => value
    .split(/[；。\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((clause) => {
      const capabilityTerms = clause.match(/场景诊断|需求诊断|业务诊断|行业咨询|方案设计|垂直方案|方案封装|原型搭建|系统集成|系统接入|项目实施|部署交付|交付培训|持续运营|长期运营|后续支持|运营陪跑/g) || [];
      if (!capabilityTerms.length) return true;
      if (fixedTexts.some((text) => belongsToFixedExpression(clause, text))) return true;
      return contract.evidencePack.evidenceItems.some((item) => {
        const evidence = normalizeAssertion(`${item.summary} ${item.originalQuote}`);
        return capabilityTerms.every((term) => evidence.includes(normalizeAssertion(term)));
      });
    })
    .join("；");
  const governedMissionList = (values: string[], limit?: number) => values
    .map(governedMissionText)
    .filter(Boolean)
    .slice(0, limit);
  return {
    contractVersion: contract.contractVersion,
    contractHash: contract.contractHash,
    task: contract.task ? {
      title: contract.task.title,
      contentType: contract.task.contentType,
      channel: contract.task.channel,
      targetAudience: contract.task.targetAudience,
      coreProblem: contract.task.coreProblem,
      promotionGoal: contract.task.promotionGoal
    } : undefined,
    geoMission: mission ? {
      contractVersion: mission.contractVersion,
      missionId: mission.missionId,
      productId: mission.productId,
      platformEntityId: mission.platformEntityId,
      primaryEntityId: mission.primaryEntityId,
      promotionSubjectEntityId: mission.promotionSubjectEntityId,
      narrativeSubjectEntityId: mission.narrativeSubjectEntityId,
      narrativeSubjectName: mission.narrativeSubjectName,
      narrativeSubjectRole: mission.narrativeSubjectRole,
      promotionGoal: mission.promotionGoal,
      articleRole: mission.articleRole,
      primaryQuestion: mission.primaryQuestion,
      representativeQueries: mission.representativeQueries.slice(0, 4),
      currentSearchGap: mission.currentSearchGap,
      desiredAnswer: mission.desiredAnswer,
      desiredEntityAssociations: governedMissionList(mission.desiredEntityAssociations, 4),
      expectedAnswerSummary: governedMissionList(mission.expectedAnswerSummary, 4),
      titlePromiseDimensions: mission.titlePromiseDimensions,
      requiredClaimIds: mission.requiredClaimIds,
      entityGraph: graph ? {
        primaryEntityId: graph.primaryEntityId,
        nodes: graph.nodes.map((node) => ({ entityId: node.entityId, name: node.name, role: node.role })),
        relations: graph.relations.map((relation) => ({
          subjectEntityId: relation.subjectEntityId,
          predicate: relation.predicate,
          objectEntityId: relation.objectEntityId,
          canonicalStatement: governedMissionText(relation.canonicalStatement)
        })).filter((relation) => relation.canonicalStatement),
        canonicalRelationshipStatements: governedMissionList(graph.canonicalRelationshipStatements),
        forbiddenRelationshipStatements: graph.forbiddenRelationshipStatements
      } : undefined
    } : undefined,
    promotionSubjectPlan: contract.promotionSubjectPlan,
    faqPlan: contract.faqPlan,
    argumentPlan: contract.argumentPlan,
    evidencePack: {
      evidencePackId: contract.evidencePack.evidencePackId,
      decision: contract.evidencePack.decision,
      evidenceItems: selected.map((item) => ({
        evidenceItemId: item.evidenceItemId,
        claimIds: item.claimIds,
        primaryClaimId: item.primaryClaimId,
        sourceRevisionId: item.sourceRevisionId,
        evidenceUsage: item.evidenceUsage,
        subjectEntityIds: item.subjectEntityIds,
        summary: item.summary,
        allowedUsage: item.allowedUsage,
        conditions: item.conditions.filter((text) => item.originalQuote.includes(text)),
        limitations: item.limitations.filter((text) => item.originalQuote.includes(text)),
        lifecycleStatus: item.lifecycleStatus,
        status: item.status
      }))
    },
    contentTypeRule: contract.contentTypeRule ? {
      minLength: contract.contentTypeRule.minLength,
      maxLength: contract.contentTypeRule.maxLength,
      requiredSections: contract.contentTypeRule.requiredSections,
      requiredArtifacts: contract.contentTypeRule.requiredArtifacts,
      argumentOrder: contract.contentTypeRule.argumentOrder
    } : undefined,
    channelRule: contract.channelRule ? {
      channel: contract.channelRule.channel,
      minLength: contract.channelRule.minLength,
      maxLength: contract.channelRule.maxLength,
      requiredSections: contract.channelRule.requiredSections,
      requiredArtifacts: contract.channelRule.requiredArtifacts,
      prohibitedTerms: contract.channelRule.prohibitedTerms.slice(0, 20)
    } : undefined,
    expressionRule: contract.expressionRule ? {
      prohibitedTerms: contract.expressionRule.prohibitedTerms.slice(0, 20),
      humanizerDirectives: contract.expressionRule.humanizerDirectives.slice(0, 8),
      calibrationDirectives: contract.expressionRule.calibrationDirectives?.slice(0, 12)
    } : undefined,
    validatorPolicy: {
      requiredCoreClaimIds: contract.validatorPolicy.requiredCoreClaimIds,
      entityIdentity: {
        productId: contract.validatorPolicy.entityIdentity.productId,
        canonicalName: contract.validatorPolicy.entityIdentity.canonicalName,
        displayName: contract.validatorPolicy.entityIdentity.displayName,
        aliases: contract.validatorPolicy.entityIdentity.aliases
      },
      prohibitedTerms: (contract.validatorPolicy.prohibitedTerms || []).slice(0, 30),
      requiredSections: contract.validatorPolicy.requiredSections,
      requiredArtifacts: contract.validatorPolicy.requiredArtifacts,
      minLength: contract.validatorPolicy.minLength,
      maxLength: contract.validatorPolicy.maxLength
    },
    promptDirectives: contract.promptDirectives.filter((text) => !/所有条件和限制必须进入正文/.test(text)).slice(0, 12)
  };
}

function ensureTerminalPunctuation(value: string) {
  const trimmed = value.trim();
  return /[。！？；，.!?;:]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function requiredTracePlan(contract: ReturnType<typeof createFormalModelContract>) {
  return contract.validatorPolicy.requiredCoreClaimIds.flatMap((claimId) => {
    const item = contract.evidencePack.evidenceItems.find((candidate) => candidate.claimIds.includes(claimId));
    if (!item) return [];
    return [{
      sentence: ensureTerminalPunctuation(item.summary.replace(/[。！？；，.!?;:]$/, "")),
      evidenceItemId: item.evidenceItemId,
      claimId,
      sourceRevisionId: item.sourceRevisionId,
      conditions: item.conditions,
      limitations: item.limitations
    }];
  });
}

export function ensureRequiredCoreClaimEvidence(
  output: FormalProviderOutput,
  evidenceItems: RagEvidenceItem[],
  requiredCoreClaimIds: string[]
) {
  // 核心 Claim 缺失时只能触发模型重写相关论证段，不能把证据原句
  // 确定性塞回正文。这里仅为正文中已经自然存在的事实补齐追溯记录。
  return reconcileCoreClaimTraces(output, evidenceItems, requiredCoreClaimIds);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function placeStrategyCta(markdown: string, ctaPlan: ProductionContractSnapshot["ctaPlan"]) {
  let value = markdown.trim();
  for (const cta of ctaPlan.selectedVariants) {
    const exactLink = new RegExp(`^\\s*\\[${escapeRegExp(cta.label)}\\]\\(${escapeRegExp(cta.publicUrl)}\\)\\s*$`, "gmu");
    value = value.replace(exactLink, "");
    value = value.split(/\n{2,}/)
      .filter((block) => !block.includes(cta.publicUrl) && block.trim() !== cta.label)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // CTA wording is owned by the approved strategy. Remove any model-written
    // duplicate before appending the one governed rendering at the end.
    value = value.replaceAll(cta.label, "").replaceAll(cta.publicUrl, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const rendered = cta.renderMode === "markdown_link" ? `[${cta.label}](${cta.publicUrl})` : `${cta.label} ${cta.publicUrl}`;
    value = `${value}\n\n${rendered}`;
  }
  return value.trim();
}

export function ensureFrozenTitle(markdown: string, title: string) {
  const lines = markdown.split(/\r?\n/);
  const firstH1 = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  if (firstH1 >= 0) lines[firstH1] = `# ${title}`;
  else lines.unshift(`# ${title}`, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeMarkdownBlockSpacing(markdown: string) {
  return markdown.trim()
    .replace(/([^\n])\n(#{1,6}\s+)/g, "$1\n\n$2")
    .replace(/^(#{1,6}\s+[^\n]+)\n(?!\n)/gm, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function deterministicWritingBlockers(markdown: string, title: string, entityName: string) {
  const blockers: string[] = [];
  const headings = markdown.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^#{1,6}\s+/.test(line));
  if ([title, ...headings.map((line) => line.replace(/^#{1,6}\s+/, ""))].some((text) => /[。.]/.test(text))) {
    blockers.push("标题和小标题不得使用句号。");
  }
  if (headings.some((line) => /[，,；;：:、]$/.test(line) || (line.match(/[？?]/g) || []).length > 1)) {
    blockers.push("标题或小标题存在结尾标点或问号数量异常。");
  }
  const paragraphs = markdown.split(/\n{2,}/).map((item) => item.trim()).filter((item) => item && !/^#{1,6}\s+/.test(item));
  const naturalOpening = paragraphs.find((item) => !/^\[[^\]]+]\(https?:\/\//.test(item)) || "";
  if (/(?:围绕[“\"].+?[”\"]，?下文按|本文将(?:介绍|分析|讨论)|接下来(?:我们)?(?:分析|介绍))/i.test(naturalOpening)) {
    blockers.push("开头包含面向写作者的元叙事，必须直接回答读者问题。");
  }
  const firstEntityIndex = markdown.indexOf(entityName);
  const firstPronoun = markdown.search(/(?:^|\n\n)(?:它|该平台|这一产品|其)(?:[，,。\s])/m);
  if (firstPronoun >= 0 && (firstEntityIndex < 0 || firstPronoun < firstEntityIndex)) blockers.push("目标产品首次出现前使用了指代词。");
  if (/(?:这|那|其|这也)?意味着[：:]?[。！？!?]|(?:因此|所以|同时|此外)[，,]?[。！？!?]/.test(markdown)) {
    blockers.push("正文包含残句或只有连接词的句子。");
  }
  if (/(?:行业报告显示|专家认为|业内人士认为|官方可查|广泛认为)/.test(markdown)) {
    blockers.push("正文包含没有明确来源的模糊归因。");
  }
  const formulaicCount = (markdown.match(/(?:其核心价值在于|共同构成|形成完整闭环|不仅[^。！？]{0,40}(?:而且|还)|不是[^。！？]{0,40}而是)/g) || []).length;
  if (formulaicCount >= 3) blockers.push(`正文公式化营销句式过于密集：命中 ${formulaicCount} 处。`);
  return blockers;
}

function isFactSentence(sentence: string) {
  const normalized = sentence.trim();
  return normalized.length >= 12 && /[。！？；：.!?;:]$/.test(normalized);
}

export function validateFormalProviderOutput(input: {
  contract?: ProductionContractSnapshot;
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
  ctaPlan?: ProductionContractSnapshot["ctaPlan"];
}): HardRuleResult {
  const blockers: string[] = [];
  const markdown = input.output.markdown;
  if (!markdown) blockers.push("正文为空。");
  if (!markdown.startsWith(`# ${input.title}`)) blockers.push("正文必须以冻结标题作为一级标题。");
  const emptySections = markdown.split(/^##\s+\S+.*$/gm).slice(1).filter((section) => !section.trim());
  if (emptySections.length) blockers.push(`正文包含 ${emptySections.length} 个空章节。`);
  blockers.push(...deterministicWritingBlockers(markdown, input.title, input.entityIdentity.displayName || input.entityIdentity.canonicalName));
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
  const untracedFacts = factualLines(markdown).filter(isProductClaimLine).filter((sentence) => !fixedTexts.some((text) => belongsToFixedExpression(sentence, text))
    && !validTraces.some((trace) => {
      const item = evidenceById.get(trace.evidenceItemId);
      return sentence === trace.sentence || Boolean(item && sentenceMatchesEvidence(sentence, item));
    }));
  if (untracedFacts.length) {
    const previews = untracedFacts.slice(0, 5).map((sentence) => sentence.length > 120 ? `${sentence.slice(0, 117)}…` : sentence);
    blockers.push(`正文包含 ${untracedFacts.length} 条没有 Claim 追溯的事实句，请删除无证据主张或改写为 EvidenceItem 可支持的原义表达：${previews.join("｜")}`);
  }
  const unsupportedQuantitativeRows = markdownTableDataRows(markdown).filter((row) => {
    const tokens = quantitativeTokens(row);
    if (!tokens.length) return false;
    return !validTraces.some((trace) => {
      const item = evidenceById.get(trace.evidenceItemId);
      if (!item || !sentenceMatchesEvidence(row, item)) return false;
      const corpus = `${item.normalizedClaim} ${item.summary} ${item.originalQuote}`;
      return tokens.every((token) => corpus.includes(token));
    });
  });
  if (unsupportedQuantitativeRows.length) {
    blockers.push(`表格包含没有逐项证据支持的数字或效果数据：${unsupportedQuantitativeRows.slice(0, 3).join("｜")}。`);
  }
  blockers.push(...entityRelationshipBlockers(markdown, input.entityIdentity));
  if (input.contract) {
    const promotionCoverage = analyzePromotionSubjectCoverage(markdown, input.contract);
    if (promotionCoverage.blockers.includes("promotion_subject_missing")
      || promotionCoverage.blockers.includes("promotion_subject_body_mentions_insufficient")
      || promotionCoverage.blockers.includes("promotion_subject_opening_missing")) {
      blockers.push(`正文没有把 ${promotionCoverage.narrativeSubjectName} 作为持续叙事主体，不能只依赖固定身份文案或 CTA。`);
    }
    if (promotionCoverage.blockers.includes("promotion_subject_section_coverage")) {
      blockers.push(`核心章节中的推广主体执行动作覆盖不足：${promotionCoverage.coveredCoreSectionCount}/${promotionCoverage.coreSectionCount}；缺少章节：${promotionCoverage.uncoveredCoreSectionHeadings.join("、") || "未识别到有效核心章节"}。`);
    }
    if (promotionCoverage.blockers.includes("service_capability_coverage")) {
      blockers.push(`正文至少需要自然覆盖两类有 Claim 支撑的交付能力；当前为：${promotionCapabilityLabels(promotionCoverage.distinctCapabilityCategories).join("、") || "无"}。`);
    }
    if (promotionCoverage.blockers.includes("role_responsibility_unclear")) {
      blockers.push("正文没有清楚区分腾讯云 ADP 的平台底座职责与 JOTO 的实施交付职责。");
    }
    const faqCoverage = analyzeGovernedFaqCoverage({ markdown, contract: input.contract, validTraces });
    if (input.contract.faqPlan.required && !faqCoverage.sectionFound) {
      blockers.push("GEO 正式文章缺少“## 常见问题”章节。");
    }
    if (faqCoverage.sectionFound && (faqCoverage.itemCount < input.contract.faqPlan.minimumItems
      || faqCoverage.itemCount > input.contract.faqPlan.maximumItems)) {
      blockers.push(`FAQ 数量必须为 ${input.contract.faqPlan.minimumItems}-${input.contract.faqPlan.maximumItems} 个，当前为 ${faqCoverage.itemCount} 个。`);
    }
    if (faqCoverage.sectionFound && !faqCoverage.items.length) {
      blockers.push("FAQ 必须使用“### Q：问题”与“A：回答”的完整问答格式。");
    }
    if (faqCoverage.untracedQuestions.length) {
      blockers.push(`FAQ 答案没有使用FAQ计划允许的知识库Claim：${faqCoverage.untracedQuestions.join("、")}。`);
    }
    if (faqCoverage.misalignedQuestions.length) {
      blockers.push(`FAQ 问题与文章主题或知识库答案不一致：${faqCoverage.misalignedQuestions.join("、")}。`);
    }
    if (faqCoverage.duplicateQuestions.length) {
      blockers.push(`FAQ 包含重复问题：${faqCoverage.duplicateQuestions.join("、")}。`);
    }
    if (faqCoverage.sectionFound && !faqCoverage.positionedBeforeCta) {
      blockers.push("常见问题必须是最后一个正文二级章节，并位于冻结CTA之前。");
    }
  }
  const sentenceCounts = new Map<string, number>();
  for (const sentence of proseSentences(markdown)) {
    if (fixedTexts.some((text) => belongsToFixedExpression(sentence, text))) continue;
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
    if (text.length >= 4 && containsBlockedAssertion(markdown, text)) {
      blockers.push(`正文命中禁止表达：${text}`);
    }
  }
  for (const rule of input.fixedExpressions || []) {
    const occurrences = markdown.split(rule.text).length - 1;
    if (occurrences !== rule.positions.length) {
      blockers.push(`固定文案必须逐字出现 ${rule.positions.length} 次，当前为 ${occurrences} 次。`);
      continue;
    }
    const blocks = markdown.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
    const titleIndex = blocks.findIndex((item) => /^#\s+/.test(item));
    const firstHeadingIndex = blocks.findIndex((item) => /^##\s+/.test(item));
    const lastHeadingIndex = blocks.map((item, index) => /^##\s+/.test(item) ? index : -1).filter((index) => index >= 0).at(-1) ?? -1;
    const expressionIndexes = blocks.map((item, index) => item.includes(rule.text) ? index : -1).filter((index) => index >= 0);
    const zones = {
      opening: expressionIndexes.some((index) => index > titleIndex && (firstHeadingIndex < 0 || index < firstHeadingIndex)),
      body: expressionIndexes.some((index) => firstHeadingIndex >= 0 && index > firstHeadingIndex && (lastHeadingIndex < 0 || index <= lastHeadingIndex)),
      ending: expressionIndexes.some((index) => lastHeadingIndex >= 0 && index > lastHeadingIndex)
    };
    for (const position of rule.positions) {
      if (!zones[position]) blockers.push(`固定文案未逐字出现在指定位置：${position}。`);
    }
  }
  for (const cta of input.ctaPlan?.selectedVariants || []) {
    const labelCount = markdown.split(cta.label).length - 1;
    const urlCount = markdown.split(cta.publicUrl).length - 1;
    if (labelCount !== 1 || urlCount !== 1) blockers.push(`冻结 CTA 必须逐字出现一次：${cta.ctaVariantId}。`);
    const lastBlock = markdown.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).at(-1) || "";
    if (!lastBlock.includes(cta.publicUrl)) blockers.push("冻结 CTA 必须位于正文最后一个内容块。");
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

export function shouldBlockProviderPreflight(result: { ok: boolean; status?: string; errorMessage?: string }) {
  if (result.ok) return false;
  if (result.status === "pending_config") return true;
  return isNonRetryableProviderError(result.errorMessage || "");
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
  const pipelineDiagnostic = evaluateBusinessChainRubric({ contract: input.contract, pack: input.pack });
  if (pipelineDiagnostic.verdict !== "passed") {
    throw new FormalGenerationError(
      422,
      "business_chain_rubric_blocked",
      "正式生成前的业务链路诊断未通过，系统不会把不完整的 GEO 上下文交给模型。",
      "根据诊断结果返回最早出错阶段修复，然后重新生成任务与 EvidencePack。",
      pipelineDiagnostic.hardBlockers.length ? pipelineDiagnostic.hardBlockers : pipelineDiagnostic.dimensions.filter((item) => item.score < 80).map((item) => `${item.key}=${item.score}`)
    );
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
  if (shouldBlockProviderPreflight(preflight)) {
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
    + (input.contract.fixedExpressions || []).reduce((total, item) => total + item.positions.length, 0)
    + input.contract.faqPlan.evidenceCandidates.length + (input.contract.faqPlan.required ? 4 : 0);
  const systemPrompt = "你是一名面向企业决策者的中文内容作者。你的首要任务是写出自然、连贯、让真实读者愿意读下去的文章，同时严格遵守已冻结的事实合同。产品能力、身份、认证、数字和适用边界只能来自 EvidenceItem；普通的场景解释、判断过程和段落过渡可以自然表达，但不得把常识扩展成新的产品事实。不得虚构案例、客户、数据、亲历或引语。核心 Claim 可以保持原义自然改写，不得把证据逐条抄成清单。严禁把原始摘录、EvidenceItem、Claim ID、审计 JSON 或模型说明展示给读者。输出必须是单个 JSON 对象，字段仅包含 markdown 和 factTraces；factTraces 仅含 sentence、evidenceItemId、claimId、sourceRevisionId。";
  const modelContract = createFormalModelContract(input.contract);
  const tracePlan = requiredTracePlan(modelContract);
  const userPrompt = `请依据以下冻结的 ProductionContractSnapshot 生成视图写作：\n${JSON.stringify(modelContract)}\n\ngeoMission 是本文唯一 GEO 推广任务：文章必须直接回答 primaryQuestion，针对 currentSearchGap 给出 desiredAnswer，并自然建立 desiredEntityAssociations。platformEntityId/primaryEntityId 是产品事实归属的平台实体；promotionSubjectEntityId/narrativeSubjectEntityId 才是全文要推广、解释和反复承接论证的主体。搜索结果与相关文章只用于理解用户问题、搜索环境和内容空白；除非 EvidenceItem.evidenceUsage=product_fact 且主体命中 platformEntityId，否则不得陈述为平台或服务事实。entityGraph 是产品、品牌方、服务商及相关实体关系的唯一权威定义。\n\npromotionSubjectPlan 是推广主体写作合同。enabled=true 时，不能写成“平台产品说明 + 首段身份落款 + 结尾 CTA”。去掉系统稍后插入的固定身份句和 CTA 后，正文仍必须让读者明确看出：推广主体是谁、它基于平台底座执行哪些可验证动作、这些动作如何解决当前问题。正文至少自然覆盖 minimumServiceCapabilityCategories 类 serviceCapabilityClaims；不得把主体名称当关键词机械重复，也不得把没有 Claim 的服务动作写成事实。系统会逐字插入 identityStatement 对应的人工确认身份句，模型不要复述或改写该身份句，但这不等于省略推广主体：必须在自然正文中持续以 narrativeSubjectName 为陈述重点。\n\nfaqPlan 是FAQ治理合同。required=true 时必须生成“## 常见问题”，并把它作为最后一个正文二级章节、放在系统CTA之前。问题可以依据用户搜索意图和 evidenceCandidates 模拟真实问法，但不能暗示这些问题来自真实访谈或统计。使用“### Q：问题”和“A：回答”的完整格式，生成 minimumItems 至 maximumItems 个不重复问题。每个回答先用一句话直接回答问题，再用对应 EvidenceItem 的事实说明依据；至少包含一句由对应 evidenceItemId、claimId、sourceRevisionId 追溯的事实。模型只能改写问法，不能模拟事实。若 promotionGoal=geo_provider_selection，至少一个问题必须直接帮助读者选择、核对、判断或比较服务商，不能把FAQ全部写成“有哪些功能”的正文复述。知识库无法回答的价格、周期、ROI、客户案例、官方认证、资质效力或服务边界不得进入FAQ。\n\nargumentPlan 是写作前已经冻结的论证计划。必须按 causalChain 推进，但不要把 sectionQuestion、because 或 transitionToNext 原样抄进正文。每个核心章节都必须完成“用户问题或判断 → 平台底座如何支撑 → 推广主体具体执行什么 → 这对企业决策意味着什么”的因果闭环，并在段尾自然引出下一节；如果一条事实不能解释中心判断，就不要为了覆盖证据而孤立插入。promotionSubjectSectionRequirement.requiredInEveryCoreSection=true 时，完成草稿后必须在内部逐一枚举所有二级标题（FAQ除外）自检：每个章节正文都要逐字出现 narrativeSubjectName，并包含 eligibleActionClaimIds 支撑的诊断咨询、方案设计、系统集成、实施交付或持续运营动作之一，随后明确说明这对读者选择、核对或采用意味着什么。表格列名、章节标题、代词“服务商”和固定身份句都不能替代这条正文句。\n\n以下 tracePlan 是当前选题必须覆盖的核心事实。请保持事实含义不变，用适合上下文的自然中文表达；不要逐字抄写，不要把它们集中成“事实清单”。conditions、limitations 是系统内部治理字段，只用于避免扩大产品能力；除非对应 originalQuote 本身逐字包含该表述，否则不得在正文中增加“适用条件”“限制条件”“前提是”等说明，更不得把字段内容机械拼接为新句子。正文中实际承载产品或服务事实的完整句子必须写入 factTraces，并原样复制对应的 evidenceItemId、claimId、sourceRevisionId：\n${JSON.stringify(tracePlan)}\n\n正文必须以“# ${title}”开头。标题和所有小标题不得出现句号，不要混用问号、冒号等标点。首段直接进入 geoMission.primaryQuestion，并以 narrativeSubjectName 的服务判断承接题目；不从缩写歧义、宽泛行业背景、无关痛点或“本文将介绍/下文按…展开”等元叙事开始。正文必须覆盖 titlePromiseDimensions 的全部承诺，并让读者能从前半部分提取 expectedAnswerSummary 对应的明确答案。围绕一个清晰的读者问题形成连续主线，先给出与题目直接相关的判断，再解释为什么、用什么证据成立，以及这对采用决策意味着什么。文章类型中的结构模块是写作参考，不是必须逐项填满的目录；除FAQ外，根据内容自然使用 3 至 6 个核心二级标题。篇幅遵循合同的 minLength 与 maxLength，不为凑字数加入空泛管理建议。若规则要求表格，表格只能整理现有Claim；数字、百分比、时间、数量、案例效果和责任边界必须逐项有证据，不得为填满“典型成效”或“不负责内容”列而补写。证据不足时删除对应列，保留能力、场景或项目待确认项。正文中的事实必须绑定 EvidenceItem 和 Claim，并覆盖 tracePlan 中的核心 Claim；非事实性的解释负责连接事实、说明它们对判断和行动的意义。没有正式证据时不要写案例、效果数据、ROI、价格或竞品结论。避免模板化开场、口号、模糊归因、机械三段式、连续同句式、过度连接词、同义反复、残句和说明书语气。CTA 由系统按人工确认版本装配，模型无需自行添加。`;
  const sectionRequirement = input.contract.argumentPlan.promotionSubjectSectionRequirement;
  const argumentPlanRequirement = sectionRequirement
    ? `argumentPlan.sections 中的每一项都必须落实为一个核心二级章节；章节标题可以自然改写，但不得合并或省略。逐章使用“${sectionRequirement.narrativeSubjectName} + 可验证执行动作 + 对企业判断的意义”的完整句，动作只能来自这些 Claim：${sectionRequirement.eligibleActionClaimIds.join("、")}。`
    : "argumentPlan.sections 中的每一项都必须落实为一个核心二级章节；章节标题可以自然改写，但不得合并或省略。";
  const initialUserPrompt = `${userPrompt}\n\n${argumentPlanRequirement}`;
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
    geoMission: input.contract.geoMission,
    argumentPlan: input.contract.argumentPlan,
    writingDirection: [
      "围绕一个读者问题形成连续主线，不按证据逐条展开。",
      `${input.contract.promotionSubjectPlan.narrativeSubjectName}是叙事主体，平台产品是搜索入口与能力底座。`,
      "从真实决策困境进入，说明平台底座、服务商执行动作、采用路径和人工判断边界。",
      "结构模块是参考，不是固定目录；没有证据时不补写案例或效果数据。",
      "文章最后必须包含有知识库Claim支撑的常见问题，AI只模拟自然问法。"
    ],
    coreFacts: tracePlan.map((item) => item.sentence),
    entityIdentity: input.contract.validatorPolicy.entityIdentity,
    fixedExpressions: input.contract.fixedExpressions,
    factualRules: [
      "正文中的产品事实都能关联到知识库 Claim。",
      "当前选题的核心 Claim 已覆盖。",
      "产品身份和实体关系正确。",
      "去除固定身份文案和 CTA 后，推广主体仍贯穿核心章节且至少覆盖两类交付能力。",
      "固定文案按指定位置逐字出现。"
    ],
    userRevisionRequirements: (input.contract.expressionRule.calibrationDirectives || [])
      .filter((item) => item.startsWith("用户对上一版样文的修改要求："))
  };
  await recordGenerationPromptSnapshot({ generationRunId, systemPrompt, userPrompt: initialUserPrompt, brief });
  let technicalRetryCount = 0;
  let automaticRepairCount = 0;
  let lastBlockers: string[] = [];
  let lastTraceableFactCount = 0;
  let lastPipelineDiagnostic = pipelineDiagnostic;
  let lastArticleQuality: HardRuleResult["articleQuality"];
  let lastModel: string | undefined;
  let repairPrompt = initialUserPrompt;
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
      output = reconcileEvidenceFactTraces(
        output,
        input.pack.evidenceItems,
        (input.contract.fixedExpressions || []).map((item) => item.text)
      );
      const fixedTexts = (input.contract.fixedExpressions || []).map((item) => item.text);
      output = { ...output, markdown: placeFixedExpressions(output.markdown, input.contract.fixedExpressions) };
      // Fixed-expression assembly can merge or insert prose after the first
      // cleanup pass. Run one final deterministic normalization and evidence
      // cleanup so duplicate or untraced product assertions cannot escape.
      output = repairFormalOutputLocally(output, fixedTexts);
      output = reconcileEvidenceFactTraces(
        output,
        input.pack.evidenceItems,
        (input.contract.fixedExpressions || []).map((item) => item.text)
      );
      output = repairFormalOutputLocally(output, fixedTexts);
      output = reconcileCoreClaimTraces(
        output,
        input.pack.evidenceItems,
        input.contract.validatorPolicy.requiredCoreClaimIds
      );
      const finalCleaned = removeUnsupportedFormalPassages(
        output,
        input.pack.evidenceItems,
        (input.contract.fixedExpressions || []).map((item) => item.text)
      );
      if (finalCleaned.removedCount) automaticRepairCount += 1;
      output = {
        ...finalCleaned.output,
        markdown: placeStrategyCta(
          placeGovernedFaqBeforeCta(
            placeFixedExpressions(
              normalizeMarkdownBlockSpacing(ensureFrozenTitle(removeEmptyMarkdownSections(finalCleaned.output.markdown), title)),
              input.contract.fixedExpressions
            ),
            input.contract.faqPlan
          ),
          input.contract.ctaPlan
        )
      };
      // Final system assembly is allowed to move only identity/CTA blocks.
      // Reconcile traces once more against the final immutable markdown so the
      // validator never evaluates stale pre-assembly sentence references.
      output = reconcileGovernedFaqFactTraces(
        reconcileEvidenceFactTraces(
          reconcileCoreClaimTraces({
            ...output,
            factTraces: output.factTraces.filter((trace) => output!.markdown.includes(trace.sentence))
          }, input.pack.evidenceItems, input.contract.validatorPolicy.requiredCoreClaimIds),
          input.pack.evidenceItems,
          (input.contract.fixedExpressions || []).map((item) => item.text)
        ),
        input.contract,
        input.pack.evidenceItems
      );
    }
    await recordSingleArticleProgress({ operationId: input.operationId, progressStage: "quality_validation" });
    const validated = output
      ? validateFormalProviderOutput({
          contract: input.contract,
          output,
          title,
          channel: input.contract.task.channel,
          evidenceItems: input.pack.evidenceItems,
          blockedRuleTexts: [...blockedExpressions, ...prohibitedPatterns],
          requiredFormatTexts: requiredFormat,
          checkedRuleCount,
          requiredCoreClaimIds: input.contract.validatorPolicy.requiredCoreClaimIds,
          entityIdentity: input.contract.validatorPolicy.entityIdentity,
          fixedExpressions: input.contract.fixedExpressions,
          ctaPlan: input.contract.ctaPlan
        })
      : { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: 0 };
    let semanticJudge;
    if (output && validated.passed) {
      const judge = await callAiProvider({
        provider,
        systemPrompt: "你是独立的 GEO 文章质量评测员，只按冻结任务评估文章，不补充事实，严格返回 JSON。",
        userPrompt: buildArticleSemanticJudgePrompt(input.contract, output.markdown),
        temperature: 0,
        maxTokens: 1200,
        timeoutMs: Math.min(60_000, Math.max(10_000, generationDeadlineAt - Date.now()))
      });
      providerCallCount += 1;
      providerDurationMs += judge.metrics.durationMs;
      providerInputTokens += judge.metrics.inputTokens || 0;
      providerOutputTokens += judge.metrics.outputTokens || 0;
      if (judge.ok && judge.content) {
        try { semanticJudge = parseArticleSemanticJudge(judge.content); } catch { semanticJudge = undefined; }
      }
    }
    const articleQuality = output
      ? evaluateArticleQualityRubric({ contract: input.contract, markdown: output.markdown, traceableFactCount: validated.traceableFactCount, semanticJudge })
      : undefined;
    const qualityBlockers = validated.passed && articleQuality && articleQuality.verdict !== "accepted"
      ? [...articleQuality.hardBlockers, ...articleQuality.dimensions.filter((item) => item.score < 80).map((item) => `${item.key}=${item.score}`)]
      : [];
    const hardRuleResult: HardRuleResult = {
      ...validated,
      passed: validated.passed && articleQuality?.verdict === "accepted",
      blockers: Array.from(new Set([...validated.blockers, ...qualityBlockers])),
      checkedRuleCount: validated.checkedRuleCount + (articleQuality?.dimensions.length || 0) + pipelineDiagnostic.dimensions.length,
      pipelineDiagnostic,
      articleQuality,
      technicalRetryCount,
      automaticRepairCount,
      providerCallCount,
      providerDurationMs,
      providerInputTokens,
      providerOutputTokens
    };
    lastPipelineDiagnostic = pipelineDiagnostic;
    lastArticleQuality = articleQuality;
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
      const promotionCoverage = output ? analyzePromotionSubjectCoverage(output.markdown, input.contract) : undefined;
      const promotionActionEvidence = input.contract.promotionSubjectPlan.enabled
        ? input.contract.promotionSubjectPlan.serviceCapabilityClaims.flatMap((capability) => {
            const evidence = input.pack.evidenceItems.find((item) => item.claimIds.includes(capability.claimId));
            return evidence ? [`${capability.category}：${evidence.summary}`] : [];
          }).join("；")
        : "";
      const promotionRepairHint = promotionCoverage?.blockers.length
        ? `\n推广主体专项修复：必须在首段以及这些未覆盖章节的正文中直接写出 ${promotionCoverage.narrativeSubjectName}，并紧邻知识库已支持的诊断咨询、方案设计、系统集成、实施交付或持续运营动作，再说明该动作对企业判断的意义；不能只在结论补一句。未覆盖章节：${promotionCoverage.uncoveredCoreSectionHeadings.join("、") || "首段或核心章节"}。逐章修复格式必须是“${promotionCoverage.narrativeSubjectName} + 下列证据支持的具体执行动作 + 因而对企业核对或采用意味着什么”，三部分写在同一自然论证段中。可用动作证据：${promotionActionEvidence || "以 promotionSubjectPlan.serviceCapabilityClaims 和 tracePlan 为准"}。`
        : "";
      const faqRepairHint = lastBlockers.some((item) => /faq/i.test(item))
        ? `\nFAQ专项修复：只使用 faqPlan.evidenceCandidates 中的证据，把问题改成读者可直接搜索的自然问法；每个回答先明确作答，再给一条可追溯事实。若本文是服务商选型，至少一个问题必须直接帮助选择、核对、判断或比较，并回答“应看什么以及为什么”，不能只把正文能力换一种说法。`
        : "";
      repairPrompt = `${initialUserPrompt}\n\n系统自动检查发现以下可修复问题：\n${lastBlockers.join("\n")}${promotionRepairHint}${faqRepairHint}\n请对照 argumentPlan 只重写发生问题的论证段和相邻过渡，再返回完整 JSON。不得把 EvidenceItem 原句机械追加到段尾；缺失 Claim 必须融入承担相应论证功能的章节，并解释它与中心判断的因果关系。不要增加任何新事实，不要改变冻结标题和证据绑定。`;
    }
  }

  const hardRuleFailure = failure("hard_rule_blocked", "正文在同一生产合同下完成一次受限修复后仍未通过，系统不会继续改写。", "请在异常中心查看具体规则；如需调整表达，请提交样稿反馈生成新的校准版本。");
  const finalRuleResult: HardRuleResult = { passed: false, blockers: lastBlockers, checkedRuleCount, traceableFactCount: lastTraceableFactCount, pipelineDiagnostic: lastPipelineDiagnostic, articleQuality: lastArticleQuality, technicalRetryCount, automaticRepairCount, providerCallCount, providerDurationMs, providerInputTokens, providerOutputTokens };
  await failFormalGenerationRun({ operationId: input.operationId, generationRunId, status: "failed", failure: hardRuleFailure, hardRuleResult: finalRuleResult, actor: input.actor });
  throw new FormalGenerationError(422, hardRuleFailure.code, hardRuleFailure.message, hardRuleFailure.nextAction, lastBlockers, true);
}
