import type {
  ProductionArtifact,
  ProductionContractSnapshot,
  ProductionProviderOutput,
  ProductionSiblingDraft,
  ProductionValidationIssue,
  ProductionValidationResult
} from "./content-production-contracts";
import { findHumanWritingWechatIssues, isWechatContentChannel } from "./human-writing-wechat";
import { entityRelationshipBlockers, missingRequiredCoreClaimIds } from "./production-fact-gates";
import { analyzePromotionSubjectCoverage } from "./promotion-subject-policy";
import { analyzeGovernedFaqCoverage } from "./faq-governance-policy";

export interface ValidateProductionOutputInput {
  contract: ProductionContractSnapshot;
  output: ProductionProviderOutput;
  siblingDrafts?: ProductionSiblingDraft[];
}

function issue(code: ProductionValidationIssue["code"], message: string, repairable: boolean, details?: string[]): ProductionValidationIssue {
  return { code, message, repairable, ...(details?.length ? { details } : {}) };
}

function markdownText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function measuredLength(markdown: string) {
  return Array.from(markdownText(markdown).replace(/\s/g, "")).length;
}

function extractUrls(markdown: string) {
  const matches = markdown.match(/https:\/\/[^\s)\]}，。；;]+/g) || [];
  return matches.map((value) => value.replace(/[.,!?]+$/g, ""));
}

function countOccurrences(text: string, value: string) {
  if (!value) return 0;
  let count = 0;
  let start = 0;
  while ((start = text.indexOf(value, start)) >= 0) {
    count += 1;
    start += value.length;
  }
  return count;
}

function fixedExpressionZones(markdown: string) {
  const firstHeading = markdown.indexOf("\n## ");
  const lastHeading = markdown.lastIndexOf("\n## ");
  const openingEnd = firstHeading >= 0 ? firstHeading : Math.floor(markdown.length * 0.25);
  const endingStart = lastHeading > firstHeading ? lastHeading : Math.floor(markdown.length * 0.7);
  return {
    opening: markdown.slice(markdown.indexOf("\n") + 1, openingEnd),
    body: markdown.slice(openingEnd, endingStart),
    ending: markdown.slice(endingStart)
  };
}

function hasArtifact(markdown: string, artifact: ProductionArtifact) {
  if (artifact === "table") return /^\s*\|.+\|\s*$/m.test(markdown) && /^\s*\|?\s*:?-{3,}/m.test(markdown);
  if (artifact === "list") return /^\s*(?:[-*+] |\d+\. )\S+/m.test(markdown);
  if (artifact === "state_flow") return /(?:->|→|```mermaid|flowchart|stateDiagram)/i.test(markdown);
  return /```[^\n]*\n[\s\S]+?```/.test(markdown);
}

function normalizeComparable(markdown: string, contract: ProductionContractSnapshot) {
  let value = markdown.toLocaleLowerCase();
  for (const cta of contract.ctaPlan.selectedVariants) {
    value = value.split(cta.label.toLocaleLowerCase()).join(" ");
    value = value.split(cta.publicUrl.toLocaleLowerCase()).join(" ");
  }
  return value
    .replace(/https:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function shingles(value: string, width = 6) {
  const result = new Set<string>();
  if (value.length < width) return result;
  for (let index = 0; index <= value.length - width; index += 1) result.add(value.slice(index, index + width));
  return result;
}

function similarity(left: string, right: string) {
  const leftSet = shingles(left);
  const rightSet = shingles(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function duplicateParagraphs(markdown: string, ignoredExactTexts: string[] = []) {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 40 && !value.startsWith("#") && !value.includes("http") && !ignoredExactTexts.includes(value));
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const paragraph of paragraphs) {
    if (seen.has(paragraph)) duplicates.add(paragraph);
    seen.add(paragraph);
  }
  return Array.from(duplicates);
}

function containsSensitiveOutput(markdown: string) {
  const patterns = [
    /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
    /\b1[3-9]\d{9}\b/,
    /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  ];
  return patterns.some((pattern) => pattern.test(markdown));
}

function deterministicWritingIssues(markdown: string, entityName: string) {
  const issues: ProductionValidationIssue[] = [];
  const headings = markdown.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^#{1,6}\s+/.test(line));
  if (headings.some((line) => /[。.]/.test(line.replace(/^#{1,6}\s+/, ""))
    || /[，,；;：:、]$/.test(line)
    || (line.match(/[？?]/g) || []).length > 1)) {
    issues.push(issue("title_heading_punctuation", "标题或小标题存在句号、异常结尾标点或多个问号。", true));
  }
  const opening = markdown.split(/\n{2,}/).map((item) => item.trim()).find((item) => item && !/^#{1,6}\s+/.test(item)) || "";
  if (/(?:围绕[“\"].+?[”\"]，?下文按|本文将(?:介绍|分析|讨论)|接下来(?:我们)?(?:分析|介绍))/i.test(opening)) {
    issues.push(issue("meta_opening", "开头不得使用面向写作者的元叙事。", true));
  }
  const entityIndex = markdown.indexOf(entityName);
  const pronounIndex = markdown.search(/(?:^|\n\n)(?:它|该平台|这一产品|其)(?:[，,。\s])/m);
  if (pronounIndex >= 0 && (entityIndex < 0 || pronounIndex < entityIndex)) {
    issues.push(issue("pronoun_before_entity", "目标产品首次出现前不得使用指代词。", true));
  }
  if (/(?:这|那|其|这也)?意味着[：:]?[。！？!?]|(?:因此|所以|同时|此外)[，,]?[。！？!?]/.test(markdown)) {
    issues.push(issue("sentence_fragment", "正文包含残句或只有连接词的句子。", true));
  }
  if (/(?:行业报告显示|专家认为|业内人士认为|官方可查|广泛认为)/.test(markdown)) {
    issues.push(issue("human_writing_style", "正文包含没有明确来源的模糊归因。", true));
  }
  const formulaicCount = (markdown.match(/(?:其核心价值在于|共同构成|形成完整闭环|不仅[^。！？]{0,40}(?:而且|还)|不是[^。！？]{0,40}而是)/g) || []).length;
  if (formulaicCount >= 3) {
    issues.push(issue("human_writing_style", "正文公式化营销句式过于密集。", true, [`命中=${formulaicCount}`]));
  }
  return issues;
}

export function validateProductionOutput(input: ValidateProductionOutputInput): ProductionValidationResult {
  const { contract, output } = input;
  const { markdown } = output;
  const policy = contract.validatorPolicy;
  const issues: ProductionValidationIssue[] = [];
  const length = measuredLength(markdown);

  if (markdown.split(/\r?\n/, 1)[0]?.trim() !== `# ${contract.task.title}`) {
    issues.push(issue("title_mismatch", "正文必须以冻结标题作为一级标题。", true));
  }
  issues.push(...deterministicWritingIssues(markdown, policy.entityIdentity.displayName || policy.entityIdentity.canonicalName));
  if (length < policy.minLength || length > policy.maxLength) {
    issues.push(issue("length_out_of_range", `正文长度 ${length} 不在 ${policy.minLength}-${policy.maxLength} 范围内。`, true));
  }
  for (const section of policy.requiredSections) {
    if (!(markdown.match(/^##\s+.+$/gm) || []).some((heading) => heading.includes(section))) {
      issues.push(issue("required_section_missing", `缺少必需章节：${section}`, true, [section]));
    }
  }
  for (const artifact of policy.requiredArtifacts) {
    if (!hasArtifact(markdown, artifact)) {
      issues.push(issue("required_artifact_missing", `缺少必需内容载体：${artifact}`, true, [artifact]));
    }
  }
  for (const term of policy.prohibitedTerms) {
    if (term.length >= 2 && markdown.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
      issues.push(issue("prohibited_term", `正文包含禁止表达：${term}`, true, [term]));
    }
  }

  const evidenceById = new Map(contract.evidencePack.evidenceItems.map((item) => [item.evidenceItemId, item]));
  const validTraces = output.factTraces.filter((trace) => {
    const evidence = evidenceById.get(trace.evidenceItemId);
    return Boolean(
      evidence
      && markdown.includes(trace.sentence)
      && trace.sourceRevisionId === evidence.sourceRevisionId
      && evidence.claimIds.includes(trace.claimId)
    );
  });
  if (validTraces.length !== output.factTraces.length) {
    issues.push(issue("fact_trace_invalid", "factTraces 包含无法匹配正文或 EvidencePack 的记录。", true));
  }
  const uniqueFactSentences = new Set(validTraces.map((trace) => trace.sentence));
  const missingCoreClaims = missingRequiredCoreClaimIds(policy.requiredCoreClaimIds, validTraces.map((trace) => trace.claimId));
  if (missingCoreClaims.length) {
    issues.push(issue("core_claim_missing", "当前选题的核心 Claim 未覆盖。", true, missingCoreClaims));
  }
  const relationshipBlockers = entityRelationshipBlockers(markdown, policy.entityIdentity);
  if (relationshipBlockers.length) {
    issues.push(issue("entity_relationship_invalid", "产品身份或实体关系不正确。", true, relationshipBlockers));
  }
  const promotionCoverage = analyzePromotionSubjectCoverage(markdown, contract);
  for (const blocker of promotionCoverage.blockers) {
    if (blocker === "promotion_subject_missing"
      || blocker === "promotion_subject_body_mentions_insufficient"
      || blocker === "promotion_subject_opening_missing") {
      issues.push(issue("promotion_subject_missing", `正文没有把 ${promotionCoverage.narrativeSubjectName} 作为持续叙事主体。`, true, [blocker]));
    } else if (blocker === "promotion_subject_section_coverage") {
      issues.push(issue(
        "promotion_subject_section_coverage",
        "核心章节必须同时说明推广主体的执行动作及其对企业判断的意义。",
        true,
        [`${promotionCoverage.coveredCoreSectionCount}/${promotionCoverage.coreSectionCount}`]
      ));
    } else if (blocker === "service_capability_coverage") {
      issues.push(issue("service_capability_coverage", "正文覆盖的推广主体交付能力类别不足。", true, promotionCoverage.distinctCapabilityCategories));
    } else if (blocker === "role_responsibility_unclear") {
      issues.push(issue("role_responsibility_unclear", "正文没有清楚区分平台底座与推广主体的实施交付职责。", true));
    }
  }

  const faqCoverage = analyzeGovernedFaqCoverage({ markdown, contract, validTraces });
  if (contract.faqPlan.required && !faqCoverage.sectionFound) {
    issues.push(issue("faq_required_missing", "GEO 正式文章缺少常见问题章节。", true));
  }
  if (faqCoverage.sectionFound && (faqCoverage.itemCount < contract.faqPlan.minimumItems
    || faqCoverage.itemCount > contract.faqPlan.maximumItems)) {
    issues.push(issue(
      "faq_item_count_invalid",
      `FAQ 数量必须为 ${contract.faqPlan.minimumItems}-${contract.faqPlan.maximumItems} 个。`,
      true,
      [`当前=${faqCoverage.itemCount}`]
    ));
  }
  if (faqCoverage.sectionFound && !faqCoverage.items.length) {
    issues.push(issue("faq_question_format_invalid", "FAQ 必须使用“Q：问题 / A：回答”的完整问答格式。", true));
  }
  if (faqCoverage.untracedQuestions.length) {
    issues.push(issue("faq_answer_untraced", "每个 FAQ 答案都必须使用 FAQ 计划允许的知识库 Claim。", true, faqCoverage.untracedQuestions));
  }
  if (faqCoverage.misalignedQuestions.length) {
    issues.push(issue("faq_topic_misaligned", "FAQ 问题必须与文章主题、推广主体或知识库答案相关。", true, faqCoverage.misalignedQuestions));
  }
  if (faqCoverage.duplicateQuestions.length) {
    issues.push(issue("faq_duplicate", "FAQ 包含重复问题。", true, faqCoverage.duplicateQuestions));
  }
  if (faqCoverage.sectionFound && !faqCoverage.positionedBeforeCta) {
    issues.push(issue("faq_position_invalid", "常见问题必须是最后一个正文二级章节，并位于 CTA 之前。", true));
  }

  const selectedCtas = contract.ctaPlan.selectedVariants;
  for (const cta of selectedCtas) {
    const labelCount = countOccurrences(markdown, cta.label);
    const urlCount = countOccurrences(markdown, cta.publicUrl);
    if (!labelCount || !urlCount) issues.push(issue("cta_missing", `缺少冻结 CTA：${cta.ctaVariantId}`, true, [cta.ctaVariantId]));
    if (labelCount > 1 || urlCount > 1) issues.push(issue("cta_modified", `CTA 必须逐字出现一次：${cta.ctaVariantId}`, true, [cta.ctaVariantId]));
  }

  const zones = fixedExpressionZones(markdown);
  for (const fixed of contract.fixedExpressions || []) {
    const occurrenceCount = countOccurrences(markdown, fixed.text);
    if (!occurrenceCount) {
      issues.push(issue("fixed_expression_missing", "正文缺少冻结的固定文案。", true, [fixed.text]));
      continue;
    }
    if (occurrenceCount !== fixed.positions.length) {
      issues.push(issue("fixed_expression_count_invalid", `固定文案必须逐字出现 ${fixed.positions.length} 次。`, true, [fixed.text]));
    }
    for (const position of fixed.positions) {
      if (!zones[position].includes(fixed.text)) {
        issues.push(issue("fixed_expression_position_invalid", `固定文案未出现在指定位置：${position}。`, true, [fixed.text, position]));
      }
    }
  }
  const ctaUrlOccurrences = selectedCtas.reduce((total, cta) => total + countOccurrences(markdown, cta.publicUrl), 0);
  if (ctaUrlOccurrences > policy.maxCtaCount) {
    issues.push(issue("cta_limit_exceeded", `CTA 数量超过渠道上限 ${policy.maxCtaCount}。`, true));
  }
  if (policy.requireCtaAtEnd && selectedCtas.length) {
    const lastBlock = markdown.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).at(-1) || "";
    if (!selectedCtas.every((cta) => lastBlock.includes(cta.publicUrl))) {
      issues.push(issue("cta_position_invalid", "渠道规则要求 CTA 位于正文结尾区域。", true));
    }
  }

  const allowedUrls = new Set(policy.allowedUrls);
  const invalidUrls = extractUrls(markdown).filter((url) => !allowedUrls.has(url));
  if (invalidUrls.length) issues.push(issue("url_not_allowed", "正文包含未在生产合同中批准的 URL。", true, invalidUrls));
  if (containsSensitiveOutput(markdown)) issues.push(issue("sensitive_output", "正文疑似包含凭证、手机号、私有地址或其他敏感信息。", false));
  const duplicates = duplicateParagraphs(markdown, (contract.fixedExpressions || []).map((item) => item.text));
  if (duplicates.length) issues.push(issue("duplicate_paragraph", "正文包含大段完全重复内容。", true, duplicates.map((value) => value.slice(0, 80))));
  if (/(?:当然可以|下面是|以下是为你|作为(?:一个)?AI|希望这篇文章)/i.test(markdown)) {
    issues.push(issue("chat_residue", "正文包含模型解释或聊天式残留。", true));
  }
  if (isWechatContentChannel(contract.task.channel)) {
    const styleIssues = findHumanWritingWechatIssues(markdown);
    if (styleIssues.length) issues.push(issue("human_writing_style", "公众号正文未通过 human-writing 成稿检查。", true, styleIssues));
  }

  const comparable = normalizeComparable(markdown, contract);
  let maxCrossChannelSimilarity = 0;
  for (const sibling of input.siblingDrafts || []) {
    if (sibling.channel === contract.task.channel) continue;
    maxCrossChannelSimilarity = Math.max(maxCrossChannelSimilarity, similarity(comparable, normalizeComparable(sibling.markdown, contract)));
  }
  if (maxCrossChannelSimilarity > policy.crossChannelSimilarityThreshold) {
    issues.push(issue(
      "cross_channel_similarity",
      `跨渠道正文相似度 ${maxCrossChannelSimilarity.toFixed(3)} 超过阈值 ${policy.crossChannelSimilarityThreshold.toFixed(3)}。`,
      true
    ));
  }

  return {
    passed: issues.length === 0,
    issues,
    measuredLength: length,
    traceableFactCount: uniqueFactSentences.size,
    maxCrossChannelSimilarity
  };
}
