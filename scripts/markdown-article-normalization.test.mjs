import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkdownBlocks } from "../src/lib/markdown-normalization.ts";
import { parseMarkdownTable } from "../src/lib/markdown-table.ts";

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

test("parses a standard GFM table without flattening rows", () => {
  const lines = normalizeMarkdownBlocks("| 服务阶段 | 核心动作 | 价值与边界 |\n|---|:---:|---:|\n| 方案设计 | 场景诊断 | 明确边界 |").split("\n");
  const table = parseMarkdownTable(lines, 0);
  assert.deepEqual(table, {
    headers: ["服务阶段", "核心动作", "价值与边界"],
    alignments: ["left", "center", "right"],
    rows: [["方案设计", "场景诊断", "明确边界"]],
    nextIndex: 3
  });
});

test("keeps an escaped pipe inside a markdown table cell", () => {
  const table = parseMarkdownTable(["| 能力 | 说明 |", "|---|---|", "| RAG \\| Workflow | 可组合 |"], 0);
  assert.equal(table?.rows[0][0], "RAG | Workflow");
});
