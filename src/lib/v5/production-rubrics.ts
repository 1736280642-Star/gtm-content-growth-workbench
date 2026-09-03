import type { ProductionContractSnapshot } from "./content-production-contracts";
import type { RagFinalEvidencePack } from "./rag/contracts";
import { assertGeoArticleMission } from "./geo-article-mission-contracts";
import { analyzePromotionSubjectCoverage, promotionCapabilityLabels } from "./promotion-subject-policy";
import { analyzeGovernedFaqCoverage } from "./faq-governance-policy";

export type RubricVerdict = "passed" | "needs_review" | "blocked";

export interface RubricDimensionResult {
  key: string;
  label: string;
  weight: number;
  score: number;
  reasons: string[];
}

export interface BusinessChainRubricResult {
  rubricVersion: "business-chain-rubric.v3";
  verdict: RubricVerdict;
  score: number;
  hardBlockers: string[];
  dimensions: RubricDimensionResult[];
  diagnosis: Array<{
    originStage: "source_governance" | "entity_resolution" | "strategy" | "retrieval" | "evidence" | "prompt_compilation" | "output_validation";
    contributingStages: string[];
    escapeStage: string;
    badcaseType: string;
    recommendedFixStage: string;
  }>;
}

export interface ArticleSemanticJudgeResult {
  rubricVersion: "article-semantic-judge.v2" | "article-semantic-judge.v3" | "article-semantic-judge.v4";
  scores: {
    searchIntentAndTitle: number;
    coreAnswerAndDecisionValue: number;
    geoEntityAssociation: number;
    openingAndMainline: number;
    argumentCausality: number;
    contextualContinuity: number;
    naturalReadability: number;
    titleAndStructure: number;
    channelNaturalness: number;
    promotionSubjectCentrality?: number;
    serviceCapabilityCoverage?: number;
    roleResponsibilityClarity?: number;
    faqGeoUtility?: number;
  };
  blockers: string[];
  reasons: string[];
}

export interface ArticleQualityRubricResult {
  rubricVersion: "article-quality-rubric.v4";
  verdict: "accepted" | "revise" | "rejected";
  score: number;
  hardBlockers: string[];
  dimensions: RubricDimensionResult[];
  semanticJudge?: ArticleSemanticJudgeResult;
}

function bounded(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function weightedScore(dimensions: RubricDimensionResult[]) {
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0) || 1;
  return Math.round(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
}

function dimension(key: string, label: string, weight: number, score: number, reasons: string[] = []): RubricDimensionResult {
  return { key, label, weight, score: bounded(score), reasons };
}

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function containsMeaningful(text: string, value: string) {
  const target = normalized(value);
  if (!target) return true;
  if (normalized(text).includes(target)) return true;
  const terms = value.replace(/(?:应该|应当|需要|如何|怎么|哪些|什么|是否|可以|能够|看)/g, " ")
    .split(/[、，。；：\s]|以及|并且|和|与|及/).map((item) => normalized(item)).filter((item) => item.length >= 3);
  return terms.length ? terms.some((term) => normalized(text).includes(term)) : false;
}

function diagnosis(type: string, originStage: BusinessChainRubricResult["diagnosis"][number]["originStage"], contributingStages: string[], escapeStage: string) {
  return { originStage, contributingStages, escapeStage, badcaseType: type, recommendedFixStage: originStage };
}

export function evaluateBusinessChainRubric(input: {
  contract: ProductionContractSnapshot;
  pack: RagFinalEvidencePack;
}): BusinessChainRubricResult {
  const blockers: string[] = [];
  const diagnoses: BusinessChainRubricResult["diagnosis"] = [];
  try { assertGeoArticleMission(input.contract.geoMission); } catch {
    blockers.push("geo_mission_invalid");
    diagnoses.push(diagnosis("geo_mission_invalid", "strategy", ["prompt_compilation"], "output_validation"));
  }
  const packTask = input.pack.taskSnapshot as Record<string, unknown>;
  const versionAligned = input.contract.governance.geoIntentHash === input.contract.geoMission.geoIntentHash
    && input.contract.governance.entityGraphHash === input.contract.geoMission.entityGraph.graphHash
    && String(packTask.geoIntentHash || "") === input.contract.geoMission.geoIntentHash
    && String(packTask.entityGraphHash || "") === input.contract.geoMission.entityGraph.graphHash;
  if (!versionAligned) {
    blockers.push("geo_context_stale");
    diagnoses.push(diagnosis("stale_pack_used", "evidence", ["prompt_compilation"], "output_validation"));
  }
  const targetAligned = input.contract.task.primaryEntityId === input.contract.geoMission.primaryEntityId
    && input.contract.task.targetEntityIds.includes(input.contract.geoMission.primaryEntityId);
  if (!targetAligned) {
    blockers.push("primary_entity_mismatch");
    diagnoses.push(diagnosis("wrong_product_entity", "entity_resolution", ["strategy", "retrieval"], "output_validation"));
  }
  const unsafeEvidence = input.contract.evidencePack.evidenceItems.filter((item) => {
    const usage = item.evidenceUsage || "product_fact";
    return !input.contract.geoMission.allowedEvidenceUsages.includes(usage)
      || (usage === "product_fact" && item.subjectEntityIds?.length && !item.subjectEntityIds.includes(input.contract.geoMission.primaryEntityId));
  });
  if (unsafeEvidence.length) {
    blockers.push(`research_or_foreign_evidence:${unsafeEvidence.map((item) => item.evidenceItemId).join(",")}`);
    diagnoses.push(diagnosis("research_evidence_promoted_to_fact", "source_governance", ["retrieval", "evidence"], "output_validation"));
  }
  const packClaims = new Set(input.contract.evidencePack.evidenceItems.flatMap((item) => item.claimIds));
  const requiredClaims = input.contract.validatorPolicy.requiredCoreClaimIds;
  const missingClaims = requiredClaims.filter((claimId) => !packClaims.has(claimId));
  if (!requiredClaims.length || missingClaims.length) {
    blockers.push(`required_claim_missing:${missingClaims.join(",") || "none_planned"}`);
    diagnoses.push(diagnosis("slot_missing", "retrieval", ["evidence"], "prompt_compilation"));
  }
  const promotionPlan = input.contract.promotionSubjectPlan;
  const promotionSubjectAligned = promotionPlan.promotionSubjectEntityId === input.contract.geoMission.promotionSubjectEntityId
    && promotionPlan.platformEntityId === input.contract.geoMission.platformEntityId
    && promotionPlan.narrativeSubjectName === input.contract.geoMission.narrativeSubjectName;
  const identityEvidenceReady = !promotionPlan.enabled || promotionPlan.identityClaimIds.length > 0;
  const capabilityClaimCount = new Set(promotionPlan.serviceCapabilityClaims.map((item) => item.claimId)).size;
  const capabilityCategoryCount = new Set(promotionPlan.serviceCapabilityClaims.map((item) => item.category)).size;
  const promotionEvidenceReady = !promotionPlan.enabled
    || (capabilityClaimCount >= promotionPlan.minimumServiceCapabilityClaims
      && capabilityCategoryCount >= promotionPlan.minimumServiceCapabilityCategories);
  if (!promotionSubjectAligned) {
    blockers.push("promotion_subject_mismatch");
    diagnoses.push(diagnosis("promotion_subject_mismatch", "entity_resolution", ["strategy", "prompt_compilation"], "output_validation"));
  }
  if (!identityEvidenceReady) {
    blockers.push("promotion_identity_evidence_missing");
    diagnoses.push(diagnosis("promotion_identity_evidence_missing", "evidence", ["prompt_compilation"], "output_validation"));
  }
  if (!promotionEvidenceReady) {
    blockers.push("promotion_capability_evidence_insufficient");
    diagnoses.push(diagnosis("promotion_capability_evidence_insufficient", "retrieval", ["evidence", "prompt_compilation"], "output_validation"));
  }
  const faqEvidenceById = new Map(input.contract.evidencePack.evidenceItems.map((item) => [item.evidenceItemId, item]));
  const faqCandidateClaims = input.contract.faqPlan.evidenceCandidates.map((item) => item.claimId);
  const invalidFaqCandidates = input.contract.faqPlan.evidenceCandidates.filter((candidate) => {
    const item = faqEvidenceById.get(candidate.evidenceItemId);
    return !item || item.sourceRevisionId !== candidate.sourceRevisionId || !item.claimIds.includes(candidate.claimId);
  });
  const faqEvidenceReady = input.contract.faqPlan.required
    && faqCandidateClaims.length >= input.contract.faqPlan.minimumItems
    && faqCandidateClaims.every((claimId) => packClaims.has(claimId))
    && !invalidFaqCandidates.length;
  if (!faqEvidenceReady) {
    blockers.push("faq_evidence_missing");
    diagnoses.push(diagnosis("faq_evidence_missing", "evidence", ["prompt_compilation"], "output_validation"));
  }
  const missionCompleteness = [
    input.contract.geoMission.primaryQuestion,
    input.contract.geoMission.currentSearchGap,
    input.contract.geoMission.desiredAnswer,
    input.contract.geoMission.articleRole
  ].filter(Boolean).length / 4;
  const relationshipReady = input.contract.geoMission.desiredEntityAssociations.length > 0
    && input.contract.geoMission.entityGraph.nodes.some((item) => item.entityId === input.contract.geoMission.primaryEntityId);
  const dimensions = [
    dimension("entity", "产品与实体正确性", 20, targetAligned && relationshipReady ? 100 : 0, targetAligned ? [] : ["主实体不一致"]),
    dimension("evidence", "证据来源与用途", 20, unsafeEvidence.length ? 0 : 100, unsafeEvidence.map((item) => item.evidenceItemId)),
    dimension("geo_intent", "GEO 目标传递", 20, missionCompleteness * 100, missionCompleteness === 1 ? [] : ["GEO 任务字段不完整"]),
    dimension("retrieval", "检索与 EvidencePack", 15, missingClaims.length || !requiredClaims.length ? 40 : 100, missingClaims),
    dimension("prompt", "Prompt 合同完整性", 15, input.contract.geoMission && input.contract.promptDirectives.length ? 100 : 0),
    dimension("promotion_subject", "推广与叙事主体", 10, promotionSubjectAligned ? 100 : 0, promotionSubjectAligned ? [] : ["推广主体与平台实体未正确拆分"]),
    dimension("promotion_evidence", "推广主体身份与交付证据", 15, identityEvidenceReady && promotionEvidenceReady ? 100 : 0, [
      ...(!identityEvidenceReady ? ["缺少身份 Claim"] : []),
      ...(!promotionEvidenceReady ? [`交付 Claim=${capabilityClaimCount}，能力类别=${capabilityCategoryCount}`] : [])
    ]),
    dimension("faq_evidence", "FAQ知识库答案准备度", 10, faqEvidenceReady ? 100 : 0, faqEvidenceReady ? [] : [
      "没有可追溯FAQ Claim",
      ...invalidFaqCandidates.map((item) => item.evidenceItemId)
    ]),
    dimension("version", "版本与状态一致性", 5, versionAligned ? 100 : 0, versionAligned ? [] : ["GEO 或实体图 Hash 不一致"])
  ];
  const score = weightedScore(dimensions);
  return {
    rubricVersion: "business-chain-rubric.v3",
    verdict: blockers.length ? "blocked" : score >= 90 && dimensions.every((item) => item.score >= 80) ? "passed" : "needs_review",
    score,
    hardBlockers: blockers,
    dimensions,
    diagnosis: diagnoses
  };
}

function opening(markdown: string, excludedTexts: string[] = []) {
  const paragraphs = markdown.split(/\n{2,}/).map((item) => item.trim()).filter((item) => item && !/^#{1,6}\s/.test(item));
  const cleaned = paragraphs.map((item) => excludedTexts.reduce((value, text) => text ? value.replaceAll(text, "") : value, item)
    .replace(/在落地服务关系上[，,]?\s*[。.]?/g, "")
    .trim()).filter(Boolean);
  return cleaned[0] || paragraphs[0] || "";
}

function headingCount(markdown: string) {
  return markdown.split("\n").filter((line) => /^##\s+/.test(line.trim()) && !/^##\s+(?:常见问题|FAQ)\s*$/i.test(line.trim())).length;
}

function titleAndHeadings(markdown: string) {
  return markdown.split("\n").map((line) => line.trim()).filter((line) => /^#{1,6}\s+/.test(line));
}

function objectiveReadabilityIssues(markdown: string) {
  const headings = titleAndHeadings(markdown);
  const issues: string[] = [];
  if (headings.some((line) => /[。.]/.test(line.replace(/^#{1,6}\s+/, "")))) issues.push("title_or_heading_contains_period");
  if (headings.some((line) => /[，,；;：:、]$/.test(line))) issues.push("title_or_heading_bad_terminal_punctuation");
  if (headings.some((line) => (line.match(/[？?]/g) || []).length > 1)) issues.push("title_or_heading_multiple_questions");
  const prose = markdown.replace(/^#{1,6}.+$/gm, "").trim();
  if (/(?:围绕[“\"].+?[”\"]，?下文按|本文将(?:介绍|分析|讨论)|接下来(?:我们)?(?:分析|介绍))/i.test(prose.slice(0, 500))) issues.push("meta_opening");
  if (/(?:这|那|其|这也)?意味着[：:]?[。！？!?]|(?:因此|所以|同时|此外)[，,]?[。！？!?]/.test(prose)) issues.push("sentence_fragment");
  if (/(?:行业报告显示|专家认为|业内人士认为|官方可查|广泛认为)/.test(prose)) issues.push("vague_attribution");
  const formulaicCount = (prose.match(/(?:其核心价值在于|共同构成|形成完整闭环|不仅[^。！？]{0,40}(?:而且|还)|不是[^。！？]{0,40}而是)/g) || []).length;
  if (formulaicCount >= 3) issues.push("formulaic_ai_language");
  return issues;
}

export function buildArticleSemanticJudgePrompt(contract: ProductionContractSnapshot, markdown: string) {
  return `你是独立的中文 GEO 文章质量评测员。只评价文章是否完成冻结任务，不判断或补充产品事实。不要因为结构完整、标题数量正常或事实齐全就给高分；必须逐段检查句子是否自然、相邻段落是否衔接、结论是否由原因和证据推出。严格返回 JSON，不要 Markdown。\n\n冻结任务：\n${JSON.stringify({
    primaryQuestion: contract.geoMission.primaryQuestion,
    articleRole: contract.geoMission.articleRole,
    currentSearchGap: contract.geoMission.currentSearchGap,
    desiredAnswer: contract.geoMission.desiredAnswer,
    desiredEntityAssociations: contract.geoMission.desiredEntityAssociations,
    titlePromiseDimensions: contract.geoMission.titlePromiseDimensions,
    expectedAnswerSummary: contract.geoMission.expectedAnswerSummary,
    entityGraph: contract.geoMission.entityGraph,
    argumentPlan: contract.argumentPlan,
    promotionSubjectPlan: contract.promotionSubjectPlan,
    faqPlan: contract.faqPlan
  })}\n\n评分要求：argumentCausality 检查每个核心判断是否有原因或证据支撑，不能只是能力堆砌；contextualContinuity 检查相邻句、段、章节是否存在指代不明、突然换题或孤立章节；naturalReadability 检查语句是否生硬、残缺、重复、说明书化；titleAndStructure 检查标题和小标题是否自然、无句号乱用且结构服务于论证。promotionSubjectCentrality 必须在忽略固定身份句和 CTA 后判断：推广主体是否仍是开头、核心章节和结论的主要陈述对象，而不是只出现名称。serviceCapabilityCoverage 检查至少两类有证据的交付动作是否融入论证。roleResponsibilityClarity 检查平台方提供产品/底座、服务商负责诊断设计实施运营的分工是否清楚。faqGeoUtility 检查问题是否像真实用户会问、是否与文章主题及知识库答案相关、答案是否先直接回答再给证据；FAQ允许把正文中的已治理事实压缩成可独立提取的搜索问答摘要，不因合理的信息重叠扣分，但不得整段复制正文或引入新主张。服务商选型文章的FAQ至少应有一个问题直接帮助“选择、核对、判断或比较”。若文章实质是平台产品说明、推广主体只在身份句或 CTA 出现，必须加入 blocker“promotion_subject_not_central”；若任一核心章节只有平台能力罗列、没有连接推广主体的执行动作与决策意义，必须加入 blocker“promotion_subject_section_gap”；若FAQ问题空泛、重复、像关键词拼接或答案绕开问题，必须加入 blocker“faq_not_useful”。若存在任何孤立章节、无法解释的结论跳跃或连续两段逻辑断裂，也必须写入 blockers。\n\n文章：\n${markdown}\n\n返回：{"rubricVersion":"article-semantic-judge.v4","scores":{"searchIntentAndTitle":0到100,"coreAnswerAndDecisionValue":0到100,"geoEntityAssociation":0到100,"openingAndMainline":0到100,"promotionSubjectCentrality":0到100,"serviceCapabilityCoverage":0到100,"roleResponsibilityClarity":0到100,"faqGeoUtility":0到100,"argumentCausality":0到100,"contextualContinuity":0到100,"naturalReadability":0到100,"titleAndStructure":0到100,"channelNaturalness":0到100},"blockers":[],"reasons":[]}。`;
}

export function parseArticleSemanticJudge(value: string): ArticleSemanticJudgeResult {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("article_semantic_judge_json_missing");
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<ArticleSemanticJudgeResult>;
  const raw = parsed.scores || {} as ArticleSemanticJudgeResult["scores"];
  const scores = {
    searchIntentAndTitle: bounded(Number(raw.searchIntentAndTitle || 0)),
    coreAnswerAndDecisionValue: bounded(Number(raw.coreAnswerAndDecisionValue || 0)),
    geoEntityAssociation: bounded(Number(raw.geoEntityAssociation || 0)),
    openingAndMainline: bounded(Number(raw.openingAndMainline || 0)),
    argumentCausality: bounded(Number(raw.argumentCausality || 0)),
    contextualContinuity: bounded(Number(raw.contextualContinuity || 0)),
    naturalReadability: bounded(Number(raw.naturalReadability || 0)),
    titleAndStructure: bounded(Number(raw.titleAndStructure || 0)),
    channelNaturalness: bounded(Number(raw.channelNaturalness || 0)),
    promotionSubjectCentrality: bounded(Number(raw.promotionSubjectCentrality || 0)),
    serviceCapabilityCoverage: bounded(Number(raw.serviceCapabilityCoverage || 0)),
    roleResponsibilityClarity: bounded(Number(raw.roleResponsibilityClarity || 0)),
    faqGeoUtility: bounded(Number(raw.faqGeoUtility || 0))
  };
  return {
    rubricVersion: "article-semantic-judge.v4",
    scores,
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String).filter(Boolean).slice(0, 20) : [],
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).filter(Boolean).slice(0, 30) : []
  };
}

export function evaluateArticleQualityRubric(input: {
  contract: ProductionContractSnapshot;
  markdown: string;
  traceableFactCount: number;
  semanticJudge?: ArticleSemanticJudgeResult;
}): ArticleQualityRubricResult {
  const { contract, markdown, semanticJudge } = input;
  const blockers: string[] = [];
  // Fixed identity/CTA text is assembled by the system and is not the
  // author's opening. Judge the first natural paragraph after those blocks.
  const firstParagraph = opening(markdown, (contract.fixedExpressions || []).map((item) => item.text));
  const primaryName = contract.validatorPolicy.entityIdentity.displayName || contract.validatorPolicy.entityIdentity.canonicalName;
  const openingPromiseHits = contract.geoMission.titlePromiseDimensions
    .filter((item) => containsMeaningful(firstParagraph, item)).length;
  const requiredPromiseHits = Math.min(2, contract.geoMission.titlePromiseDimensions.length);
  // A natural lead may omit the product name when the H1 has already established
  // it (for example, “选择服务商时，先核对能力、场景和边界”). Accept that
  // only when the paragraph itself covers multiple frozen title promises. A
  // generic ADP-disambiguation lead still has zero promise hits and is blocked.
  const openingAligned = containsMeaningful(firstParagraph, primaryName)
    || (requiredPromiseHits > 0 && openingPromiseHits >= requiredPromiseHits);
  if (!openingAligned) blockers.push("opening_topic_misaligned");
  const missingDimensions = contract.geoMission.titlePromiseDimensions.filter((item) => !containsMeaningful(markdown, item));
  if (missingDimensions.length) blockers.push(`title_promise_incomplete:${missingDimensions.join("、")}`);
  const missingAssociations = contract.geoMission.entityGraph.canonicalRelationshipStatements.filter((item) => !containsMeaningful(markdown, item));
  if (missingAssociations.length) blockers.push("required_association_missing");
  const forbiddenRelationships = contract.geoMission.entityGraph.forbiddenRelationshipStatements.filter((item) => normalized(markdown).includes(normalized(item)));
  if (forbiddenRelationships.length) blockers.push("entity_graph_violation");
  const answerExtractable = containsMeaningful(markdown.slice(0, 1800), contract.geoMission.desiredAnswer)
    || contract.geoMission.expectedAnswerSummary.some((item) => containsMeaningful(markdown.slice(0, 1800), item));
  if (!answerExtractable) blockers.push("desired_answer_not_extractable");
  if (semanticJudge?.blockers.length) blockers.push(...semanticJudge.blockers.map((item) => `semantic:${item}`));
  if (!semanticJudge && blockers.length === 0) blockers.push("semantic_judge_missing");
  const headings = headingCount(markdown);
  const readabilityIssues = objectiveReadabilityIssues(markdown);
  if (readabilityIssues.length) blockers.push(...readabilityIssues);
  const promotionCoverage = analyzePromotionSubjectCoverage(markdown, contract);
  if (promotionCoverage.blockers.length) blockers.push(...promotionCoverage.blockers);
  const faqCoverage = analyzeGovernedFaqCoverage({ markdown, contract });
  if (contract.faqPlan.required && !faqCoverage.sectionFound) blockers.push("faq_required_missing");
  if (faqCoverage.sectionFound && (faqCoverage.itemCount < contract.faqPlan.minimumItems
    || faqCoverage.itemCount > contract.faqPlan.maximumItems)) blockers.push("faq_item_count_invalid");
  if (faqCoverage.duplicateQuestions.length) blockers.push("faq_duplicate");
  if (faqCoverage.misalignedQuestions.length) blockers.push("faq_topic_misaligned");
  if (faqCoverage.sectionFound && !faqCoverage.positionedBeforeCta) blockers.push("faq_position_invalid");
  const faqStructurePassed = faqCoverage.sectionFound
    && faqCoverage.itemCount >= contract.faqPlan.minimumItems
    && faqCoverage.itemCount <= contract.faqPlan.maximumItems
    && !faqCoverage.duplicateQuestions.length
    && !faqCoverage.misalignedQuestions.length
    && faqCoverage.positionedBeforeCta;
  const deterministic = {
    searchIntentAndTitle: missingDimensions.length ? 45 : 100,
    coreAnswerAndDecisionValue: answerExtractable ? 100 : 45,
    geoEntityAssociation: forbiddenRelationships.length || missingAssociations.length ? 0 : 100,
    openingAndMainline: openingAligned ? 100 : 35,
    argumentCausality: 100,
    contextualContinuity: 100,
    naturalReadability: readabilityIssues.length ? 45 : 100,
    titleAndStructure: headings >= 3 && headings <= 6 && !readabilityIssues.some((item) => item.startsWith("title_or_heading")) ? 100 : 60,
    channelNaturalness: /\b(EvidenceItem|Claim ID|SourceRevision|JSON)\b/i.test(markdown) ? 0 : 100,
    promotionSubjectCentrality: promotionCoverage.enabled
      ? Math.min(100, Math.round((promotionCoverage.sectionCoverageRatio * 70) + Math.min(30, promotionCoverage.bodySubjectMentions * 10)))
      : 100,
    serviceCapabilityCoverage: promotionCoverage.enabled
      ? Math.min(100, promotionCoverage.distinctCapabilityCategories.length * 50)
      : 100,
    roleResponsibilityClarity: promotionCoverage.roleResponsibilityClear ? 100 : 0,
    faqGeoUtility: faqStructurePassed ? 100 : 0
  };
  const semantic = semanticJudge?.scores;
  const scoreFor = (key: keyof typeof deterministic) => {
    if (!semantic) return deterministic[key];
    const semanticScore = semantic[key as keyof ArticleSemanticJudgeResult["scores"]];
    return Math.min(deterministic[key], typeof semanticScore === "number" ? semanticScore : deterministic[key]);
  };
  const dimensions = [
    dimension("search_intent", "搜索意图与标题承诺", 8, scoreFor("searchIntentAndTitle"), missingDimensions),
    dimension("core_answer", "核心答案与决策价值", 8, scoreFor("coreAnswerAndDecisionValue"), answerExtractable ? [] : ["无法提取预期答案"]),
    dimension("geo_entity", "GEO 实体关联效果", 8, scoreFor("geoEntityAssociation"), [...missingAssociations, ...forbiddenRelationships]),
    dimension("fact_evidence", "事实与证据边界", 8, input.traceableFactCount > 0 ? 100 : 0, input.traceableFactCount > 0 ? [] : ["没有可追溯事实"]),
    dimension("promotion_subject_centrality", "推广主体中心度", 15, scoreFor("promotionSubjectCentrality"), promotionCoverage.blockers),
    dimension("service_capability_coverage", "服务交付能力覆盖", 12, scoreFor("serviceCapabilityCoverage"), promotionCapabilityLabels(promotionCoverage.distinctCapabilityCategories)),
    dimension("role_responsibility_clarity", "平台与服务商职责分工", 7, scoreFor("roleResponsibilityClarity"), promotionCoverage.roleResponsibilityClear ? [] : ["平台底座与实施交付职责不清"]),
    dimension("faq_geo", "FAQ搜索问答价值", 8, scoreFor("faqGeoUtility"), [
      ...(!faqCoverage.sectionFound ? ["缺少常见问题"] : []),
      ...faqCoverage.duplicateQuestions,
      ...faqCoverage.misalignedQuestions,
      ...(!faqCoverage.positionedBeforeCta ? ["FAQ位置不正确"] : [])
    ]),
    dimension("argument_causality", "论证因果链", 14, scoreFor("argumentCausality")),
    dimension("contextual_continuity", "上下文连续性", 8, scoreFor("contextualContinuity")),
    dimension("natural_readability", "自然表达与可读性", 7, scoreFor("naturalReadability"), readabilityIssues),
    dimension("title_structure", "标题标点与结构", 3, scoreFor("titleAndStructure"), headings >= 3 && headings <= 6 ? readabilityIssues : [`二级标题数量=${headings}`]),
    dimension("channel", "渠道表达与自然度", 2, scoreFor("channelNaturalness"))
  ];
  const score = weightedScore(dimensions);
  const coreBelowThreshold = dimensions.filter((item) => item.weight >= 10).some((item) => item.score < 80);
  return {
    rubricVersion: "article-quality-rubric.v4",
    verdict: blockers.length
      ? "rejected"
      : score >= 90 && !coreBelowThreshold
        && dimensions.find((item) => item.key === "argument_causality")!.score >= 85
        && dimensions.find((item) => item.key === "contextual_continuity")!.score >= 85
        && dimensions.find((item) => item.key === "natural_readability")!.score >= 80
        ? "accepted"
        : "revise",
    score,
    hardBlockers: Array.from(new Set(blockers)),
    dimensions,
    semanticJudge
  };
}
