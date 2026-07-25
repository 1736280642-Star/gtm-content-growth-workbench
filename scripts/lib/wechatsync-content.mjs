export function resolveWeixinArticleContent(input, markdownRenderer) {
  const sourceContent = String(input.content || "").trim();
  return input.contentFormat === "wechat_html" ? sourceContent : markdownRenderer(sourceContent);
}
