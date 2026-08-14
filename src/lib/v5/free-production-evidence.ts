import type { DraftSection, FreeProductionSourceExcerpt } from "./free-production-contracts";

const DEFAULT_KNOWLEDGE_LIMIT = 12;
const DEFAULT_MEETING_LIMIT = 8;

function plainExcerpt(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[*#>`_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedExcerpt(value: string) {
  return plainExcerpt(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function queryTerms(value: string) {
  const terms = new Set<string>();
  for (const word of value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) terms.add(word);
  for (const sequence of value.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return terms;
}

function isNoisyKnowledgeExcerpt(value: string) {
  const plain = plainExcerpt(value);
  if (plain.length < 8 || (!/[\p{Script=Han}]/u.test(plain) && plain.length < 18)) return true;
  const imageCount = (value.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
  const linkCount = (value.match(/\[[^\]]+\]\([^)]*\)/g) || []).length;
  if (imageCount >= 2 || (imageCount === 1 && plain.length < 80)) return true;
  if (linkCount >= 3 || (linkCount === 1 && plain.length < 24)) return true;
  if (/^(?:home|products?|solutions?|contact us|typical results|view all use cases|about joto|organization)$/i.test(plain)) return true;
  return false;
}

function relevanceScore(source: FreeProductionSourceExcerpt, terms: Set<string>) {
  const plain = plainExcerpt(source.excerpt).toLocaleLowerCase();
  let score = plain.length >= 40 && plain.length <= 420 ? 4 : plain.length <= 600 ? 2 : 0;
  if (/[\p{Script=Han}]/u.test(plain)) score += 2;
  let matches = 0;
  for (const term of terms) if (plain.includes(term)) matches += 1;
  return score + Math.min(matches, 10) * 3;
}

export function compactFreeProductionSourceExcerpts(
  sources: FreeProductionSourceExcerpt[],
  retrievalQuery = "",
  options: { knowledgeLimit?: number; meetingLimit?: number } = {}
) {
  const knowledgeLimit = options.knowledgeLimit ?? DEFAULT_KNOWLEDGE_LIMIT;
  const meetingLimit = options.meetingLimit ?? DEFAULT_MEETING_LIMIT;
  const seen = new Set<string>();
  const unique = sources.filter((source) => {
    const key = `${source.sourceType}:${normalizedExcerpt(source.excerpt)}`;
    if (!key.split(":")[1] || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const alwaysIncluded = unique.filter((source) => source.sourceType === "human_fact" || source.sourceType === "trend_signal");
  const meetings = unique.filter((source) => source.sourceType === "meeting_text").slice(0, meetingLimit);
  const terms = queryTerms(retrievalQuery);
  const knowledge = unique
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.sourceType === "knowledge" && !isNoisyKnowledgeExcerpt(source.excerpt))
    .sort((left, right) => relevanceScore(right.source, terms) - relevanceScore(left.source, terms) || left.index - right.index)
    .slice(0, knowledgeLimit)
    .map(({ source }) => source);
  return [...knowledge, ...alwaysIncluded, ...meetings];
}

export function normalizeFreeProductionCitations(sections: DraftSection[], sources: FreeProductionSourceExcerpt[]) {
  const allowedSourceIds = new Set(sources.map((source) => source.id));
  return sections.map((section) => {
    const seenClaims = new Set<string>();
    const citations = (Array.isArray(section.citations) ? section.citations : []).flatMap((citation) => {
      const claimText = String(citation?.claimText || "").trim();
      const sourceIds = Array.from(new Set((Array.isArray(citation?.sourceIds) ? citation.sourceIds : []).filter((sourceId) => allowedSourceIds.has(sourceId))));
      const claimKey = claimText.toLocaleLowerCase();
      if (!claimText || !sourceIds.length || seenClaims.has(claimKey)) return [];
      seenClaims.add(claimKey);
      return [{ claimText, sourceIds }];
    }).slice(0, 6);
    return { ...section, citations: citations.length ? citations : undefined };
  });
}

export function citedFreeProductionSourceIds(sections: DraftSection[], sources: FreeProductionSourceExcerpt[]) {
  const allowedSourceIds = new Set(sources.map((source) => source.id));
  return new Set(sections.flatMap((section) => (section.citations || []).flatMap((citation) => citation.sourceIds.filter((sourceId) => allowedSourceIds.has(sourceId)))));
}

export function supportedClaimsFromSections(sections: DraftSection[], sources: FreeProductionSourceExcerpt[]) {
  const normalized = normalizeFreeProductionCitations(sections, sources);
  return Array.from(new Set(normalized.flatMap((section) => (section.citations || []).map((citation) => citation.claimText))));
}
