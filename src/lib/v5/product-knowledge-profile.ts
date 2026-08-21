import { listV5ProductClaimsRecord } from "./knowledge-governance-review-repository";
import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, parseV5Json } from "./knowledge-governance-repository";
import type { ProductKnowledgeProfileOverrideInput } from "./product-registry-contracts";

export type ProductKnowledgeProfileCategory = "positioning" | "audience" | "capability" | "scenario" | "boundary";

export interface ProductKnowledgeProfileFact {
  claimId: string;
  text: string;
  sourceId: string;
  sourceRevisionId: string;
}

export interface ProductKnowledgeProfile {
  status: "ready" | "insufficient_facts";
  factCount: number;
  positioning: ProductKnowledgeProfileFact[];
  audiences: ProductKnowledgeProfileFact[];
  capabilities: ProductKnowledgeProfileFact[];
  scenarios: ProductKnowledgeProfileFact[];
  boundaries: ProductKnowledgeProfileFact[];
  source: "parsed" | "human_corrected";
  overrideVersion?: number;
  humanCorrectedAt?: string;
}

export interface ContentStrategyQuestionClusterInput {
  clusterId: string;
  label: string;
  questions: string[];
}

export interface ContentStrategyKnowledgeFact {
  claimId: string;
  text: string;
  quote: string;
  claimType: string;
  sourceId: string;
  sourceRevisionId: string;
  headingPath: string[];
  authorityLevel: string;
  reviewStatus: string;
  conditions: string[];
  limitations: string[];
  relevanceScore: number;
}

export interface ContentStrategyKnowledgeContext {
  contractVersion: "content-strategy-knowledge.v1";
  productId: string;
  productName: string;
  sourceFactCount: number;
  retrievedFactCount: number;
  profileSource: ProductKnowledgeProfile["source"];
  authoritativeProfile: {
    positioning: ProductKnowledgeProfileFact[];
    audiences: ProductKnowledgeProfileFact[];
    capabilities: ProductKnowledgeProfileFact[];
    scenarios: ProductKnowledgeProfileFact[];
    boundaries: ProductKnowledgeProfileFact[];
  };
  questionClusters: Array<ContentStrategyQuestionClusterInput & {
    facts: ContentStrategyKnowledgeFact[];
    writableAngles: string[];
  }>;
}

interface ProfileClaim {
  claimId: string;
  normalizedClaim: string;
  sourceId: string;
  sourceRevisionId: string;
  sourceLocator?: Record<string, unknown>;
  conditions?: string[];
  limitations?: string[];
}

type ApprovedProductClaim = Awaited<ReturnType<typeof listV5ProductClaimsRecord>>[number];

const noisePattern = /privacy policy|cookie|copyright|all rights reserved|send message|respond within|updated\s+\d|visual concept overview|^comparison$|隐私政策|版权所有|联系我们|更新时间/i;
const chineseFactPredicatePattern = /支持|提供|用于|能够|可以|采用|包含|覆盖|允许|需要|限制|适用|实现|帮助|接入|管理|生成|具备|完成|建立|规划|配置|执行|优化|保障|连接|部署|运行|使用|服务|是一个|是一款|专为/;
const englishFactPredicatePattern = /\b(?:is|are|was|were|has|have|had|support(?:s|ed|ing)?|provid(?:e|es|ed|ing)|allow(?:s|ed|ing)?|enable(?:s|d|ing)?|help(?:s|ed|ing)?|use(?:s|d|ing)?|need(?:s|ed|ing)?|include(?:s|d|ing)?|offer(?:s|ed|ing)?|design(?:s|ed|ing)?|build(?:s|ing)?|built|serve(?:s|d|ing)?|require(?:s|d|ing)?|work(?:s|ed|ing)?|upload(?:s|ed|ing)?|download(?:s|ed|ing)?|share(?:s|d|ing)?|ask(?:s|ed|ing)?|search(?:es|ed|ing)?|generate(?:s|d|ing)?|analy[sz](?:e|es|ed|ing)|transcrib(?:e|es|ed|ing)|identif(?:y|ies|ied|ying)|structure(?:s|d|ing)?|start(?:s|ed|ing)?|come|coming|useful\s+for)\b/i;
const taxonomyLabelPattern = /\b(?:product(?:\s+teams?)?|teams?|leadership|project\s+management|sales|marketing|operations|security|pricing|features?|solutions?|customers?|resources?|partners?|library|company|about|contact)\b/gi;
const categoryPatterns: Record<ProductKnowledgeProfileCategory, RegExp> = {
  positioning: /产品|平台|系统|工具|解决方案|服务|专为|定位|一站式|built|platform|product|solution|service|tool|designed|redesigned/i,
  audience: /用户|客户|团队|组织|员工|管理员|开发者|销售人员|运营人员|专业人员|teams?|organizations?|customers?|users?|employees?|admins?|developers?|professionals?/i,
  capability: /支持|能够|可以|提供|实现|允许|自动|集成|部署|上传|导入|分析|生成|搜索|问答|协作|共享|发布|support|enable|allow|automat|integrat|deploy|upload|import|analy|generat|search|ask|chat|collaborat|share|publish/i,
  scenario: /场景|工作流|流程|用于|适合|使用时|知识库|会议|文档|workflow|use case|when|notebook|meeting|document/i,
  boundary: /不支持|不能|不得|限制|仅限|必须|需要|取决于|前提|边界|即将推出|测试版|not support|cannot|must|only|require|depend|limitation|coming soon|beta/i
};

function cleanClaimText(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^[-*+>]\s+/, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(value: string) {
  return value.toLocaleLowerCase().replace(/[\s，。！？、：；“”"'（）()\-—_·|]/g, "");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() || "";
}

const genericStrategyTerms = new Set([
  "什么", "如何", "怎么", "哪些", "是否", "可以", "需要", "产品", "用户", "企业", "内容", "相关", "问题", "当前",
  "what", "how", "which", "product", "user", "users", "content", "current", "related"
]);

function strategyTerms(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const terms = new Set<string>();
  for (const word of normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []) {
    if (!genericStrategyTerms.has(word)) terms.add(word);
  }
  for (const sequence of normalized.match(/[\u3400-\u9fff]{2,}/g) || []) {
    if (sequence.length <= 8 && !genericStrategyTerms.has(sequence)) terms.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const pair = sequence.slice(index, index + 2);
      if (!genericStrategyTerms.has(pair)) terms.add(pair);
    }
  }
  return terms;
}

function uniqueQuestionClusters(items: ContentStrategyQuestionClusterInput[]) {
  const seen = new Set<string>();
  return items.flatMap((item, index) => {
    const questions = [...new Set(item.questions.map((question) => question.trim()).filter(Boolean))].slice(0, 10);
    const label = item.label.trim() || questions[0] || `问题簇 ${index + 1}`;
    const key = `${label}:${questions.join("|")}`.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
    if (!questions.length || seen.has(key)) return [];
    seen.add(key);
    return [{ clusterId: item.clusterId.trim() || `knowledge-cluster-${index + 1}`, label, questions }];
  }).slice(0, 10);
}

export function deriveContentStrategyQuestionClusters(previousOutputs: Array<{ taskType: string; outputSummary: Record<string, unknown> }>) {
  const discovery = previousOutputs.find((item) => item.taskType === "live_question_discovery")?.outputSummary || {};
  const directClusters = Array.isArray(discovery.queryClusters)
    ? discovery.queryClusters.flatMap((value, index): ContentStrategyQuestionClusterInput[] => {
        const item = recordValue(value);
        const questions = stringArray(item.questions).length
          ? stringArray(item.questions)
          : stringArray(item.representativeQuestions);
        if (!questions.length) return [];
        return [{
          clusterId: stringValue(item.clusterId, item.id) || `query-cluster-${index + 1}`,
          label: stringValue(item.name, item.title, item.intent, item.module) || `问题簇 ${index + 1}`,
          questions
        }];
      })
    : [];
  const grouped = new Map<string, string[]>();
  if (Array.isArray(discovery.questions)) {
    for (const value of discovery.questions) {
      const item = recordValue(value);
      const question = stringValue(item.text, item.question, item.title);
      if (!question) continue;
      const label = stringValue(item.module, item.faqBoard, item.intent, item.audience) || "未分类用户问题";
      const values = grouped.get(label) || [];
      values.push(question);
      grouped.set(label, values);
    }
  }
  const groupedClusters = [...grouped.entries()].map(([label, questions], index) => ({
    clusterId: `question-module-${index + 1}`,
    label,
    questions
  }));
  return uniqueQuestionClusters([...directClusters, ...groupedClusters]);
}

function knowledgeFactScore(claim: ApprovedProductClaim, cluster: ContentStrategyQuestionClusterInput) {
  const queryText = `${cluster.label} ${cluster.questions.join(" ")}`;
  const queryTerms = strategyTerms(queryText);
  const headingPath = Array.isArray(claim.sourceLocator?.headingPath)
    ? claim.sourceLocator.headingPath.filter((item): item is string => typeof item === "string")
    : [];
  const factText = `${claim.normalizedClaim} ${claim.originalQuote || ""} ${claim.claimType} ${headingPath.join(" ")}`;
  const factTerms = strategyTerms(factText);
  let score = 0;
  for (const term of queryTerms) {
    if (factTerms.has(term)) score += term.length > 2 ? 3 : 1;
  }
  const normalizedFact = normalizedKey(factText);
  const normalizedLabel = normalizedKey(cluster.label);
  if (normalizedLabel.length >= 2 && normalizedFact.includes(normalizedLabel)) score += 8;
  // Governance quality ranks relevant facts; it must not make an unrelated
  // claim look relevant by itself.
  if (score > 0 && claim.reviewStatus === "supported") score += 1;
  if (score > 0 && ["A1", "A2"].includes(String(claim.authorityLevel))) score += 1;
  return score;
}

function toContentStrategyKnowledgeFact(claim: ApprovedProductClaim, relevanceScore: number): ContentStrategyKnowledgeFact {
  const headingPath = Array.isArray(claim.sourceLocator?.headingPath)
    ? claim.sourceLocator.headingPath.filter((item): item is string => typeof item === "string")
    : [];
  return {
    claimId: claim.claimId,
    text: claim.normalizedClaim,
    quote: String(claim.originalQuote || claim.normalizedClaim).slice(0, 600),
    claimType: claim.claimType,
    sourceId: claim.sourceId,
    sourceRevisionId: claim.sourceRevisionId,
    headingPath,
    authorityLevel: String(claim.authorityLevel),
    reviewStatus: String(claim.reviewStatus),
    conditions: claim.conditions || [],
    limitations: claim.limitations || [],
    relevanceScore
  };
}

export function buildContentStrategyKnowledgeContext(input: {
  productId: string;
  productName: string;
  profile: ProductKnowledgeProfile;
  claims: ApprovedProductClaim[];
  questionClusters?: ContentStrategyQuestionClusterInput[];
}): ContentStrategyKnowledgeContext {
  const clusters = input.questionClusters?.length
    ? uniqueQuestionClusters(input.questionClusters)
    : [{ clusterId: "product-knowledge-overview", label: `${input.productName} 可写内容`, questions: [`${input.productName} 有哪些能力、场景、服务与采用信息可以对外表达？`] }];
  const selectedClaimIds = new Set<string>();
  const questionClusters = clusters.map((cluster) => {
    const ranked = input.claims
      .map((claim, index) => ({ claim, index, score: knowledgeFactScore(claim, cluster) }))
      .filter((item) => item.score > 1)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 10);
    const fallback = ranked.length ? ranked : input.claims.slice(0, 5).map((claim, index) => ({ claim, index, score: 0 }));
    const facts = fallback.map(({ claim, score }) => {
      selectedClaimIds.add(claim.claimId);
      return toContentStrategyKnowledgeFact(claim, score);
    });
    const writableAngles = [...new Set(facts.flatMap((fact) => [fact.headingPath.at(-1), fact.claimType]).filter((item): item is string => Boolean(item)))].slice(0, 8);
    return { ...cluster, facts, writableAngles };
  });
  return {
    contractVersion: "content-strategy-knowledge.v1",
    productId: input.productId,
    productName: input.productName,
    sourceFactCount: input.claims.length,
    retrievedFactCount: selectedClaimIds.size,
    profileSource: input.profile.source,
    authoritativeProfile: {
      positioning: input.profile.positioning,
      audiences: input.profile.audiences,
      capabilities: input.profile.capabilities,
      scenarios: input.profile.scenarios,
      boundaries: input.profile.boundaries
    },
    questionClusters
  };
}

function headingText(claim: ProfileClaim) {
  const headingPath = claim.sourceLocator?.headingPath;
  return Array.isArray(headingPath) ? headingPath.filter((item): item is string => typeof item === "string").join(" ") : "";
}

function hasFactShape(text: string) {
  const labelScanText = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  const labelMatches = labelScanText.match(taxonomyLabelPattern) || [];
  const hasPredicate = chineseFactPredicatePattern.test(text) || englishFactPredicatePattern.test(text);
  if (!hasPredicate) return false;
  if ((text.match(/[a-z][A-Z]/g) || []).length > 0 && labelMatches.length >= 2) return false;
  return true;
}

function hasAudienceFactShape(text: string) {
  const audience = /用户|客户|团队|组织|员工|管理员|开发者|销售人员|运营人员|专业人员|\b(?:teams?|organizations?|customers?|users?|employees?|admins?|developers?|professionals?)\b/i.test(text);
  const relation = /使用|需要|适合|专为|服务|帮助|\b(?:use(?:s|d|ing)?|need(?:s|ed|ing)?|designed\s+for|built\s+for|useful\s+for|suitable\s+for|serve(?:s|d|ing)?|help(?:s|ed|ing)?|upload(?:s|ed|ing)?|share(?:s|d|ing)?|require(?:s|d|ing)?)\b/i.test(text);
  return audience && relation;
}

function categoryScore(claim: ProfileClaim, category: ProductKnowledgeProfileCategory, productName: string) {
  const text = cleanClaimText(claim.normalizedClaim);
  if (text.length < 12 || text.length > 420 || noisePattern.test(text)) return -1;
  if (!hasFactShape(text)) return -1;
  if ((category === "positioning" || category === "audience") && /contact|guided demo|here to help|our team|联系我们|演示/i.test(text)) return -1;
  if (category === "audience" && !hasAudienceFactShape(text)) return -1;
  if (category === "scenario" && /^feature\b.*notebooklm/i.test(text)) return -1;
  if (category === "boundary" && /doesn['’]t limit|no limit|不限于/i.test(text)) return -1;
  const heading = headingText(claim);
  const directMatch = categoryPatterns[category].test(text);
  const headingMatch = categoryPatterns[category].test(heading);
  if (!directMatch) return -1;
  let score = directMatch ? 4 : 1;
  if (productName && text.length >= 24 && text.toLocaleLowerCase().includes(productName.toLocaleLowerCase())) score += 2;
  if (text.length >= 24 && text.length <= 240) score += 1;
  if (category === "positioning" && /alternative|built on|designed|redesigned|定位|专为|是一款|是一个/i.test(text)) score += 4;
  if (category === "scenario" && /useful for|upload|ask|workflow|meeting|research|analysis|reporting|用于|适合|上传|提问|会议|研究|分析|报告/i.test(text)) score += 3;
  if (category === "boundary" && ((claim.conditions?.length || 0) > 0 || (claim.limitations?.length || 0) > 0)) score += 3;
  return score;
}

function selectFacts(claims: ProfileClaim[], category: ProductKnowledgeProfileCategory, productName: string, limit: number) {
  const seen = new Set<string>();
  return claims
    .map((claim, index) => ({ claim, index, score: categoryScore(claim, category, productName) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .flatMap(({ claim }) => {
      const text = cleanClaimText(claim.normalizedClaim);
      const key = normalizedKey(text);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ claimId: claim.claimId, text, sourceId: claim.sourceId, sourceRevisionId: claim.sourceRevisionId }];
    })
    .slice(0, limit);
}

export function buildProductKnowledgeProfile(productName: string, claims: ProfileClaim[]): ProductKnowledgeProfile {
  return {
    status: claims.length ? "ready" : "insufficient_facts",
    factCount: claims.length,
    positioning: selectFacts(claims, "positioning", productName, 3),
    audiences: selectFacts(claims, "audience", productName, 5),
    capabilities: selectFacts(claims, "capability", productName, 8),
    scenarios: selectFacts(claims, "scenario", productName, 5),
    boundaries: selectFacts(claims, "boundary", productName, 5),
    source: "parsed"
  };
}

function humanFacts(
  overrideId: string,
  version: number,
  category: ProductKnowledgeProfileCategory,
  items: string[]
): ProductKnowledgeProfileFact[] {
  return items.map((text, index) => ({
    claimId: `${overrideId}:${category}:${index + 1}`,
    text,
    sourceId: "human-corrected-product-profile",
    sourceRevisionId: `${overrideId}:v${version}`
  }));
}

export function applyProductKnowledgeProfileOverride(input: {
  parsed: ProductKnowledgeProfile;
  overrideId: string;
  version: number;
  approvedAt: string | Date;
  override: ProductKnowledgeProfileOverrideInput;
}): ProductKnowledgeProfile {
  const hasHumanContent = [
    input.override.positioning,
    input.override.audiences,
    input.override.capabilities,
    input.override.scenarios,
    input.override.boundaries
  ].some((items) => items.length > 0);
  return {
    ...input.parsed,
    status: hasHumanContent ? "ready" : input.parsed.status,
    positioning: humanFacts(input.overrideId, input.version, "positioning", input.override.positioning || []),
    audiences: humanFacts(input.overrideId, input.version, "audience", input.override.audiences || []),
    capabilities: humanFacts(input.overrideId, input.version, "capability", input.override.capabilities || []),
    scenarios: humanFacts(input.overrideId, input.version, "scenario", input.override.scenarios || []),
    boundaries: humanFacts(input.overrideId, input.version, "boundary", input.override.boundaries || []),
    source: "human_corrected",
    overrideVersion: input.version,
    humanCorrectedAt: new Date(input.approvedAt).toISOString()
  };
}

export async function readProductKnowledgeBundle(
  productId: string,
  productName: string,
  questionClusters: ContentStrategyQuestionClusterInput[] = []
) {
  const [supported, conditional, overrideRows] = await Promise.all([
    listV5ProductClaimsRecord({ productId, reviewStatus: "supported" }),
    listV5ProductClaimsRecord({ productId, reviewStatus: "conditional" }),
    getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT id, version_number, profile_json, approved_at
       FROM product_knowledge_profile_override_version
       WHERE product_id = ? AND status = 'active'
       ORDER BY version_number DESC LIMIT 1`,
      [productId]
    ).then(([rows]) => rows)
  ]);
  const claims = [...supported, ...conditional];
  const parsed = buildProductKnowledgeProfile(productName, claims);
  const row = overrideRows[0];
  const override = row ? parseV5Json<ProductKnowledgeProfileOverrideInput | null>(row.profile_json, null) : null;
  const profile = row && override
    ? applyProductKnowledgeProfileOverride({
        parsed,
        overrideId: String(row.id),
        version: Number(row.version_number),
        approvedAt: row.approved_at,
        override
      })
    : parsed;
  return {
    profile,
    contentStrategyKnowledgeContext: buildContentStrategyKnowledgeContext({
      productId,
      productName,
      profile,
      claims,
      questionClusters
    })
  };
}

export async function readProductKnowledgeProfile(productId: string, productName: string): Promise<ProductKnowledgeProfile> {
  const bundle = await readProductKnowledgeBundle(productId, productName);
  return bundle.profile;
}
