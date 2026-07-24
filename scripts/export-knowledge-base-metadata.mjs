import fs from "node:fs";
import path from "node:path";

const statePath = path.resolve("data/workbench-state.json");
const outDir = path.resolve(
  "docs/V5 07-07/workflow-agent-content-production-system/assets/01-knowledge-base-layer",
);

const raw = fs.readFileSync(statePath, "utf8");
const state = JSON.parse(raw);
const knowledgeBases = Array.isArray(state.knowledgeBases) ? state.knowledgeBases : [];
const exportedAt = new Date().toISOString();

const excludedFields = new Set([
  "rawText",
  "extractedText",
  "markdown",
  "contentPreview",
  "content",
  "embeddingVector",
]);

const typeLabel = {
  brand: "品牌事实库",
  official_blog: "官网博客知识库",
  url: "URL 来源资料",
  unknown: "未标记类型",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeFileName(value) {
  return String(value || "unknown")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unknown";
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function frontmatter(obj) {
  return [
    "---",
    ...Object.entries(obj).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
  ].join("\n");
}

function writeMarkdown(relativePath, content) {
  const filePath = path.join(outDir, relativePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${content.replace(/\n{3,}/g, "\n\n").trim()}\n`, "utf8");
}

function sourceTypeOf(source) {
  return source.type || source.sourceType || source.kind || source.importType || "unknown";
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function visibleValue(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") return Object.keys(value).join(", ");
  return value;
}

function objectRows(obj, keys) {
  return keys
    .filter((key) => !excludedFields.has(key))
    .filter((key) => obj[key] !== undefined && obj[key] !== null && obj[key] !== "")
    .map((key) => [key, visibleValue(obj[key])]);
}

function kbBaseName(kb) {
  return `${safeFileName(kb.type)}--${safeFileName(kb.name)}--${safeFileName(kb.id)}.md`;
}

ensureDir(outDir);
for (const subdir of [
  "knowledge-base-types",
  "source-types",
  "knowledge-bases",
  "sources-by-knowledge-base",
  "chunks-by-knowledge-base",
]) {
  ensureDir(path.join(outDir, subdir));
}

const allSources = knowledgeBases.flatMap((kb) =>
  (kb.sources || []).map((source) => ({ kb, source })),
);
const allChunks = knowledgeBases.flatMap((kb) =>
  (kb.chunks || []).map((chunk) => ({ kb, chunk })),
);

const knowledgeBaseTypeCounts = countBy(knowledgeBases, (kb) => kb.type);
const sourceTypeCounts = countBy(allSources, ({ source }) => sourceTypeOf(source));

writeMarkdown(
  "README.md",
  `# 知识库资料元数据导出

${frontmatter({
  exportedAt,
  sourceState: statePath,
  knowledgeBaseCount: knowledgeBases.length,
  sourceCount: allSources.length,
  chunkCount: allChunks.length,
  contentPolicy: "metadata_only_no_raw_content_no_vectors",
})}

## 导出结论

本目录是当前工作台知识库资料的元数据快照，用于 V5 workflow-agent 内容生产系统的知识库层资产盘点。导出只包含来源、状态、时间、切片和向量化状态等元数据，不包含正文、原始抓取内容、Markdown 正文、模型 trace、密钥或 embedding 向量。

## 文件结构

${markdownTable(
  ["路径", "用途"],
  [
    ["00-export-summary.md", "全量统计和知识库总表"],
    ["knowledge-base-types/", "按知识库类型归档"],
    ["source-types/", "按来源资料类型归档"],
    ["knowledge-bases/", "每个知识库一份元数据卡片"],
    ["sources-by-knowledge-base/", "每个知识库的来源资料清单"],
    ["chunks-by-knowledge-base/", "每个知识库的切片元数据清单"],
  ],
)}

## 当前统计

${markdownTable(
  ["指标", "数量"],
  [
    ["知识库", knowledgeBases.length],
    ["来源资料", allSources.length],
    ["切片", allChunks.length],
  ],
)}`,
);

writeMarkdown(
  "00-export-summary.md",
  `# 知识库资料元数据总览

${frontmatter({ exportedAt, sourceState: statePath })}

## 总体统计

${markdownTable(
  ["指标", "数量"],
  [
    ["知识库总数", knowledgeBases.length],
    ["来源资料总数", allSources.length],
    ["切片总数", allChunks.length],
  ],
)}

## 知识库类型分布

${markdownTable(
  ["类型", "说明", "知识库数"],
  Object.entries(knowledgeBaseTypeCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => [type, typeLabel[type] || type, count]),
)}

## 来源资料类型分布

${markdownTable(
  ["类型", "说明", "资料数"],
  Object.entries(sourceTypeCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => [type, typeLabel[type] || type, count]),
)}

## 知识库总表

${markdownTable(
  [
    "ID",
    "名称",
    "类型",
    "类型说明",
    "状态",
    "信任级别",
    "来源模式",
    "入口 URL",
    "来源数",
    "切片数",
    "向量化状态",
    "Embedding 模型",
    "最后同步时间",
  ],
  knowledgeBases.map((kb) => [
    kb.id,
    kb.name,
    kb.type,
    typeLabel[kb.type] || kb.type,
    kb.status,
    kb.trustLevel,
    kb.sourceType,
    kb.sourceUrl || "",
    (kb.sources || []).length,
    (kb.chunks || []).length,
    kb.vectorizationStatus,
    kb.embeddingModel || "",
    kb.lastSyncedAt || "",
  ]),
)}

## 数据边界

- 已排除字段：\`rawText\`、\`extractedText\`、\`markdown\`、\`contentPreview\`、\`content\`、\`embeddingVector\`。
- 保留字段：ID、名称、类型、状态、URL、抓取 Provider、时间、Hash、切片数量、向量化状态和规则包概要。
- 目的：支持 V5 资产层盘点和后续 workflow agent 设计，不作为全文知识库备份。`,
);

const knowledgeBasesByType = {};
for (const kb of knowledgeBases) {
  const type = kb.type || "unknown";
  knowledgeBasesByType[type] ||= [];
  knowledgeBasesByType[type].push(kb);
}

for (const [type, list] of Object.entries(knowledgeBasesByType)) {
  writeMarkdown(
    `knowledge-base-types/${safeFileName(type)}.md`,
    `# ${typeLabel[type] || type}

${frontmatter({
  exportedAt,
  type,
  knowledgeBaseCount: list.length,
  sourceCount: list.reduce((total, kb) => total + (kb.sources || []).length, 0),
  chunkCount: list.reduce((total, kb) => total + (kb.chunks || []).length, 0),
})}

## 类型下知识库

${markdownTable(
  ["ID", "名称", "状态", "信任级别", "使用范围", "入口 URL", "来源数", "切片数", "向量化状态", "最后同步时间"],
  list.map((kb) => [
    kb.id,
    kb.name,
    kb.status,
    kb.trustLevel,
    kb.usageScope,
    kb.sourceUrl || "",
    (kb.sources || []).length,
    (kb.chunks || []).length,
    kb.vectorizationStatus,
    kb.lastSyncedAt || "",
  ]),
)}`,
  );
}

const sourcesByType = {};
for (const item of allSources) {
  const type = sourceTypeOf(item.source);
  sourcesByType[type] ||= [];
  sourcesByType[type].push(item);
}

for (const [type, items] of Object.entries(sourcesByType)) {
  writeMarkdown(
    `source-types/${safeFileName(type)}.md`,
    `# ${typeLabel[type] || type}

${frontmatter({ exportedAt, type, sourceCount: items.length })}

## 来源资料清单

${markdownTable(
  ["来源 ID", "所属知识库", "知识库类型", "标题", "URL", "状态", "抓取 Provider", "追加时间", "解析时间", "内容 Hash"],
  items.map(({ kb, source }) => [
    source.id,
    kb.name,
    kb.type,
    source.title,
    source.url || "",
    source.status,
    source.fetchProvider,
    source.addedAt || "",
    source.parsedAt || "",
    source.contentHash || "",
  ]),
)}`,
  );
}

for (const kb of knowledgeBases) {
  const fileName = kbBaseName(kb);
  const autoCrawl = kb.autoCrawl || {};
  const draft = kb.productExpressionRuleDraft || null;

  writeMarkdown(
    `knowledge-bases/${fileName}`,
    `# ${kb.name}

${frontmatter({ exportedAt, id: kb.id, type: kb.type, typeLabel: typeLabel[kb.type] || kb.type })}

## 基础元数据

${markdownTable(
  ["字段", "值"],
  objectRows(kb, [
    "id",
    "name",
    "type",
    "trustLevel",
    "status",
    "usageScope",
    "sourceType",
    "sourceUrl",
    "chunkingStrategy",
    "retrievalStrategy",
    "vectorizationStatus",
    "embeddingModel",
    "productExpressionSource",
    "productExpressionRulePackageMode",
    "lastSyncedAt",
  ]),
)}

## 资料统计

${markdownTable(
  ["指标", "数量"],
  [
    ["来源资料数", (kb.sources || []).length],
    ["切片数", (kb.chunks || []).length],
    ["已解析来源数", (kb.sources || []).filter((source) => source.status === "parsed").length],
    ["失败来源数", (kb.sources || []).filter((source) => source.status && source.status !== "parsed").length],
  ],
)}

## 自动抓取元数据

${
  Object.keys(autoCrawl).length
    ? markdownTable(
        ["字段", "值"],
        Object.entries(autoCrawl)
          .filter(([key]) => key !== "importedUrls")
          .map(([key, value]) => [key, visibleValue(value)]),
      )
    : "未配置自动抓取。"
}

## 产品表达规则草稿概要

${
  draft
    ? `${markdownTable(
        ["字段", "值"],
        Object.entries(draft)
          .filter(([key]) => !["doExpressions", "dontExpressions", "boundaryNotes", "distilledTermSuggestions"].includes(key))
          .map(([key, value]) => [key, visibleValue(value)]),
      )}

${markdownTable(
  ["清单", "数量"],
  [
    ["允许表达", (draft.doExpressions || []).length],
    ["禁止表达", (draft.dontExpressions || []).length],
    ["边界提示", (draft.boundaryNotes || []).length],
    ["蒸馏词建议", (draft.distilledTermSuggestions || []).length],
  ],
)}`
    : "无规则草稿。"
}`,
  );

  writeMarkdown(
    `sources-by-knowledge-base/${fileName}`,
    `# ${kb.name} 来源资料元数据

${frontmatter({
  exportedAt,
  knowledgeBaseId: kb.id,
  knowledgeBaseName: kb.name,
  type: kb.type,
  sourceCount: (kb.sources || []).length,
})}

${markdownTable(
  ["来源 ID", "类型", "标题", "URL", "状态", "抓取 Provider", "错误摘要", "追加时间", "解析时间", "内容 Hash"],
  (kb.sources || []).map((source) => [
    source.id,
    sourceTypeOf(source),
    source.title,
    source.url || "",
    source.status,
    source.fetchProvider,
    source.errorMessage || "",
    source.addedAt || "",
    source.parsedAt || "",
    source.contentHash || "",
  ]),
)}`,
  );

  writeMarkdown(
    `chunks-by-knowledge-base/${fileName}`,
    `# ${kb.name} 切片元数据

${frontmatter({
  exportedAt,
  knowledgeBaseId: kb.id,
  knowledgeBaseName: kb.name,
  type: kb.type,
  chunkCount: (kb.chunks || []).length,
})}

${markdownTable(
  [
    "切片 ID",
    "来源 ID",
    "来源标题",
    "来源 URL",
    "章节路径",
    "切片标题",
    "Token 数",
    "切片策略",
    "状态",
    "Embedding 状态",
    "Embedding 模型",
    "内容 Hash",
  ],
  (kb.chunks || []).map((chunk) => [
    chunk.id,
    chunk.sourceId,
    chunk.sourceTitle,
    chunk.sourceUrl,
    chunk.sectionPath,
    chunk.chunkTitle,
    chunk.tokenCount,
    chunk.chunkStrategy,
    chunk.status,
    chunk.embeddingStatus,
    chunk.embeddingModel,
    chunk.contentHash,
  ]),
)}`,
  );
}

console.log(
  JSON.stringify(
    {
      outDir,
      knowledgeBaseCount: knowledgeBases.length,
      sourceCount: allSources.length,
      chunkCount: allChunks.length,
      markdownFileCount: fs
        .readdirSync(outDir, { recursive: true })
        .filter((file) => String(file).endsWith(".md")).length,
    },
    null,
    2,
  ),
);
