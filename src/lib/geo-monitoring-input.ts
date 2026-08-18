export const MAX_MONITORING_QUESTIONS_PER_BATCH = 20;

const listPrefixPattern = /^(?:\d{1,3}\s*[.、)]|[-*•])\s*/;

export function parseMonitoringQuestions(value: string) {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const question = line.trim().replace(listPrefixPattern, "").trim();
    if (!question || seen.has(question)) continue;
    seen.add(question);
    questions.push(question);
  }
  return questions;
}
