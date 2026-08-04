import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkdownBlocks } from "../src/lib/markdown-normalization.ts";

test("normalizes physical and escaped newlines", () => {
  assert.equal(normalizeMarkdownBlocks("第一行\r\n第二行\\n第三行"), "第一行\n第二行\n第三行");
});

test("moves a collapsed heading onto its own block", () => {
  assert.equal(normalizeMarkdownBlocks("开场文字 ## 核心判断"), "开场文字\n\n## 核心判断");
});

test("expands a collapsed bullet list after punctuation", () => {
  assert.equal(normalizeMarkdownBlocks("重点： - 第一项 - 第二项"), "重点：\n- 第一项\n- 第二项");
});

test("does not turn an ordinary inline hyphen into a list", () => {
  assert.equal(normalizeMarkdownBlocks("方案 A - 方案 B 保持并列。"), "方案 A - 方案 B 保持并列。");
});

test("removes invisible spaces without changing established markdown blocks", () => {
  assert.equal(normalizeMarkdownBlocks("# 标题\n\n- 条目一\n- 条目二\u200B"), "# 标题\n\n- 条目一\n- 条目二");
});
