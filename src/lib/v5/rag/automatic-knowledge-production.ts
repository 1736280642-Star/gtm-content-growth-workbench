import { createHash, randomUUID } from "node:crypto";
import type { V5AuthorityLevel, V5SourceLocator } from "../knowledge-governance-contracts";

export const AUTOMATIC_KNOWLEDGE_POLICY_VERSION = "automatic-knowledge-policy@6";
export const AUTOMATIC_CLAIM_EXTRACTOR_VERSION = "automatic-markdown-claim-extractor@4";

export interface AutomaticKnowledgeDocument {
  sourceId: string;
  productId: string;
  productName: string;
  knowledgeBaseId: string;
  title: string;
  markdown: string;
  authorityLevel: V5AuthorityLevel;
  sourceUpdatedAt: string;
  documentType: string;
  canonicalUrl?: string;
}

export interface AutomaticSourceRevision {
  sourceRevisionId: string;
  sourceId: string;
  revisionNumber: number;
  contentHash: string;
  sourceUpdatedAt: string;
  title: string;
  supersedesRevisionId?: string;
}

export type AutomaticClaimStatus = "supported" | "conditional" | "superseded" | "disputed" | "rejected";

export interface AutomaticKnowledgeClaim {
  claimId: string;
  productId: string;
  subjectKey: string;
  semanticValue: string;
  normalizedClaim: string;
  originalQuote: string;
  sourceId: string;
  sourceRevisionId: string;
  sourceLocator: V5SourceLocator;
  authorityLevel: V5AuthorityLevel;
  sourceUpdatedAt: string;
  conditions: string[];
  limitations: string[];
  status: AutomaticClaimStatus;
  conflictGroupId?: string;
  supersedesClaimId?: string;
}

export interface AutomaticIndexSnapshot {
  indexSnapshotId: string;
  sourceSnapshotHash: string;
  sourceRevisionIds: string[];
  claimIds: string[];
  vectors: Record<string, number[]>;
  status: "active";
  createdAt: string;
}

export interface AutomaticEvidenceItem {
  evidenceItemId: string;
  claimId: string;
  normalizedClaim: string;
  originalQuote: string;
  sourceId: string;
  sourceRevisionId: string;
  sourceLocator: V5SourceLocator;
  conditions: string[];
  limitations: string[];
}

export interface AutomaticEvidencePack {
  evidencePackId: string;
  taskId: string;
  taskVersion: number;
  indexSnapshotId: string;
  sourceSnapshotHash: string;
  evidenceItems: AutomaticEvidenceItem[];
  forbiddenClaimIds: string[];
  unresolvedConflictIds: string[];
  status: "active" | "invalidated";
  invalidatedAt?: string;
  invalidationReason?: string;
  createdAt: string;
}

export interface AutomaticContentTask {
  taskId: string;
  taskVersion: number;
  productId: string;
  title: string;
  query: string;
  status: "waiting_for_knowledge" | "ready_for_generation" | "generated" | "blocked";
}

export interface AutomaticModelPassage {
  text: string;
  claimId?: string;
}

export interface AutomaticModelDraft {
  title: string;
  passages: AutomaticModelPassage[];
}

export interface AutomaticFactTrace {
  sentence: string;
  evidenceItemId: string;
  claimId: string;
  sourceRevisionId: string;
  sourceLocator: V5SourceLocator;
  originalQuote: string;
}

export interface AutomaticDraft {
  taskId: string;
  taskVersion: number;
  evidencePackId: string;
  markdown: string;
  factTraces: AutomaticFactTrace[];
  removedPassages: Array<{ text: string; reason: string }>;
  createdAt: string;
}

export interface AutomaticGenerationAdapter {
  generate(input: { task: AutomaticContentTask; evidencePack: AutomaticEvidencePack }): Promise<AutomaticModelDraft>;
}

interface MarkdownUnit {
  text: string;
  originalQuote: string;
  subjectHint?: string;
  headingPath: string[];
  paragraphIndex: number;
  characterRange: [number, number];
}

const authorityRank: Record<V5AuthorityLevel, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
  D: 7,
  E: 8
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function normalizeText(value: string) {
  return value
    .replace(/[`*_>#|\[\]（）()“”‘’'"：:，,。.!！?？；;、\s-]+/g, "")
    .toLocaleLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function claimDisplayText(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claimNoiseReasons(unit: MarkdownUnit, document: Pick<AutomaticKnowledgeDocument, "productName">) {
  const text = unit.text.trim();
  const display = claimDisplayText(text);
  const links = [...text.matchAll(/\[[^\]]*\]\(https?:\/\/[^)]+\)/gi)];
  const outsideLinks = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]+\]\([^)]*\)/g, "")
    .replace(/[`*_>#|]/g, "")
    .trim();
  const hasChinesePredicate = /(支持|提供|用于|能够|可以|采用|包含|覆盖|允许|需要|限制|适用|实现|帮助|接入|管理|生成|保持|具备|完成|建立|沉淀|规划|配置|执行|交付|优化|保障|连接|部署|运行|使用|服务)/.test(display);
  const hasEnglishPredicate = /\b(?:is|are|was|were|has|have|had|support(?:s|ed|ing)?|provid(?:e|es|ed|ing)|allow(?:s|ed|ing)?|enable(?:s|d|ing)?|help(?:s|ed|ing)?|use(?:s|d|ing)?|need(?:s|ed|ing)?|include(?:s|d|ing)?|offer(?:s|ed|ing)?|design(?:s|ed|ing)?|build(?:s|ing)?|built|serve(?:s|d|ing)?|require(?:s|d|ing)?|work(?:s|ed|ing)?|upload(?:s|ed|ing)?|download(?:s|ed|ing)?|share(?:s|d|ing)?|ask(?:s|ed|ing)?|search(?:es|ed|ing)?|generate(?:s|d|ing)?|analy[sz](?:e|es|ed|ing)|transcrib(?:e|es|ed|ing)|identif(?:y|ies|ied|ying)|structure(?:s|d|ing)?|start(?:s|ed|ing)?|come|coming)\b/i.test(display);
  const hasPredicate = hasChinesePredicate || hasEnglishPredicate;
  const collapsedBoundaryCount = (display.match(/[a-z][A-Z]/g) || []).length;
  const labelScanText = display.replace(/([a-z])([A-Z])/g, "$1 $2");
  const labelMatches = labelScanText.match(/\b(?:product(?:\s+teams?)?|teams?|leadership|project\s+management|sales|marketing|operations|security|pricing|features?|solutions?|customers?|resources?|partners?|library|company|about|contact)\b/gi) || [];
  const normalizedDisplay = normalizeText(display);
  const normalizedProduct = normalizeText(document.productName);
  const reasons: string[] = [];

  if (/!\[[^\]]*\]\([^)]*\)/.test(text)) reasons.push("media_only");
  if (links.length > 1) reasons.push("navigation_link_cluster");
  if (links.length && outsideLinks.length < 8) reasons.push("link_only");
  if (links.length && /^(预约|查看|进入|联系|了解|访问|返回|首页|Home|Contact\s+us)/i.test(display)) reasons.push("call_to_action");
  if (/^\*\*[^*]{1,40}\*\*$/.test(text)) reasons.push("section_label");
  if (/^\d{1,2}\s*[·.．-]\s*[A-Z][A-Z\s&×-]*$/i.test(display)) reasons.push("section_ordinal");
  if (/^[A-Z0-9][A-Z0-9\s&×·._/-]{3,}$/.test(display) && /[A-Z]/.test(display)) reasons.push("uppercase_label");
  if (/^(为什么|如何|什么是|哪些|是否|谁适合|怎么)/.test(display)) reasons.push("question_heading");
  if ((display.match(/\s[·×|]\s/g) || []).length >= 2 && !hasPredicate) reasons.push("label_sequence");
  if (normalizedDisplay && (normalizedDisplay === normalizedProduct || normalizedDisplay === "workbuddy" || normalizedDisplay === "joto")) reasons.push("entity_label_only");
  if ((display.match(/\b(?:Name|Company|Email|Phone(?:\s+or\s+WeChat)?)\b/gi) || []).length >= 2) reasons.push("form_fields");
  if ((display.match(/Home|Products|Solutions|Customers|Insights|Partner|Library/gi) || []).length >= 3) reasons.push("navigation_terms");
  if (!hasPredicate && collapsedBoundaryCount > 0 && labelMatches.length >= 2) reasons.push("collapsed_label_sequence");
  if (!hasPredicate && labelMatches.length >= 3 && !/[。！？.!?]/.test(display)) reasons.push("label_taxonomy_sequence");
  if (/用得起来.*管得住.*看得见/.test(display)) reasons.push("marketing_slogan_chain");
  if (display.length < 12 && !hasPredicate && !/[。！？.!?]/.test(display)) reasons.push("short_label");
  return unique(reasons).map((reason) => `automatic_noise_filter:${reason}`);
}

function markdownUnits(markdown: string): MarkdownUnit[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const headings: string[] = [];
  const units: MarkdownUnit[] = [];
  let offset = 0;
  let paragraphIndex = 0;
  let inFrontmatter = lines[0]?.trim() === "---";

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineStart = offset;
    offset += raw.length + 1;
    if (inFrontmatter) {
      if (index > 0 && raw.trim() === "---") inFrontmatter = false;
      continue;
    }
    const heading = raw.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      headings.splice(heading[1].length - 1);
      headings[heading[1].length - 1] = heading[2].trim();
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || /^\|?\s*:?-{3,}/.test(trimmed)) continue;
    const tableCells = trimmed.startsWith("|") && trimmed.endsWith("|")
      ? trimmed.slice(1, -1).split("|").map((cell) => cell.trim()).filter(Boolean)
      : [];
    const text = tableCells.length >= 2
      ? tableCells.join("：")
      : trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+[.)、]\s*/, "").replace(/^>\s*/, "").trim();
    if (text.length < 8 || /^(字段|能力域|部署方式|方案|阶段|场景|产品)[：]/.test(text)) continue;
    units.push({
      text,
      originalQuote: trimmed,
      subjectHint: tableCells.length >= 2 ? tableCells[0] : undefined,
      headingPath: headings.filter(Boolean),
      paragraphIndex,
      characterRange: [lineStart, lineStart + raw.length]
    });
    paragraphIndex += 1;
  }
  return units;
}

export interface ParsedWebNoiseCleaningResult {
  markdown: string;
  removed: Array<{ originalQuote: string; reasons: string[] }>;
}

export function cleanParsedWebMarkdown(
  markdown: string,
  input: { productName: string }
): ParsedWebNoiseCleaningResult {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const noiseByStart = new Map<number, { originalQuote: string; reasons: string[] }>();
  for (const unit of markdownUnits(normalized)) {
    const reasons = claimNoiseReasons(unit, { productName: input.productName });
    if (reasons.length) noiseByStart.set(unit.characterRange[0], { originalQuote: unit.originalQuote, reasons });
  }
  const kept: string[] = [];
  const removed: Array<{ originalQuote: string; reasons: string[] }> = [];
  let offset = 0;
  for (const line of normalized.split("\n")) {
    const noise = noiseByStart.get(offset);
    if (noise) removed.push(noise);
    else kept.push(line);
    offset += line.length + 1;
  }
  return {
    markdown: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removed
  };
}

function boundaryText(text: string) {
  return /(适用|条件|限制|可能变化|以.+为准|需要结合|不得|不应|不能|仅|只|核验|边界)/.test(text);
}

function inferSubject(text: string, subjectHint?: string) {
  const normalized = normalizeText(text);
  if (normalized.includes("joto") && normalized.includes("腾讯云") && normalized.includes("合作伙伴")) {
    return "joto-tencent-partnership";
  }
  if (normalized.includes("enterpriseflagship")) return "workbuddy-enterprise-flagship-price";
  if (normalized.includes("enterprisededicated")) return "workbuddy-enterprise-dedicated-price";
  if (normalized.includes("离线模式")) return "offline-mode";
  if (normalized.includes("部署方式") || normalized.includes("公有云") && normalized.includes("私有化")) return "deployment-modes";
  const normalizedHint = subjectHint ? normalizeText(subjectHint) : "";
  if (normalizedHint.length >= 2) return `labeled:${hash(normalizedHint).slice(0, 20)}`;
  return `statement:${hash(normalized).slice(0, 20)}`;
}

function inferSemanticValue(text: string, subjectKey: string) {
  const normalized = normalizeText(text);
  if (subjectKey === "joto-tencent-partnership") {
    if (normalized.includes("没有把joto表述为腾讯云adp官方合作伙伴") || normalized.includes("不扩写为腾讯云adp官方合作伙伴")) {
      return "tencent_partner_not_adp_official_partner";
    }
    if (normalized.includes("腾讯云adp官方合作伙伴")) return "adp_official_partner";
    return "tencent_partner";
  }
  if (subjectKey === "offline-mode") return /不支持|不具备|不可/.test(text) ? "not_supported" : "supported";
  return normalized;
}

function claimConditions(unit: MarkdownUnit, allUnits: MarkdownUnit[]) {
  const sameSectionBoundaries = allUnits
    .filter((candidate) => candidate.headingPath.join("/") === unit.headingPath.join("/") && boundaryText(candidate.text))
    .map((candidate) => candidate.text);
  const own = boundaryText(unit.text) ? [unit.text] : [];
  return unique([...own, ...sameSectionBoundaries]).slice(0, 3);
}

export function extractAutomaticClaims(document: AutomaticKnowledgeDocument, revision: AutomaticSourceRevision) {
  const units = markdownUnits(document.markdown);
  return units.map((unit): AutomaticKnowledgeClaim => {
    const subjectKey = inferSubject(unit.text, unit.subjectHint);
    const noiseReasons = claimNoiseReasons(unit, document);
    const limitations = noiseReasons.length ? noiseReasons : claimConditions(unit, units);
    return {
      claimId: stableId("claim", `${revision.sourceRevisionId}:${unit.characterRange.join(":")}:${unit.text}`),
      productId: document.productId,
      subjectKey,
      semanticValue: inferSemanticValue(unit.text, subjectKey),
      normalizedClaim: unit.text,
      originalQuote: unit.originalQuote,
      sourceId: document.sourceId,
      sourceRevisionId: revision.sourceRevisionId,
      sourceLocator: {
        headingPath: unit.headingPath,
        paragraphIndex: unit.paragraphIndex,
        characterRange: unit.characterRange
      },
      authorityLevel: document.authorityLevel,
      sourceUpdatedAt: document.sourceUpdatedAt,
      conditions: [],
      limitations,
      status: noiseReasons.length ? "rejected" : limitations.length ? "conditional" : "supported"
    };
  });
}

function claimsConflict(left: AutomaticKnowledgeClaim, right: AutomaticKnowledgeClaim) {
  if (left.subjectKey !== right.subjectKey || left.semanticValue === right.semanticValue) return false;
  if (left.subjectKey === "joto-tencent-partnership" || left.subjectKey === "offline-mode" || left.subjectKey.startsWith("labeled:")) return true;
  return false;
}

export function governAutomaticClaims(claims: AutomaticKnowledgeClaim[]) {
  const result = claims.map((claim) => ({ ...claim, conditions: [...claim.conditions], limitations: [...claim.limitations] }));
  const bySubject = new Map<string, AutomaticKnowledgeClaim[]>();
  for (const claim of result) {
    const key = `${claim.productId}:${claim.subjectKey}`;
    bySubject.set(key, [...(bySubject.get(key) || []), claim]);
  }

  for (const group of bySubject.values()) {
    const conflicting = group.filter((claim) => group.some((other) => other.claimId !== claim.claimId && claimsConflict(claim, other)));
    if (!conflicting.length) {
      if (group.length > 1 && group[0].subjectKey.startsWith("labeled:")) {
        const equivalent = [...group].sort((left, right) => {
          const authority = authorityRank[left.authorityLevel] - authorityRank[right.authorityLevel];
          if (authority) return authority;
          return new Date(right.sourceUpdatedAt).getTime() - new Date(left.sourceUpdatedAt).getTime();
        });
        for (const claim of equivalent.slice(1)) {
          claim.status = "superseded";
          claim.supersedesClaimId = equivalent[0].claimId;
        }
      }
      continue;
    }
    const conflictGroupId = stableId("conflict", `${group[0].productId}:${group[0].subjectKey}`);
    const sorted = [...conflicting].sort((left, right) => {
      const authority = authorityRank[left.authorityLevel] - authorityRank[right.authorityLevel];
      if (authority) return authority;
      return new Date(right.sourceUpdatedAt).getTime() - new Date(left.sourceUpdatedAt).getTime();
    });
    const winner = sorted[0];
    const runnerUp = sorted.find((claim) => claim.semanticValue !== winner.semanticValue);
    const canResolve = Boolean(runnerUp && (
      authorityRank[winner.authorityLevel] < authorityRank[runnerUp.authorityLevel]
      || (authorityRank[winner.authorityLevel] === authorityRank[runnerUp.authorityLevel]
        && new Date(winner.sourceUpdatedAt).getTime() > new Date(runnerUp.sourceUpdatedAt).getTime())
    ));
    for (const claim of conflicting) {
      claim.conflictGroupId = conflictGroupId;
      if (!canResolve) {
        claim.status = "disputed";
      } else if (claim.claimId === winner.claimId) {
        claim.status = claim.limitations.length ? "conditional" : "supported";
      } else {
        claim.status = "superseded";
        claim.supersedesClaimId = winner.claimId;
      }
    }
  }
  return result;
}

function deterministicVector(text: string, dimensions = 24) {
  const bytes = createHash("sha256").update(text).digest();
  return Array.from({ length: dimensions }, (_, index) => (bytes[index % bytes.length] - 127.5) / 127.5);
}

function queryScore(query: string, claim: AutomaticKnowledgeClaim) {
  const queryChars = new Set(normalizeText(query).split(""));
  const claimChars = normalizeText(`${claim.normalizedClaim}${claim.subjectKey}`);
  const overlap = [...queryChars].filter((char) => claimChars.includes(char)).length;
  return overlap / Math.max(1, queryChars.size) + (claim.status === "conditional" ? 0.05 : 0);
}

function renderLocator(locator: V5SourceLocator) {
  const heading = locator.headingPath.length ? locator.headingPath.join(" / ") : "正文";
  const paragraph = locator.paragraphIndex === undefined ? "" : `，段落 ${locator.paragraphIndex + 1}`;
  const range = locator.characterRange ? `，字符 ${locator.characterRange[0]}-${locator.characterRange[1]}` : "";
  return `${heading}${paragraph}${range}`;
}

function sentenceSupportedByClaim(text: string, claim: AutomaticKnowledgeClaim) {
  const candidate = normalizeText(text);
  const assertion = normalizeText(claim.normalizedClaim);
  const quote = normalizeText(claim.originalQuote);
  return candidate.length >= 4 && (candidate === assertion || quote.includes(candidate) || candidate.includes(assertion));
}

export class AutomaticKnowledgeProductionPipeline {
  private readonly documentsBySource = new Map<string, AutomaticKnowledgeDocument>();
  private readonly revisionsBySource = new Map<string, AutomaticSourceRevision[]>();
  private claims: AutomaticKnowledgeClaim[] = [];
  private snapshot?: AutomaticIndexSnapshot;
  private readonly tasks = new Map<string, AutomaticContentTask>();
  private readonly packs = new Map<string, AutomaticEvidencePack>();
  private readonly drafts = new Map<string, AutomaticDraft>();

  constructor(
    private readonly generator: AutomaticGenerationAdapter,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async importDocuments(documents: AutomaticKnowledgeDocument[]) {
    const changedSourceIds: string[] = [];
    for (const document of documents) {
      this.documentsBySource.set(document.sourceId, document);
      const contentHash = hash(document.markdown.replace(/\r\n/g, "\n"));
      const history = this.revisionsBySource.get(document.sourceId) || [];
      let revision = history.find((item) => item.contentHash === contentHash);
      if (!revision) {
        const previous = history.at(-1);
        revision = {
          sourceRevisionId: stableId("source-revision", `${document.sourceId}:${contentHash}`),
          sourceId: document.sourceId,
          revisionNumber: history.length + 1,
          contentHash,
          sourceUpdatedAt: document.sourceUpdatedAt,
          title: document.title,
          supersedesRevisionId: previous?.sourceRevisionId
        };
        this.revisionsBySource.set(document.sourceId, [...history, revision]);
        changedSourceIds.push(document.sourceId);
      }
    }
    const currentClaims = [...this.documentsBySource.values()].flatMap((document) => {
      const revision = this.revisionsBySource.get(document.sourceId)?.at(-1);
      return revision ? extractAutomaticClaims(document, revision) : [];
    });
    this.claims = governAutomaticClaims(currentClaims);
    this.rebuildIndex();
    if (changedSourceIds.length) {
      this.invalidatePacks(changedSourceIds);
      await this.runReadyTasks();
    }
    return {
      changedSourceIds,
      sourceRevisionCount: [...this.revisionsBySource.values()].reduce((total, items) => total + items.length, 0),
      supportedClaimCount: this.claims.filter((claim) => ["supported", "conditional"].includes(claim.status)).length,
      disputedClaimCount: this.claims.filter((claim) => claim.status === "disputed").length,
      supersededClaimCount: this.claims.filter((claim) => claim.status === "superseded").length,
      indexSnapshot: this.snapshot
    };
  }

  async enqueueTask(input: Omit<AutomaticContentTask, "status">) {
    const task: AutomaticContentTask = { ...input, status: this.snapshot ? "ready_for_generation" : "waiting_for_knowledge" };
    this.tasks.set(task.taskId, task);
    await this.runTask(task.taskId);
    return this.tasks.get(task.taskId)!;
  }

  private rebuildIndex() {
    const eligible = this.claims.filter((claim) => ["supported", "conditional"].includes(claim.status));
    const sourceRevisionIds = unique(eligible.map((claim) => claim.sourceRevisionId)).sort();
    const sourceSnapshotHash = hash(sourceRevisionIds.join(":"));
    this.snapshot = {
      indexSnapshotId: stableId("index-snapshot", sourceSnapshotHash),
      sourceSnapshotHash,
      sourceRevisionIds,
      claimIds: eligible.map((claim) => claim.claimId),
      vectors: Object.fromEntries(eligible.map((claim) => [claim.claimId, deterministicVector(`${claim.normalizedClaim}\n${claim.originalQuote}`)])),
      status: "active",
      createdAt: this.now()
    };
  }

  private invalidatePacks(changedSourceIds: string[]) {
    const changed = new Set(changedSourceIds);
    for (const pack of this.packs.values()) {
      if (pack.status !== "active" || !pack.evidenceItems.some((item) => changed.has(item.sourceId))) continue;
      pack.status = "invalidated";
      pack.invalidatedAt = this.now();
      pack.invalidationReason = "source_revision_changed";
      const task = this.tasks.get(pack.taskId);
      if (task && task.status !== "blocked") task.status = "ready_for_generation";
    }
  }

  private buildEvidencePack(task: AutomaticContentTask) {
    if (!this.snapshot) throw new Error("active_index_snapshot_missing");
    const eligible = this.claims
      .filter((claim) => claim.productId === task.productId && ["supported", "conditional"].includes(claim.status))
      .sort((left, right) => queryScore(task.query, right) - queryScore(task.query, left))
      .slice(0, 16);
    const unresolvedConflictIds = unique(this.claims.filter((claim) => claim.status === "disputed").flatMap((claim) => claim.conflictGroupId ? [claim.conflictGroupId] : []));
    const pack: AutomaticEvidencePack = {
      evidencePackId: `evidence-pack-${randomUUID()}`,
      taskId: task.taskId,
      taskVersion: task.taskVersion,
      indexSnapshotId: this.snapshot.indexSnapshotId,
      sourceSnapshotHash: this.snapshot.sourceSnapshotHash,
      evidenceItems: eligible.map((claim) => ({
        evidenceItemId: `evidence-${claim.claimId}`,
        claimId: claim.claimId,
        normalizedClaim: claim.normalizedClaim,
        originalQuote: claim.originalQuote,
        sourceId: claim.sourceId,
        sourceRevisionId: claim.sourceRevisionId,
        sourceLocator: claim.sourceLocator,
        conditions: claim.conditions,
        limitations: claim.limitations
      })),
      forbiddenClaimIds: this.claims.filter((claim) => ["disputed", "superseded"].includes(claim.status)).map((claim) => claim.claimId),
      unresolvedConflictIds,
      status: "active",
      createdAt: this.now()
    };
    this.packs.set(pack.evidencePackId, pack);
    return pack;
  }

  private validateAndRender(task: AutomaticContentTask, pack: AutomaticEvidencePack, modelDraft: AutomaticModelDraft) {
    const evidenceByClaim = new Map(pack.evidenceItems.map((item) => [item.claimId, item]));
    const claimById = new Map(this.claims.map((claim) => [claim.claimId, claim]));
    const accepted: Array<{ passage: AutomaticModelPassage; evidence: AutomaticEvidenceItem }> = [];
    const removedPassages: AutomaticDraft["removedPassages"] = [];
    for (const passage of modelDraft.passages) {
      if (!passage.claimId) {
        removedPassages.push({ text: passage.text, reason: "claim_missing" });
        continue;
      }
      const evidence = evidenceByClaim.get(passage.claimId);
      const claim = claimById.get(passage.claimId);
      if (!evidence || !claim) {
        removedPassages.push({ text: passage.text, reason: "claim_not_in_evidence_pack" });
        continue;
      }
      if (!sentenceSupportedByClaim(passage.text, claim)) {
        removedPassages.push({ text: passage.text, reason: "sentence_not_supported_by_original_quote" });
        continue;
      }
      accepted.push({ passage, evidence });
    }
    if (!accepted.length) throw new Error("no_supported_fact_after_automatic_repair");
    const factTraces: AutomaticFactTrace[] = accepted.map(({ passage, evidence }) => ({
      sentence: passage.text,
      evidenceItemId: evidence.evidenceItemId,
      claimId: evidence.claimId,
      sourceRevisionId: evidence.sourceRevisionId,
      sourceLocator: evidence.sourceLocator,
      originalQuote: evidence.originalQuote
    }));
    const facts = accepted.map(({ passage, evidence }, index) => {
      const boundaries = unique([...evidence.conditions, ...evidence.limitations]);
      return [
        `${index + 1}. ${passage.text}`,
        `   > 原文：${evidence.originalQuote}`,
        ...(boundaries.length ? [`   > 适用条件或限制：${boundaries.join("；")}`] : []),
        `   > 追溯：Claim ${evidence.claimId} -> SourceRevision ${evidence.sourceRevisionId} -> ${renderLocator(evidence.sourceLocator)}`
      ].join("\n");
    });
    return {
      taskId: task.taskId,
      taskVersion: task.taskVersion,
      evidencePackId: pack.evidencePackId,
      markdown: `# ${task.title}\n\n## 事实依据\n\n${facts.join("\n\n")}\n\n## 来源说明\n\n本文事实仅来自当前有效的 EvidencePack；系统已自动移除无 Claim、冲突或无法由原文支持的模型内容。`,
      factTraces,
      removedPassages,
      createdAt: this.now()
    } satisfies AutomaticDraft;
  }

  private async runTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "ready_for_generation") return;
    const pack = this.buildEvidencePack(task);
    if (!pack.evidenceItems.length) {
      task.status = "blocked";
      return;
    }
    const modelDraft = await this.generator.generate({ task, evidencePack: pack });
    const draft = this.validateAndRender(task, pack, modelDraft);
    this.drafts.set(task.taskId, draft);
    task.status = "generated";
  }

  private async runReadyTasks() {
    for (const task of this.tasks.values()) await this.runTask(task.taskId);
  }

  getClaims() {
    return this.claims.map((claim) => ({ ...claim }));
  }

  getIndexSnapshot() {
    return this.snapshot ? { ...this.snapshot } : undefined;
  }

  getEvidencePacks(taskId?: string) {
    return [...this.packs.values()].filter((pack) => !taskId || pack.taskId === taskId).map((pack) => ({ ...pack }));
  }

  getDraft(taskId: string) {
    return this.drafts.get(taskId);
  }
}
