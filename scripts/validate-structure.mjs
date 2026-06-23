import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checks = [];

function read(filePath) {
  const fullPath = join(root, filePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function addFileCheck(label, filePath) {
  checks.push({ label, pass: existsSync(join(root, filePath)), detail: filePath });
}

function addContentCheck(label, filePath, needles) {
  const content = read(filePath);
  const missing = needles.filter((needle) => !content.includes(needle));
  checks.push({
    label,
    pass: Boolean(content) && missing.length === 0,
    detail: missing.length ? `${filePath} missing: ${missing.join(", ")}` : filePath
  });
}

function addAbsentCheck(label, filePath, needles) {
  const content = read(filePath);
  const present = needles.filter((needle) => content.includes(needle));
  checks.push({
    label,
    pass: Boolean(content) && present.length === 0,
    detail: present.length ? `${filePath} should not include: ${present.join(", ")}` : filePath
  });
}

function addRegexCheck(label, filePath, patterns) {
  const content = read(filePath);
  const missing = patterns.filter((pattern) => !pattern.test(content));
  checks.push({
    label,
    pass: Boolean(content) && missing.length === 0,
    detail: missing.length ? `${filePath} missing expected pattern` : filePath
  });
}

[
  "docs/prd-v3-content-growth-workbench.md",
  "docs/prd-v3-dev-brief.md",
  "src/lib/prompt-templates.ts",
  "src/app/page.tsx",
  "src/app/weekly-plan/page.tsx",
  "src/app/today/page.tsx",
  "src/app/drafts/[taskId]/page.tsx",
  "src/app/publish/page.tsx",
  "src/app/geo-test/page.tsx",
  "src/app/blog-monitor/page.tsx",
  "src/app/knowledge/page.tsx",
  "src/app/weekly-report/page.tsx",
  "src/app/api/content-tasks/[id]/published/route.ts",
  "src/app/api/content-tasks/[id]/url/route.ts",
  "src/app/api/content-tasks/batch-generate/route.ts",
  "src/app/api/geo-tests/run/route.ts"
].forEach((filePath) => addFileCheck(`required file: ${filePath}`, filePath));

addContentCheck("dashboard v3 progress", "src/app/page.tsx", [
  "首页数据看板",
  "本周计划",
  "已生成",
  "已发布",
  "待回填 URL",
  "待数据回传",
  "今日发布待处理",
  "GEO 诊断",
  "数据回传"
]);

addContentCheck("weekly plan preview only", "src/app/weekly-plan/page.tsx", [
  "周计划生成预览",
  "只生成标题级计划预览",
  "正文统一到今日发布页批量生成",
  "主蒸馏词",
  "来源问题",
  "官网链接目标",
  "硬约束完整",
  "语义约束完整"
]);
addAbsentCheck("weekly plan no body generation", "src/app/weekly-plan/page.tsx", ["正文预览", "发布队列", "覆盖草稿"]);

addContentCheck("today owns publish closure", "src/app/today/page.tsx", [
  "今日发布",
  "批量生成正文",
  "selectedGeneratableIds",
  "/api/content-tasks/batch-generate",
  "/api/content-tasks/${task.id}/published",
  "/api/content-tasks/${urlTask.id}/url",
  "确认已发布",
  "回填正式发布 URL",
  "去数据回传",
  "today-confirm-published-",
  "today-fill-url-",
  "today-url-input"
]);
addAbsentCheck("today no single-row generate api", "src/app/today/page.tsx", ["handleGenerateTask", "确认生成这篇稿件？", "`/api/content-tasks/${taskId}/generate`"]);

addContentCheck("draft preview qa only", "src/app/drafts/[taskId]/page.tsx", [
  "草稿预览",
  "保存并运行 AI 二次质检",
  "删除红色失败片段",
  "返回修改前",
  "复制全文",
  "copyAllowed",
  "请先保存并运行 AI 二次质检"
]);
addAbsentCheck("draft no publish queue entry", "src/app/drafts/[taskId]/page.tsx", ["确认加入发布队列", "handleApproveDraft", "router.push(\"/publish\")", "重新生成稿件"]);

addContentCheck("data return page only", "src/app/publish/page.tsx", [
  "数据回传",
  "这里只负责把渠道数据匹配到已发布文章",
  "/api/channel-metrics/import",
  "手动补录渠道指标",
  "getDataReturnStatus",
  "回今日发布",
  "待数据回传"
]);
addAbsentCheck("data return no publish confirmation", "src/app/publish/page.tsx", ["handleMarkPublished", "/published", "回填发布 URL", "handleFillUrl"]);

addContentCheck("geo v3 diagnostic", "src/app/geo-test/page.tsx", [
  "测试范围",
  "测试频率与自动化",
  "诊断摘要",
  "Prompt 组",
  "Drawer",
  "selectedDistilledTermIds",
  "蒸馏词默认全选",
  "citationLevelLabels",
  "引用层级",
  "问题类型",
  "建议动作",
  "getFrequencySuggestion",
  "distilledTermIds: selectedDistilledTermIds"
]);
addAbsentCheck("geo no binary official citation filter", "src/app/geo-test/page.tsx", ["officialCitationFilter", "按官网引用筛选"]);

addContentCheck("blog monitor v3 diagnosis first", "src/app/blog-monitor/page.tsx", [
  "GEO 健康分",
  "引用准备不足",
  "Chunk 不足",
  "问题分布",
  "官网信源状态",
  "优先处理问题",
  "getBlogAuditIndicators",
  "AI crawler 可访问性",
  "标题与正文可提取性",
  "FAQ / Schema 完整度",
  "Chunk 准备度",
  "博客明细"
]);

addContentCheck("knowledge v3 import and chunks", "src/app/knowledge/page.tsx", [
  "统一导入链路",
  "内容预览",
  "规则切片",
  "Chunk 预览",
  "资料更新配置",
  "自动抓取",
  "sourceTypeOptions",
  "contentPreview",
  "autoCrawlEnabled",
  "导入资料",
  "promptTemplates"
]);
addAbsentCheck("knowledge no visible trust filter", "src/app/knowledge/page.tsx", ["可信等级", "trustLevelFilter", "trustLevelLabels"]);

addContentCheck("weekly report v3 matrix", "src/app/weekly-report/page.tsx", [
  "进入周计划生成预览",
  "发布完成率",
  "数据回传率",
  "GEO 命中率",
  "官网直引率",
  "本周发布漏斗",
  "渠道表现对比",
  "GEO 命中与引用层级",
  "固定 Prompt 模板",
  "蒸馏词矩阵复盘",
  "reportDistilledTermMatrix"
]);
addAbsentCheck("weekly report no direct next plan action", "src/app/weekly-report/page.tsx", ["handleCreateNextPlan", "确认生成下周计划草稿？", "loading={creatingNextPlan}"]);

addContentCheck("types v3 structures", "src/lib/types.ts", [
  "KnowledgeSourceType",
  "KnowledgeChunk",
  "DistilledTerm",
  "contentPreview",
  "chunks?: KnowledgeChunk[]",
  "autoCrawl",
  "distilledTermIds",
  "citationLevel",
  "issueType",
  "suggestedAction"
]);

addContentCheck("store v3 rules", "src/lib/workbench-store.ts", [
  "defaultDistilledTerms",
  "normalizeKnowledgeBase",
  "splitKnowledgeContent",
  "normalizeDistilledTerms",
  "distilledTerms",
  "promptTemplates",
  "getPromptTemplate(\"weekly_plan_generation\")",
  "getPromptTemplate(\"evidence_selection\")",
  "getPromptTemplate(\"batch_body_generation\")",
  "getPromptTemplate(\"draft_second_qa\")",
  "distilledTermMatrix",
  "getGeoCitationLevel",
  "getGeoIssueType",
  "getGeoSuggestedAction"
]);

addContentCheck("prompt templates fixed", "src/lib/prompt-templates.ts", [
  "weekly_plan_generation",
  "channel_title",
  "evidence_selection",
  "batch_body_generation",
  "draft_second_qa",
  "version",
  "inputContract",
  "outputContract",
  "failureRules"
]);

addRegexCheck("new task publish api", "src/app/api/content-tasks/[id]/published/route.ts", [/export\s+async\s+function\s+PATCH/]);
addRegexCheck("new task url api", "src/app/api/content-tasks/[id]/url/route.ts", [/export\s+async\s+function\s+PATCH/]);
addContentCheck("batch generate accepts selected ids", "src/app/api/content-tasks/batch-generate/route.ts", ["readRequestPayload", "batchGenerateDrafts(payload)"]);

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  const marker = check.pass ? "PASS" : "FAIL";
  console.log(`[${marker}] ${check.label} - ${check.detail}`);
}

console.log("");
console.log(`V3 structure checks: ${checks.length - failed.length}/${checks.length} passed`);

if (failed.length > 0) {
  process.exitCode = 1;
}
