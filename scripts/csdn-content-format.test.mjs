import assert from "node:assert/strict";
import test from "node:test";
import { enforceCsdnContentFields, normalizeCsdnMarkdown, prepareCsdnArticleContent, renderCsdnHtml } from "./lib/csdn-content-format.mjs";

test("moves collapsed headings into independent markdown blocks", () => {
  const result = normalizeCsdnMarkdown("Opening paragraph. ## First section\nDetails. ## Summary");
  assert.equal(result, "Opening paragraph.\n\n## First section\n\nDetails.\n\n## Summary");
});

test("removes a leading H1 that duplicates the platform title", () => {
  const result = normalizeCsdnMarkdown("# Platform title\n\nBody", "Platform title");
  assert.equal(result, "Body");
});

test("does not rewrite markdown-like text inside fenced code", () => {
  const source = "```text\nvalue ## not-a-heading\n```";
  assert.equal(normalizeCsdnMarkdown(source), source);
});

test("expands collapsed numbered items after punctuation", () => {
  const result = normalizeCsdnMarkdown("Conditions: 1. Ready. 2. Verifiable.");
  assert.equal(result, "Conditions:\n1. Ready.\n2. Verifiable.");
});

test("expands collapsed numbered items after Chinese punctuation", () => {
  const result = normalizeCsdnMarkdown("四个条件： 1. 数据就绪。 2. 结果可核验。");
  assert.equal(result, "四个条件：\n1. 数据就绪。\n2. 结果可核验。");
});

test("renders headings, paragraphs, lists, links, and code for CSDN", () => {
  const html = renderCsdnHtml("## Section\n\nParagraph with **bold** and [link](https://example.com).\n\n1. One\n2. Two\n\n```js\nconst ok = true;\n```");
  assert.match(html, /<h3>Section<\/h3>/);
  assert.match(html, /<p>Paragraph with <strong>bold<\/strong> and <a href="https:\/\/example.com">link<\/a>\.<\/p>/);
  assert.match(html, /<ol><li>One<\/li><li>Two<\/li><\/ol>/);
  assert.match(html, /<pre><code class="language-js">const ok = true;<\/code><\/pre>/);
});

test("prepared CSDN HTML never leaks collapsed heading markers", () => {
  const result = prepareCsdnArticleContent({
    title: "Platform title",
    markdown: "# Platform title\n\nOpening. ## Section\n\nText."
  });
  assert.doesNotMatch(result.html, /##\s+Section/);
  assert.match(result.html, /<h3>Section<\/h3>/);
  assert.doesNotMatch(result.html, /<h1>/);
});

test("custom payload cannot replace CSDN markdown and HTML format fields", () => {
  const result = enforceCsdnContentFields(
    { content: "raw markdown ## leaked", markdowncontent: "stale", source: "wrong", status: 2 },
    { title: "Title", markdown: "## Section", html: "<h3>Section</h3>", articleId: "123" }
  );
  assert.equal(result.markdowncontent, "## Section");
  assert.equal(result.content, "<h3>Section</h3>");
  assert.equal(result.source, "pc_mdeditor");
  assert.equal(result.article_id, "123");
  assert.equal(result.id, "123");
  assert.equal(result.is_new, 0);
  assert.equal(result.status, 0);
  assert.equal(result.pubStatus, "publish");
});
