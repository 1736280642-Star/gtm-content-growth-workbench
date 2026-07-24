import type { WechatHtmlValidationResult } from "./wechat-presentation-contracts";

const forbiddenPatterns = [
  { pattern: /<script\b/i, message: "包含 script 标签" },
  { pattern: /<iframe\b/i, message: "包含 iframe 标签" },
  { pattern: /<link\b/i, message: "包含外部样式 link" },
  { pattern: /<style\b/i, message: "包含 style 标签，公众号正文必须使用内联样式" },
  { pattern: /\son[a-z]+\s*=/i, message: "包含事件处理属性" },
  { pattern: /javascript\s*:/i, message: "包含 javascript URL" }
];

export function validateWechatHtml(html: string): WechatHtmlValidationResult {
  const blockers = forbiddenPatterns.filter((item) => item.pattern.test(html)).map((item) => item.message);
  if (!html.trim()) blockers.push("HTML 正文为空");
  if (!/<section\b/i.test(html) || !/<p\b/i.test(html)) blockers.push("缺少公众号正文基础结构");
  const warnings: string[] = [];
  if (html.length > 500000) warnings.push("HTML 体积较大，写入公众号前建议压缩图片和正文");
  if (/<img\b/i.test(html) && /<img\b(?![^>]*\balt=)/i.test(html)) warnings.push("部分正文图片缺少替代文本");
  return { passed: blockers.length === 0, blockers, warnings, checkedAt: new Date().toISOString() };
}
