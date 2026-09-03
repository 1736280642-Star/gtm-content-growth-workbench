export function ensureNarrativeSubjectTitle(input: {
  title: string;
  productName: string;
  narrativeSubjectName: string;
  narrativeSubjectRole: "target_product" | "service_provider";
}) {
  const title = input.title.trim();
  if (input.narrativeSubjectRole !== "service_provider" || title.includes(input.narrativeSubjectName)) return title;
  if (/服务商|实施伙伴|交付伙伴/.test(title)) {
    return `${input.productName}服务商怎么选：${input.narrativeSubjectName}的公开服务能力、适用场景与职责边界`;
  }
  if (/AgentOps|全生命周期/i.test(title)) {
    return `${input.narrativeSubjectName}如何基于${input.productName}落地AgentOps：全生命周期环节与职责分工`;
  }
  if (/行业解决方案|行业方案|行业积累|成熟度/.test(title)) {
    return `${input.narrativeSubjectName}的${input.productName}行业解决方案成熟度：垂直方案与落地积累`;
  }
  return `${input.narrativeSubjectName}解读${title}`;
}
