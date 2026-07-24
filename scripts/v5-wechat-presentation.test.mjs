import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { recommendWechatLayout, WECHAT_LAYOUT_TEMPLATES } from "../src/lib/v5/wechat-layout-selector.ts";
import { renderWechatHtml } from "../src/lib/v5/wechat-layout-renderer.ts";
import { validateWechatHtml } from "../src/lib/v5/wechat-layout-validator.ts";
import { hashWechatSource } from "../src/lib/v5/wechat-presentation-service.ts";
import { resolveWechatPlatformKey } from "../src/lib/v5/wechat-presentation-contracts.ts";
import { resolveWeixinArticleContent } from "./lib/wechatsync-content.mjs";

function presentationInput(platformContentType) {
  return {
    draftVersionId: "draft-test",
    title: "企业 AI 内容生产测试",
    markdown: "## 核心判断\n\n正文内容。",
    platformKey: "weixin",
    platformContentType,
    titleCategory: "scenario",
    targetAudience: "企业决策者",
    articleStructureTags: [],
    ctaType: "克制咨询",
    approvedImageRoles: []
  };
}

test("六类公众号内容稳定得到系统推荐，但不产生人工选择", () => {
  const expected = {
    explicit_product_intro: "official-command",
    explicit_launch_matrix: "official-blueprint",
    implicit_personal_review: "natural-fieldnotes",
    implicit_painpoint_education: "natural-notebook",
    implicit_tool_guide: "natural-column",
    implicit_trend_judgment: "natural-calm"
  };
  for (const [contentType, templateId] of Object.entries(expected)) {
    const first = recommendWechatLayout(presentationInput(contentType));
    const replay = recommendWechatLayout(presentationInput(contentType));
    assert.equal(first.status, "recommended");
    assert.equal(first.recommendedTemplateId, templateId);
    assert.equal("selectedTemplateId" in first, false);
    assert.deepEqual(replay, first);
  }
});

test("未知内容类型不预选，仍允许人工查看全部模板", () => {
  const result = recommendWechatLayout(presentationInput("unknown_content_type"));
  assert.equal(result.status, "recommendation_unavailable");
  assert.equal(result.recommendedTemplateId, undefined);
  assert.match(result.businessReason, /人工查看全部模板后选择/);
});

test("只有正式 channel=wechat 映射到公众号发布平台", () => {
  assert.equal(resolveWechatPlatformKey("wechat"), "weixin");
  assert.equal(resolveWechatPlatformKey(" WECHAT "), "weixin");
});

test("发布平台名和相似渠道名不能绕过微信渠道门禁", () => {
  for (const channel of ["weixin", "微信", "微信公众号", "wechat_video", "zhihu", ""]) {
    assert.equal(resolveWechatPlatformKey(channel), undefined);
  }
});

test("模板注册表固定提供八个可选模板", () => {
  assert.equal(WECHAT_LAYOUT_TEMPLATES.length, 8);
  assert.equal(new Set(WECHAT_LAYOUT_TEMPLATES.map((item) => item.templateId)).size, 8);
  assert.equal(WECHAT_LAYOUT_TEMPLATES.every((item) => item.active), true);
});

test("生成图文 HTML 前必须读取当前人工选择", async () => {
  const source = await readFile(new URL("../src/lib/v5/wechat-presentation-service.ts", import.meta.url), "utf8");
  const selectionRead = source.indexOf("readCurrentWechatTemplateSelection(input.draftVersionId, sourceContentHash)");
  const selectionGate = source.indexOf("wechat_template_selection_required", selectionRead);
  const render = source.indexOf("renderWechatHtml({ title: context.title, markdown: context.markdown", selectionRead);
  assert.ok(selectionRead >= 0 && selectionGate > selectionRead && render > selectionGate);
  assert.match(source.slice(selectionRead, render), /selection\.selectedTemplateId/);
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
