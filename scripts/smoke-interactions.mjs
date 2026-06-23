import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const results = [];

function readSource(filePath) {
  const fullPath = join(root, filePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function getScopedSource(content, start, endMarkers = ["  async function ", "  function ", "  return ("]) {
  const startIndex = content.indexOf(start);
  if (startIndex < 0) return "";
  const candidates = endMarkers.map((marker) => content.indexOf(marker, startIndex + start.length)).filter((index) => index > startIndex);
  const endIndex = candidates.length ? Math.min(...candidates) : content.length;
  return content.slice(startIndex, endIndex);
}

function assertContract(contract) {
  const content = readSource(contract.file);
  const source = contract.scope ? getScopedSource(content, contract.scope.start, contract.scope.endMarkers) : content;
  const missing = [];

  if (!content) missing.push("file missing");
  if (contract.scope && !source) missing.push(`scope missing: ${contract.scope.start}`);

  for (const needle of contract.includes || []) {
    if (!source.includes(needle)) missing.push(needle);
  }

  for (const needle of contract.excludes || []) {
    if (source.includes(needle)) missing.push(`unexpected:${needle}`);
  }

  results.push({
    name: contract.name,
    file: contract.file,
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : "V3 interaction contract present"
  });
}

const contracts = [
  {
    name: "weekly_plan_preview_contract",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["周计划生成预览", "handleGeneratePlan", "/api/weekly-plans/generate", "handleConfirmTasks", "/api/content-tasks/confirm", "主蒸馏词", "来源问题", "官网链接目标", "进入今日发布"],
    excludes: ["覆盖草稿", "发布队列"]
  },
  {
    name: "today_batch_publish_contract",
    file: "src/app/today/page.tsx",
    includes: ["今日发布", "handleBatchGenerate", "/api/content-tasks/batch-generate", "selectedGeneratableIds", "handleMarkPublished", "/api/content-tasks/${task.id}/published", "handleFillUrl", "/api/content-tasks/${urlTask.id}/url", "today-confirm-published-", "today-fill-url-", "去数据回传"],
    excludes: ["handleGenerateTask", "确认生成这篇稿件？"]
  },
  {
    name: "draft_second_qa_contract",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: ["草稿预览", "handleSaveAndQa", "/api/article-drafts/${draft.id}", "AI 二次质检", "handleRestorePrevious", "handleDeleteFailedSegments", "handleCopyFullText", "copyAllowed", "删除红色失败片段"],
    excludes: ["handleRegenerateDraft", "handleApproveDraft", "确认加入发布队列"]
  },
  {
    name: "data_return_contract",
    file: "src/app/publish/page.tsx",
    includes: ["数据回传", "handleImportMetrics", "/api/channel-metrics/import", "openMetricsModal", "handleSaveMetrics", "/api/publish-records/${metricsRecord.id}/metrics", "getDataReturnStatus", "回今日发布", "手动补录"],
    excludes: ["handleMarkPublished", "handleFillUrl", "/published"]
  },
  {
    name: "geo_diagnostic_contract",
    file: "src/app/geo-test/page.tsx",
    includes: ["诊断摘要", "测试频率与自动化", "selectedDistilledTermIds", "promptDrawerOpen", "Drawer", "distilledTermIds: selectedDistilledTermIds", "citationLevelFilter", "引用层级", "问题类型", "建议动作", "getFrequencySuggestion"],
    excludes: ["officialCitationFilter", "按官网引用筛选"]
  },
  {
    name: "blog_monitor_diagnosis_contract",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["getBlogAuditIndicators", "GEO 健康分", "引用准备不足", "Chunk 不足", "问题分布", "官网信源状态", "优先处理问题", "博客明细", "getArticleTitle"]
  },
  {
    name: "knowledge_import_contract",
    file: "src/app/knowledge/page.tsx",
    includes: ["统一导入链路", "导入资料", "sourceTypeOptions", "contentPreview", "规则切片", "Chunk 预览", "autoCrawlEnabled", "资料更新配置", "promptTemplates"],
    excludes: ["trustLevelFilter", "按可信等级筛选"]
  },
  {
    name: "weekly_report_matrix_contract",
    file: "src/app/weekly-report/page.tsx",
    includes: ["进入周计划生成预览", "发布完成率", "数据回传率", "本周发布漏斗", "渠道表现对比", "固定 Prompt 模板", "蒸馏词矩阵复盘", "reportDistilledTermMatrix", "renderWeeklySuggestionEntry"],
    excludes: ["handleCreateNextPlan", "确认生成下周计划草稿？"]
  },
  {
    name: "prompt_templates_contract",
    file: "src/lib/prompt-templates.ts",
    includes: ["weekly_plan_generation", "channel_title", "evidence_selection", "batch_body_generation", "draft_second_qa", "inputContract", "outputContract", "failureRules"]
  },
  {
    name: "store_v3_contract",
    file: "src/lib/workbench-store.ts",
    includes: ["normalizeKnowledgeBase", "splitKnowledgeContent", "defaultDistilledTerms", "normalizeDistilledTerms", "distilledTermMatrix", "getPromptTemplate(\"evidence_selection\")", "getPromptTemplate(\"batch_body_generation\")", "getPromptTemplate(\"draft_second_qa\")"]
  }
];

for (const contract of contracts) assertContract(contract);

const failed = results.filter((item) => !item.ok);

console.log(JSON.stringify({ script: "smoke-interactions", status: failed.length ? "failed" : "success", passed: results.length - failed.length, failed: failed.length, results }, null, 2));

if (failed.length) process.exitCode = 1;
