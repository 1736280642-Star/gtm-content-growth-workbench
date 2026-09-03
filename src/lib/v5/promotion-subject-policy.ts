import type {
  FinalEvidencePackSnapshot,
  ProductionContractSnapshot,
  PromotionCapabilityCategory,
  PromotionSubjectPlan
} from "./content-production-contracts";
import type { GeoArticleMissionContract } from "./geo-article-mission-contracts";

const capabilityPatterns: Array<{ category: PromotionCapabilityCategory; pattern: RegExp }> = [
  { category: "diagnosis_consulting", pattern: /(?:场景|需求|业务).{0,8}(?:诊断|咨询|梳理|评估)|可行性评估/ },
  { category: "solution_design", pattern: /(?:方案|架构|原型|知识库|工作流|智能体).{0,8}(?:设计|封装|搭建|配置|编排)|垂直解决方案/ },
  { category: "integration_delivery", pattern: /(?:系统|数据|流程).{0,8}(?:集成|接入|打通)|(?:项目|生产级).{0,8}(?:实施|部署|交付)|(?:实施|部署|交付).{0,6}(?:服务|支持|工作|动作)?/ },
  { category: "training_operations", pattern: /(?:交付)?培训|(?:持续|长期|后续).{0,8}(?:运营|优化|支持|陪跑)|运营陪跑/ }
];

function compact(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function evidenceText(item: FinalEvidencePackSnapshot["evidenceItems"][number]) {
  return `${item.summary} ${item.originalQuote}`.replace(/\s+/g, " ");
}

function containsName(text: string, name: string) {
  return text.toLocaleLowerCase().includes(name.toLocaleLowerCase());
}

function identityStatement(mission: GeoArticleMissionContract) {
  const relation = mission.entityGraph.relations.find((item) =>
    item.predicate === "served_by" && item.objectEntityId === mission.promotionSubjectEntityId
  );
  if (!relation) return undefined;
  return relation.canonicalStatement.split(/[；。\n]/).map((item) => item.trim())
    .find((item) => containsName(item, mission.narrativeSubjectName) && /(?:CSP|授权服务商|服务商|实施方|交付方)/i.test(item));
}

export function derivePromotionSubjectPlan(input: {
  mission: GeoArticleMissionContract;
  evidencePack: FinalEvidencePackSnapshot;
}): PromotionSubjectPlan {
  const { mission, evidencePack } = input;
  const enabled = mission.narrativeSubjectRole === "service_provider";
  if (!enabled) {
    return {
      enabled: false,
      platformEntityId: mission.platformEntityId,
      promotionSubjectEntityId: mission.promotionSubjectEntityId,
      narrativeSubjectName: mission.narrativeSubjectName,
      narrativeSubjectRole: mission.narrativeSubjectRole,
      identityClaimIds: [],
      serviceCapabilityClaims: [],
      minimumServiceCapabilityClaims: 0,
      minimumServiceCapabilityCategories: 0,
      minimumBodySubjectMentions: 0,
      requiredSectionCoverageRatio: 0
    };
  }

  const identityClaimIds = compact(evidencePack.evidenceItems.flatMap((item) => {
    const text = evidenceText(item);
    return containsName(text, mission.narrativeSubjectName)
      && /(?:CSP\s*授权服务商|授权服务商|实施服务商|交付服务商)/i.test(text)
      ? item.claimIds
      : [];
  })).slice(0, 1);
  const usedClaims = new Set<string>();
  const serviceCapabilityClaims: PromotionSubjectPlan["serviceCapabilityClaims"] = [];
  for (const { category, pattern } of capabilityPatterns) {
    for (const item of evidencePack.evidenceItems) {
      const text = evidenceText(item);
      if (!containsName(text, mission.narrativeSubjectName) || !pattern.test(text)) continue;
      const claimId = item.claimIds.find((candidate) => !usedClaims.has(candidate));
      if (!claimId) continue;
      usedClaims.add(claimId);
      serviceCapabilityClaims.push({ claimId, evidenceItemId: item.evidenceItemId, category });
      break;
    }
  }

  return {
    enabled: true,
    platformEntityId: mission.platformEntityId,
    promotionSubjectEntityId: mission.promotionSubjectEntityId,
    narrativeSubjectName: mission.narrativeSubjectName,
    narrativeSubjectRole: mission.narrativeSubjectRole,
    identityStatement: identityStatement(mission),
    identityClaimIds,
    serviceCapabilityClaims: serviceCapabilityClaims.slice(0, 3),
    minimumServiceCapabilityClaims: 2,
    minimumServiceCapabilityCategories: 2,
    minimumBodySubjectMentions: 3,
    requiredSectionCoverageRatio: 1
  };
}

function removeGovernedBlocks(markdown: string, contract: ProductionContractSnapshot) {
  let value = markdown;
  for (const fixed of contract.fixedExpressions || []) value = value.replaceAll(fixed.text, " ");
  for (const cta of contract.ctaPlan.selectedVariants) {
    value = value.replaceAll(cta.label, " ").replaceAll(cta.publicUrl, " ");
  }
  return value;
}

function countOccurrences(text: string, value: string) {
  if (!value) return 0;
  return text.toLocaleLowerCase().split(value.toLocaleLowerCase()).length - 1;
}

function actionCategories(text: string) {
  return capabilityPatterns.filter((item) => item.pattern.test(text)).map((item) => item.category);
}

function coreSections(markdown: string) {
  const sections: Array<{ heading: string; bodyLines: string[] }> = [];
  let current: { heading: string; bodyLines: string[] } | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.trim().match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: heading[1].trim(), bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) sections.push(current);
  return sections
    .map((section) => ({ heading: section.heading, body: section.bodyLines.join("\n").trim() }))
    .filter((item) => item.body && !/(?:常见问题|FAQ|了解更多|联系方式)/i.test(item.heading));
}

export interface PromotionSubjectCoverage {
  enabled: boolean;
  narrativeSubjectName: string;
  bodySubjectMentions: number;
  openingCovered: boolean;
  distinctCapabilityCategories: PromotionCapabilityCategory[];
  coreSectionCount: number;
  coveredCoreSectionCount: number;
  uncoveredCoreSectionHeadings: string[];
  sectionCoverageRatio: number;
  roleResponsibilityClear: boolean;
  blockers: string[];
}

export function analyzePromotionSubjectCoverage(
  markdown: string,
  contract: ProductionContractSnapshot
): PromotionSubjectCoverage {
  const plan = contract.promotionSubjectPlan || contract.validatorPolicy.promotionSubjectPlan;
  if (!plan?.enabled) {
    return {
      enabled: false,
      narrativeSubjectName: plan?.narrativeSubjectName || contract.geoMission.narrativeSubjectName,
      bodySubjectMentions: 0,
      openingCovered: true,
      distinctCapabilityCategories: [],
      coreSectionCount: 0,
      coveredCoreSectionCount: 0,
      uncoveredCoreSectionHeadings: [],
      sectionCoverageRatio: 1,
      roleResponsibilityClear: true,
      blockers: []
    };
  }
  const cleaned = removeGovernedBlocks(markdown, contract);
  const sections = coreSections(cleaned);
  const openingText = cleaned.split(/^##\s+/m)[0].replace(/^#\s+[^\n]+/m, " ");
  const openingCovered = containsName(openingText, plan.narrativeSubjectName) && actionCategories(openingText).length > 0;
  const coveredSections = sections.filter((section) =>
    containsName(section.body, plan.narrativeSubjectName) && actionCategories(section.body).length > 0
  );
  const coveredHeadings = new Set(coveredSections.map((section) => section.heading));
  const uncoveredCoreSectionHeadings = sections.filter((section) => !coveredHeadings.has(section.heading)).map((section) => section.heading);
  const categories = compact(actionCategories(cleaned)) as PromotionCapabilityCategory[];
  const bodySubjectMentions = countOccurrences(cleaned, plan.narrativeSubjectName);
  const sectionCoverageRatio = sections.length ? coveredSections.length / sections.length : 0;
  const platformName = contract.geoMission.entityGraph.nodes.find((item) => item.entityId === plan.platformEntityId)?.name || "";
  const roleResponsibilityClear = Boolean(
    platformName
    && containsName(cleaned, platformName)
    && new RegExp(`${plan.narrativeSubjectName}[^。！？\n]{0,40}(?:负责|提供|实施|交付|搭建|部署|集成|运营|支持)`, "i").test(cleaned)
    && new RegExp(`${platformName}[^。！？\n]{0,40}(?:平台|底座|产品|云能力)`, "i").test(cleaned)
  );
  const blockers: string[] = [];
  if (!bodySubjectMentions) blockers.push("promotion_subject_missing");
  else if (bodySubjectMentions < plan.minimumBodySubjectMentions) blockers.push("promotion_subject_body_mentions_insufficient");
  if (!openingCovered) blockers.push("promotion_subject_opening_missing");
  if (sectionCoverageRatio < plan.requiredSectionCoverageRatio) blockers.push("promotion_subject_section_coverage");
  if (categories.length < plan.minimumServiceCapabilityCategories) blockers.push("service_capability_coverage");
  if (!roleResponsibilityClear) blockers.push("role_responsibility_unclear");
  return {
    enabled: true,
    narrativeSubjectName: plan.narrativeSubjectName,
    bodySubjectMentions,
    openingCovered,
    distinctCapabilityCategories: categories,
    coreSectionCount: sections.length,
    coveredCoreSectionCount: coveredSections.length,
    uncoveredCoreSectionHeadings,
    sectionCoverageRatio,
    roleResponsibilityClear,
    blockers
  };
}

export function promotionCapabilityLabels(categories: PromotionCapabilityCategory[]) {
  const labels: Record<PromotionCapabilityCategory, string> = {
    diagnosis_consulting: "场景诊断与咨询",
    solution_design: "方案设计与原型搭建",
    integration_delivery: "系统集成、实施与交付",
    training_operations: "培训、持续运营与支持"
  };
  return categories.map((item) => labels[item]);
}
