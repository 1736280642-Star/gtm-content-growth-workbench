import assert from "node:assert/strict";
import test from "node:test";
import { selectWechatLayout } from "../src/lib/v5/wechat-layout-selector.ts";
import { renderWechatHtml } from "../src/lib/v5/wechat-layout-renderer.ts";
import { validateWechatHtml } from "../src/lib/v5/wechat-layout-validator.ts";
import { hashWechatSource } from "../src/lib/v5/wechat-presentation-service.ts";
import { resolveWeixinArticleContent } from "./lib/wechatsync-content.mjs";

function presentationInput(platformContentType) {
  return {
    draftVersionId: "draft-test",
    title: "企业 AI 内容生产测试",
    markdown: "## 核心判断\n\n正文内容。",
    platformContentType,
    titleCategory: "scenario",
    targetAudience: "企业决策者",
    articleStructureTags: [],
    ctaType: "克制咨询",
    approvedImageRoles: []
  };
}

test("六类公众号内容稳定映射到唯一模板", () => {
  const expected = {
    explicit_product_intro: "official-command",
    explicit_launch_matrix: "official-blueprint",
    implicit_personal_review: "natural-fieldnotes",
    implicit_painpoint_education: "natural-notebook",
    implicit_tool_guide: "natural-column",
    implicit_trend_judgment: "natural-calm"
  };
  for (const [contentType, templateId] of Object.entries(expected)) {
    const first = selectWechatLayout(presentationInput(contentType));
    const replay = selectWechatLayout(presentationInput(contentType));
    assert.equal(first.status, "selected");
    assert.equal(first.selectedTemplateId, templateId);
    assert.deepEqual(replay, first);
  }
});

test("未知内容类型低置信阻断，不转人工挑模板", () => {
  const result = selectWechatLayout(presentationInput("unknown_content_type"));
  assert.equal(result.status, "selection_blocked");
  assert.equal(result.selectedTemplateId, undefined);
  assert.match(result.businessReason, /不会猜测模板/);
});

test("renderer 输出微信内联样式 HTML 并转义不可信标签", () => {
  const html = renderWechatHtml({
    title: "排版测试",
    markdown: "## 判断\n\n<script>alert(1)</script>\n\n- 第一点\n- 第二点",
    templateId: "official-command"
  });
  assert.match(html, /data-wechat-layout="official-command"/);
  assert.match(html, /style="/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.equal(validateWechatHtml(html).passed, true);
  assert.equal(validateWechatHtml("<section><script>alert(1)</script><p>x</p></section>").passed, false);
});

test("renderer 不重复输出与正式标题相同的 Markdown H1", () => {
  const html = renderWechatHtml({ title: "排版测试", markdown: "# 排版测试\n\n正文。", templateId: "natural-calm" });
  assert.equal((html.match(/排版测试/g) || []).length, 1);
  assert.doesNotMatch(html, /># 排版测试</);
});

test("正文变化会改变来源 Hash，使旧呈现不可复用", () => {
  assert.notEqual(hashWechatSource("标题", "正文 A"), hashWechatSource("标题", "正文 B"));
  assert.equal(hashWechatSource("标题", "正文 A"), hashWechatSource("标题", "正文 A"));
});

test("wechat_html 直传，Markdown 保留兼容转换路径", () => {
  const renderer = (value) => `<p>${value}</p>`;
  assert.equal(resolveWeixinArticleContent({ contentFormat: "wechat_html", content: "<section><p>已排版</p></section>" }, renderer), "<section><p>已排版</p></section>");
  assert.equal(resolveWeixinArticleContent({ contentFormat: "markdown", content: "正文" }, renderer), "<p>正文</p>");
});
