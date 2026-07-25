import type {
  ProductionArtifact,
  ProductionContractSnapshot,
  ProductionProviderOutput,
  ProductionSiblingDraft,
  ProductionValidationIssue,
  ProductionValidationResult
} from "./content-production-contracts";

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

function duplicateParagraphs(markdown: string) {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 40 && !value.startsWith("#") && !value.includes("http"));
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

export function validateProductionOutput(input: ValidateProductionOutputInput): ProductionValidationResult {
  const { contract, output } = input;
  const { markdown } = output;
  const policy = contract.validatorPolicy;
  const issues: ProductionValidationIssue[] = [];
  const length = measuredLength(markdown);

  if (markdown.split(/\r?\n/, 1)[0]?.trim() !== `# ${contract.task.title}`) {
    issues.push(issue("title_mismatch", "正文必须以冻结标题作为一级标题。", true));
  }
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
  if (uniqueFactSentences.size < policy.minTraceableFactCount) {
    issues.push(issue("traceable_fact_count_low", `可追溯事实句不足 ${policy.minTraceableFactCount} 条。`, true));
  }
  if (policy.requireHumanBoundary) {
    const boundaryEvidenceIds = new Set(contract.evidencePack.evidenceItems
      .filter((item) => item.conditions.length || item.limitations.length || item.allowedUsage.includes("human_boundary"))
      .map((item) => item.evidenceItemId));
    if (!boundaryEvidenceIds.size || !validTraces.some((trace) => boundaryEvidenceIds.has(trace.evidenceItemId))) {
      issues.push(issue("human_boundary_missing", "正文缺少可追溯的适用条件、限制或人工边界。", true));
    }
  }

  const selectedCtas = contract.ctaPlan.selectedVariants;
  for (const cta of selectedCtas) {
    const labelCount = countOccurrences(markdown, cta.label);
    const urlCount = countOccurrences(markdown, cta.publicUrl);
    if (!labelCount || !urlCount) issues.push(issue("cta_missing", `缺少冻结 CTA：${cta.ctaVariantId}`, true, [cta.ctaVariantId]));
    if (labelCount > 1 || urlCount > 1) issues.push(issue("cta_modified", `CTA 必须逐字出现一次：${cta.ctaVariantId}`, true, [cta.ctaVariantId]));
  }
  const ctaUrlOccurrences = selectedCtas.reduce((total, cta) => total + countOccurrences(markdown, cta.publicUrl), 0);
  if (ctaUrlOccurrences > policy.maxCtaCount) {
    issues.push(issue("cta_limit_exceeded", `CTA 数量超过渠道上限 ${policy.maxCtaCount}。`, true));
  }
  if (policy.requireCtaAtEnd && selectedCtas.length) {
    const earliestCta = Math.min(...selectedCtas.map((cta) => markdown.indexOf(cta.publicUrl)).filter((index) => index >= 0));
    if (Number.isFinite(earliestCta) && earliestCta < markdown.length * 0.7) {
      issues.push(issue("cta_position_invalid", "渠道规则要求 CTA 位于正文结尾区域。", true));
    }
  }

  const allowedUrls = new Set(policy.allowedUrls);
  const invalidUrls = extractUrls(markdown).filter((url) => !allowedUrls.has(url));
  if (invalidUrls.length) issues.push(issue("url_not_allowed", "正文包含未在生产合同中批准的 URL。", true, invalidUrls));
  if (containsSensitiveOutput(markdown)) issues.push(issue("sensitive_output", "正文疑似包含凭证、手机号、私有地址或其他敏感信息。", false));
  const duplicates = duplicateParagraphs(markdown);
  if (duplicates.length) issues.push(issue("duplicate_paragraph", "正文包含大段完全重复内容。", true, duplicates.map((value) => value.slice(0, 80))));
  if (/(?:当然可以|下面是|以下是为你|作为(?:一个)?AI|希望这篇文章)/i.test(markdown)) {
    issues.push(issue("chat_residue", "正文包含模型解释或聊天式残留。", true));
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
