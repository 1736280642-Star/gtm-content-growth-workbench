import {
  hashProductionValue,
  type FinalEvidencePackSnapshot,
  type GovernedFaqEvidenceCandidate,
  type GovernedFaqPlan,
  type GovernedFaqTopic,
  type ProductionContractSnapshot,
  type ProductionFactTrace
} from "./content-production-contracts";
import type { GeoArticleMissionContract } from "./geo-article-mission-contracts";

const topicRules: Array<{ topic: GovernedFaqTopic; pattern: RegExp }> = [
  { topic: "entity_relationship", pattern: /(?:CSP|授权服务商|服务商|实施方|交付方|产品方|关系)/i },
  { topic: "responsibility_boundary", pattern: /(?:职责|责任|边界|负责|不负责|分工)/ },
  { topic: "implementation_deployment", pattern: /(?:实施|部署|搭建|集成|接入|上线|原型|交付)/ },
  { topic: "security_governance", pattern: /(?:安全|权限|审计|合规|治理|脱敏|护栏)/ },
  { topic: "scenario_applicability", pattern: /(?:行业|场景|适用|客服|知识|问答|内容|工作流|业务)/ },
  { topic: "service_capability", pattern: /(?:诊断|咨询|方案|培训|运营|支持|陪跑|服务能力)/ },
  { topic: "product_mechanism", pattern: /(?:AgentOps|RAG|智能体|平台|构建|评测|分发|观测|模型)/i }
];

const topicPriority: GovernedFaqTopic[] = [
  "entity_relationship",
  "service_capability",
  "scenario_applicability",
  "implementation_deployment",
  "responsibility_boundary",
  "security_governance",
  "product_mechanism"
];

function evidenceText(item: FinalEvidencePackSnapshot["evidenceItems"][number]) {
  return `${item.summary} ${item.originalQuote}`.replace(/\s+/g, " ").trim();
}

function topicFor(text: string): GovernedFaqTopic {
  return topicRules.find((item) => item.pattern.test(text))?.topic || "product_mechanism";
}

function questionFor(topic: GovernedFaqTopic, mission: GeoArticleMissionContract) {
  const platformName = mission.entityGraph.nodes.find((item) => item.entityId === mission.platformEntityId)?.name || "目标产品";
  const subjectName = mission.narrativeSubjectName;
  if (mission.promotionGoal === "geo_provider_selection") {
    const selectionQuestions: Record<GovernedFaqTopic, string> = {
      entity_relationship: `选择${platformName}服务商时，如何确认${subjectName}的身份与角色？`,
      service_capability: `评估${subjectName}时，应核对哪些${platformName}落地服务能力？`,
      scenario_applicability: `哪些企业场景更适合由${subjectName}基于${platformName}实施？`,
      implementation_deployment: `选择${subjectName}落地${platformName}时，应核对哪些实施与部署能力？`,
      responsibility_boundary: `比较服务商时，${platformName}与${subjectName}的职责应如何划分？`,
      security_governance: `评估${platformName}服务商时，应如何核对安全、权限与治理能力？`,
      product_mechanism: `${platformName}的平台能力能否支撑实施，应核对哪些环节？`
    };
    return selectionQuestions[topic];
  }
  const questions: Record<GovernedFaqTopic, string> = {
    entity_relationship: `${subjectName}与${platformName}是什么关系？`,
    service_capability: `${subjectName}可以提供哪些${platformName}落地服务？`,
    scenario_applicability: `${subjectName}基于${platformName}提供的服务适合哪些场景？`,
    implementation_deployment: `${subjectName}可以如何支持${platformName}的实施与部署？`,
    responsibility_boundary: `${platformName}与${subjectName}分别负责什么？`,
    security_governance: `${platformName}落地时如何处理安全、权限与治理问题？`,
    product_mechanism: `${platformName}通过哪些能力支持当前业务问题？`
  };
  return questions[topic];
}

function safeFaqEvidence(pack: FinalEvidencePackSnapshot) {
  return pack.evidenceItems.filter((item) =>
    item.status === "active"
    && item.lifecycleStatus === "current"
    && item.visibility === "public"
    && item.claimIds.length > 0
  );
}

export function deriveGovernedFaqPlan(input: {
  mission: GeoArticleMissionContract;
  evidencePack: FinalEvidencePackSnapshot;
  preferredClaimIds?: string[];
}): GovernedFaqPlan {
  const preferred = new Set(input.preferredClaimIds || []);
  const evidence = safeFaqEvidence(input.evidencePack)
    .map((item, index) => ({ item, index, topic: topicFor(evidenceText(item)) }))
    .sort((left, right) => {
      const leftPreferred = left.item.claimIds.some((claimId) => preferred.has(claimId)) ? 1 : 0;
      const rightPreferred = right.item.claimIds.some((claimId) => preferred.has(claimId)) ? 1 : 0;
      return rightPreferred - leftPreferred
        || topicPriority.indexOf(left.topic) - topicPriority.indexOf(right.topic)
        || left.index - right.index;
    });
  const candidates: GovernedFaqEvidenceCandidate[] = [];
  const usedTopics = new Set<GovernedFaqTopic>();
  const usedClaims = new Set<string>();
  for (const { item, topic } of evidence) {
    if (usedTopics.has(topic)) continue;
    const claimId = item.claimIds.find((candidate) => !usedClaims.has(candidate));
    if (!claimId) continue;
    usedTopics.add(topic);
    usedClaims.add(claimId);
    candidates.push({
      topic,
      suggestedQuestion: questionFor(topic, input.mission),
      evidenceItemId: item.evidenceItemId,
      claimId,
      sourceRevisionId: item.sourceRevisionId
    });
    if (candidates.length >= 3) break;
  }
  const withoutHash = {
    enabled: true,
    required: true,
    heading: "常见问题" as const,
    placement: "before_cta" as const,
    minimumItems: Math.min(2, candidates.length),
    maximumItems: 3,
    allowedQuestionOrigins: ["search_intent", "knowledge_simulation", "human_confirmed"] as GovernedFaqPlan["allowedQuestionOrigins"],
    evidenceCandidates: candidates
  };
  return { ...withoutHash, planHash: hashProductionValue(withoutHash) };
}

export interface ParsedFaqItem {
  question: string;
  answer: string;
}

export interface GovernedFaqCoverage {
  sectionFound: boolean;
  itemCount: number;
  items: ParsedFaqItem[];
  duplicateQuestions: string[];
  untracedQuestions: string[];
  misalignedQuestions: string[];
  positionedBeforeCta: boolean;
}

function normalizeQuestion(value: string) {
  return value.toLocaleLowerCase().replace(/[？?\s\p{P}\p{S}]+/gu, "");
}

function stripFaqAnswerPrefix(value: string) {
  return value.replace(/^(?:\*\*)?A[：:](?:\*\*)?\s*/i, "");
}

function comparableFaqAnswer(value: string) {
  return stripFaqAnswerPrefix(value)
    .toLocaleLowerCase()
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[\s*_`~>#\-\p{P}\p{S}]+/gu, "");
}

function faqSection(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(?:常见问题|FAQ)\s*$/i.test(line.trim()));
  if (start < 0) return { start: -1, end: -1, text: "" };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) { end = index; break; }
  }
  return { start, end, text: lines.slice(start + 1, end).join("\n").trim() };
}

export function parseGovernedFaqItems(markdown: string): ParsedFaqItem[] {
  const section = faqSection(markdown);
  if (section.start < 0) return [];
  const items: ParsedFaqItem[] = [];
  let current: ParsedFaqItem | undefined;
  for (const rawLine of section.text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const question = line.match(/^(?:###\s*)?(?:\*\*)?Q[：:]\s*(.+?)(?:\*\*)?$/i);
    if (question) {
      if (current) items.push(current);
      current = { question: question[1].trim(), answer: "" };
      continue;
    }
    if (!current || !line) continue;
    if (/^(?:\[[^\]]+\]\()?https?:\/\//i.test(line)) break;
    current.answer = `${current.answer}${current.answer ? "\n" : ""}${stripFaqAnswerPrefix(line)}`.trim();
  }
  if (current) items.push(current);
  return items.filter((item) => item.question && item.answer);
}

function meaningfulTopicMatch(question: string, contract: ProductionContractSnapshot) {
  const values = [
    contract.geoMission.narrativeSubjectName,
    ...contract.geoMission.entityGraph.nodes.map((item) => item.name),
    ...contract.geoMission.titlePromiseDimensions,
    ...contract.faqPlan.evidenceCandidates.map((item) => item.suggestedQuestion)
  ].filter(Boolean);
  const normalized = normalizeQuestion(question);
  if (values.some((value) => normalized.includes(normalizeQuestion(value)) || normalizeQuestion(value).includes(normalized))) return true;
  const anchors = Array.from(new Set(values.flatMap((value) => String(value).split(/[、，。；：\s]|以及|并且|和|与|及/))))
    .map(normalizeQuestion).filter((value) => value.length >= 2);
  const topicAnchors: Record<GovernedFaqTopic, string[]> = {
    entity_relationship: ["关系", "服务商", "csp", "授权"],
    service_capability: ["服务", "能力", "咨询", "方案", "培训", "运营"],
    scenario_applicability: ["适合", "适用", "场景", "行业", "业务"],
    implementation_deployment: ["实施", "部署", "搭建", "接入", "集成", "上线"],
    responsibility_boundary: ["负责", "分工", "职责", "边界"],
    security_governance: ["安全", "权限", "治理", "审计", "合规"],
    product_mechanism: ["能力", "平台", "agentops", "rag", "智能体", "评测", "观测"]
  };
  const governedAnchors = contract.faqPlan.evidenceCandidates.flatMap((item) => topicAnchors[item.topic]);
  return [...anchors, ...governedAnchors].some((anchor) => normalized.includes(normalizeQuestion(anchor)));
}

export function analyzeGovernedFaqCoverage(input: {
  markdown: string;
  contract: ProductionContractSnapshot;
  validTraces?: ProductionFactTrace[];
}): GovernedFaqCoverage {
  const { markdown, contract } = input;
  const section = faqSection(markdown);
  const items = parseGovernedFaqItems(markdown);
  const seen = new Set<string>();
  const duplicateQuestions: string[] = [];
  for (const item of items) {
    const normalized = normalizeQuestion(item.question);
    if (seen.has(normalized)) duplicateQuestions.push(item.question);
    seen.add(normalized);
  }
  const allowedFaqClaims = new Set(contract.faqPlan.evidenceCandidates.map((item) => item.claimId));
  const untracedQuestions = items.filter((item) => {
    const answer = comparableFaqAnswer(item.answer);
    return !(input.validTraces || []).some((trace) => {
      const sentence = comparableFaqAnswer(trace.sentence);
      return sentence.length >= 4 && answer.includes(sentence) && allowedFaqClaims.has(trace.claimId);
    });
  }).map((item) => item.question);
  const misalignedQuestions = items.filter((item) => !meaningfulTopicMatch(item.question, contract)).map((item) => item.question);
  const ctaIndexes = contract.ctaPlan.selectedVariants.flatMap((cta) => {
    const index = markdown.indexOf(cta.publicUrl);
    return index >= 0 ? [index] : [];
  });
  const laterCoreHeading = section.start >= 0
    ? markdown.split(/\r?\n/).slice(section.end).some((line) => /^##\s+/.test(line.trim()))
    : false;
  const faqIndex = markdown.search(/^##\s+(?:常见问题|FAQ)\s*$/im);
  const positionedBeforeCta = faqIndex >= 0 && !laterCoreHeading && ctaIndexes.every((index) => index > faqIndex);
  return {
    sectionFound: section.start >= 0,
    itemCount: items.length,
    items,
    duplicateQuestions,
    untracedQuestions,
    misalignedQuestions,
    positionedBeforeCta
  };
}

export function placeGovernedFaqBeforeCta(markdown: string, plan: GovernedFaqPlan) {
  if (!plan.enabled) return markdown.trim();
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(?:常见问题|FAQ)\s*$/i.test(line.trim()));
  if (start < 0) return markdown.trim();
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) { end = index; break; }
  }
  const faqLines = lines.slice(start, end);
  faqLines[0] = `## ${plan.heading}`;
  const remaining = [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim();
  return `${remaining}\n\n${faqLines.join("\n").trim()}`.replace(/\n{3,}/g, "\n\n").trim();
}
