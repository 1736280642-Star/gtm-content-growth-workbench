import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = parseArgs();
const baseUrl = (typeof args["base-url"] === "string" ? args["base-url"] : process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const failures = [];
const results = [];

if (args.help || args.h) {
  printJson({
    script: "smoke-workflow",
    usage: "node scripts/smoke-workflow.mjs [--base-url http://127.0.0.1:3000]"
  });
  process.exit(0);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const rawKey = token.slice(2);
    const equalsIndex = rawKey.indexOf("=");

    if (equalsIndex >= 0) {
      parsed[rawKey.slice(0, equalsIndex)] = rawKey.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }

  return parsed;
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function request(pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : {};

  return {
    httpStatus: response.status,
    ok: response.ok,
    body
  };
}

function assertCondition(name, condition, detail) {
  const result = {
    name,
    ok: Boolean(condition),
    detail
  };

  results.push(result);

  if (!result.ok) {
    failures.push(result);
  }
}

async function main() {
  const initial = await request("/api/workbench-state");
  assertCondition("workbench_state_available", initial.ok && Boolean(initial.body.state), `http ${initial.httpStatus}`);

  const runtime = await request("/api/runtime-config/status");
  assertCondition("runtime_config_available", runtime.ok && Array.isArray(runtime.body.capabilities), `http ${runtime.httpStatus}`);

  const configDiagnostics = await request("/api/config-diagnostics");
  assertCondition(
    "config_diagnostics_available",
    configDiagnostics.ok && Array.isArray(configDiagnostics.body.results),
    configDiagnostics.body.message || `http ${configDiagnostics.httpStatus}`
  );

  const savedSetting = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      defaultWeeklyDays: 1,
      defaultDailyCount: 1,
      enabledChannels: ["wechat"],
      enabledProducts: ["joto_brand"],
      finalReviewMode: "manual_review",
      geoPlatforms: ["ChatGPT", "DeepSeek"],
      logMode: "demo_csv"
    })
  });
  assertCondition("workspace_setting_save", savedSetting.ok && savedSetting.body.data?.workspaceSetting?.defaultWeeklyDays === 1, savedSetting.body.message || `http ${savedSetting.httpStatus}`);

  const createdKnowledgeBase = await request("/api/knowledge-bases", {
    method: "POST",
    body: JSON.stringify({
      name: "Smoke 知识库",
      type: "brand",
      sourceType: "manual",
      status: "enabled",
      usageScope: "smoke workflow validation",
      contentPreview: "Smoke 知识库用于验证统一导入、内容预览、规则切片和 Chunk 预览。JOTO 是 Dify 企业版服务商。"
    })
  });
  assertCondition(
    "knowledge_base_create",
    createdKnowledgeBase.ok && Boolean(createdKnowledgeBase.body.data?.knowledgeBase?.id) && (createdKnowledgeBase.body.data?.knowledgeBase?.chunks?.length || 0) >= 1,
    createdKnowledgeBase.body.message || `http ${createdKnowledgeBase.httpStatus}`
  );

  const smokeKnowledgeBase = createdKnowledgeBase.body.data?.knowledgeBase;
  const patchedKnowledgeBase = await request(`/api/knowledge-bases/${smokeKnowledgeBase.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Smoke 知识库 已编辑",
      status: "disabled"
    })
  });
  assertCondition(
    "knowledge_base_patch",
    patchedKnowledgeBase.ok && patchedKnowledgeBase.body.data?.knowledgeBase?.status === "disabled",
    patchedKnowledgeBase.body.message || `http ${patchedKnowledgeBase.httpStatus}`
  );

  const generatedPlan = await request("/api/weekly-plans/generate", {
    method: "POST",
    body: JSON.stringify({
      days: 1,
      dailyCount: 2,
      channels: ["wechat"]
    })
  });
  assertCondition("weekly_plan_generate", generatedPlan.ok && generatedPlan.body.tasks?.length === 2, generatedPlan.body.message || `http ${generatedPlan.httpStatus}`);

  const taskToDelete = generatedPlan.body.tasks?.[0];
  const task = generatedPlan.body.tasks?.[1];
  assertCondition("task_created", Boolean(task?.id), task?.id || "missing task id");

  const deletedTask = await request(`/api/content-tasks/${taskToDelete.id}`, { method: "DELETE" });
  assertCondition("content_task_delete", deletedTask.ok && !deletedTask.body.data?.tasks?.some((item) => item.id === taskToDelete.id), deletedTask.body.message || `http ${deletedTask.httpStatus}`);

  const confirmedTask = await request("/api/content-tasks/confirm", {
    method: "POST",
    body: JSON.stringify({
      taskIds: [task.id]
    })
  });
  assertCondition("content_task_confirm", confirmedTask.ok && confirmedTask.body.data?.confirmed === 1, confirmedTask.body.message || `http ${confirmedTask.httpStatus}`);

  const patchedTask = await request(`/api/content-tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: `${task.title} smoke`,
      targetKeywords: task.targetKeywords
    })
  });
  assertCondition("content_task_patch", patchedTask.ok && patchedTask.body.data?.task?.title?.includes("smoke"), patchedTask.body.message || `http ${patchedTask.httpStatus}`);

  const regeneratedTitle = await request(`/api/content-tasks/${task.id}/regenerate-title`, { method: "POST" });
  assertCondition("content_task_regenerate_title", regeneratedTitle.ok && Boolean(regeneratedTitle.body.data?.task?.title), regeneratedTitle.body.message || `http ${regeneratedTitle.httpStatus}`);

  const generatedDraft = await request(`/api/content-tasks/${task.id}/generate`, { method: "POST" });
  assertCondition("content_task_generate_draft", generatedDraft.ok && Boolean(generatedDraft.body.data?.draft?.id), generatedDraft.body.message || `http ${generatedDraft.httpStatus}`);

  const draft = generatedDraft.body.data?.draft;
  const patchedDraft = await request(`/api/article-drafts/${draft.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: draft.title,
      summary: draft.summary,
      content: draft.content
    })
  });
  assertCondition("draft_patch", patchedDraft.ok && Boolean(patchedDraft.body.data?.draft?.id), patchedDraft.body.message || `http ${patchedDraft.httpStatus}`);

  const approvedDraft = await request(`/api/article-drafts/${draft.id}/approve`, { method: "POST" });
  assertCondition("draft_approve", approvedDraft.ok && Boolean(approvedDraft.body.data?.record?.id), approvedDraft.body.message || `http ${approvedDraft.httpStatus}`);

  const record = approvedDraft.body.data?.record;
  const markedPublished = await request(`/api/publish-records/${record.id}/published`, { method: "PATCH" });
  assertCondition("publish_record_mark_published", markedPublished.ok && markedPublished.body.data?.record?.publishStatus === "published", markedPublished.body.message || `http ${markedPublished.httpStatus}`);

  const filledUrl = await request(`/api/publish-records/${record.id}/url`, {
    method: "PATCH",
    body: JSON.stringify({
      publishedUrl: `https://example.com/smoke/${record.id}`
    })
  });
  assertCondition("publish_record_fill_url", filledUrl.ok && filledUrl.body.data?.record?.publishStatus === "url_filled", filledUrl.body.message || `http ${filledUrl.httpStatus}`);

  const metricImport = await request("/api/channel-metrics/import", {
    method: "POST",
    body: JSON.stringify({
      csv: `publishRecordId,views,likes,favorites,comments,shares\n${record.id},100,8,5,2,1`
    })
  });
  assertCondition("channel_metrics_import", metricImport.ok && metricImport.body.data?.matched >= 1, metricImport.body.message || `http ${metricImport.httpStatus}`);

  const manualMetrics = await request(`/api/publish-records/${record.id}/metrics`, {
    method: "PATCH",
    body: JSON.stringify({
      views: 111,
      likes: 9,
      favorites: 6,
      comments: 3,
      shares: 2
    })
  });
  assertCondition(
    "publish_record_manual_metrics",
    manualMetrics.ok && manualMetrics.body.data?.record?.channelMetrics?.views === 111,
    manualMetrics.body.message || `http ${manualMetrics.httpStatus}`
  );

  const blogSync = await request("/api/blog-articles/sync", {
    method: "POST",
    body: JSON.stringify({
      articles: [
        {
          id: "smoke-blog-article",
          title: "Smoke Dify AI Guardrails",
          url: "https://example.com/blog/smoke-dify-ai-guardrails",
          indexedStatus: "indexed",
          seoIssueCount: 1,
          geoResult: "miss",
          dataConfidence: "imported"
        }
      ]
    })
  });
  assertCondition("blog_sync", blogSync.ok && blogSync.body.data?.articles?.length >= 1, blogSync.body.message || `http ${blogSync.httpStatus}`);

  const diagnosedBlog = await request("/api/blog-articles/smoke-blog-article/diagnose", { method: "POST" });
  assertCondition("blog_diagnose", diagnosedBlog.ok && Boolean(diagnosedBlog.body.data?.article), diagnosedBlog.body.message || `http ${diagnosedBlog.httpStatus}`);

  const candidateBlog = await request("/api/blog-articles/smoke-blog-article/candidate", { method: "POST" });
  assertCondition("blog_candidate", candidateBlog.ok && candidateBlog.body.data?.article?.candidateStatus === "candidate", candidateBlog.body.message || `http ${candidateBlog.httpStatus}`);

  const candidateTask = await request("/api/blog-articles/smoke-blog-article/candidate/task", { method: "POST" });
  assertCondition(
    "blog_candidate_create_task",
    candidateTask.ok && candidateTask.body.data?.task?.title?.includes("渠道补强") && candidateTask.body.data?.article?.candidateStatus === "planned",
    candidateTask.body.message || `http ${candidateTask.httpStatus}`
  );

  const plannedCandidateBlog = await request("/api/blog-articles/smoke-blog-article/candidate", {
    method: "PATCH",
    body: JSON.stringify({
      status: "planned"
    })
  });
  assertCondition(
    "blog_candidate_mark_planned",
    plannedCandidateBlog.ok && plannedCandidateBlog.body.data?.article?.candidateStatus === "planned",
    plannedCandidateBlog.body.message || `http ${plannedCandidateBlog.httpStatus}`
  );

  const dismissedCandidateBlog = await request("/api/blog-articles/smoke-blog-article/candidate", { method: "DELETE" });
  assertCondition(
    "blog_candidate_dismiss",
    dismissedCandidateBlog.ok && dismissedCandidateBlog.body.data?.article?.candidateStatus === "dismissed",
    dismissedCandidateBlog.body.message || `http ${dismissedCandidateBlog.httpStatus}`
  );

  const logImport = await request("/api/log-imports", {
    method: "POST",
    body: JSON.stringify({
      sourceType: "demo_csv",
      filePath: "data/demo-ai-bot-log.csv"
    })
  });
  assertCondition("log_import", logImport.ok && logImport.body.data?.summaries?.length >= 1, logImport.body.message || `http ${logImport.httpStatus}`);

  const geoRun = await request("/api/geo-tests/run", {
    method: "POST",
    body: JSON.stringify({
      platforms: ["ChatGPT", "DeepSeek"],
      prompt: "推荐几家国内 Dify 企业版服务商",
      distilledTermIds: ["term-dify-enterprise", "term-ai-guardrails"]
    })
  });
  assertCondition(
    "geo_run_ready_or_pending_config",
    geoRun.ok || geoRun.body.status === "pending_config",
    geoRun.body.message || `http ${geoRun.httpStatus}`
  );

  const snapshotAfterGeo = await request("/api/workbench-state");
  const geoResult = snapshotAfterGeo.body.state?.geoResults?.[0];
  assertCondition("geo_result_available", Boolean(geoResult?.id), geoResult?.id || "missing geo result id");

  const geoOverride = await request(`/api/geo-test-results/${geoResult.id}/override`, {
    method: "PATCH",
    body: JSON.stringify({
      mentionedJoto: true,
      mentionedWeike: geoResult.mentionedWeike,
      citedOfficialUrl: geoResult.citedOfficialUrl
    })
  });
  assertCondition("geo_override", geoOverride.ok && geoOverride.body.data?.result?.manualOverride === true, geoOverride.body.message || `http ${geoOverride.httpStatus}`);

  const geoCandidate = await request("/api/geo-test-results/geo-002/candidate", { method: "POST" });
  assertCondition(
    "geo_candidate",
    geoCandidate.ok && geoCandidate.body.data?.article?.candidateStatus === "candidate",
    geoCandidate.body.message || `http ${geoCandidate.httpStatus}`
  );

  const pipelineRun = await request("/api/pipeline/run", {
    method: "POST",
    body: JSON.stringify({
      skipBlog: true,
      skipLog: false,
      skipChannelMetrics: false,
      skipGeo: false,
      log: {
        sourceType: "demo_csv",
        filePath: "data/demo-ai-bot-log.csv"
      },
      channelMetrics: {
        csv: `publishRecordId,views,likes,favorites,comments,shares\n${record.id},120,10,8,3,2`
      },
      geo: {
        platforms: ["ChatGPT", "DeepSeek"],
        prompt: "推荐几家国内 Dify 企业版服务商"
      }
    })
  });
  assertCondition("pipeline_run", pipelineRun.ok && Boolean(pipelineRun.body.data?.run?.id), pipelineRun.body.message || `http ${pipelineRun.httpStatus}`);

  const pipelineExport = await request("/api/pipeline/runs/export");
  assertCondition("pipeline_export", pipelineExport.ok && pipelineExport.body.data?.csv?.includes("stepName"), pipelineExport.body.message || `http ${pipelineExport.httpStatus}`);

  const weeklyReport = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}`);
  assertCondition(
    "weekly_report",
    weeklyReport.ok && Boolean(weeklyReport.body.executiveSummary) && Array.isArray(weeklyReport.body.distilledTermMatrix),
    weeklyReport.body.executiveSummary || `http ${weeklyReport.httpStatus}`
  );

  const weeklyReportMarkdown = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/export`);
  assertCondition(
    "weekly_report_markdown_export",
    weeklyReportMarkdown.ok && weeklyReportMarkdown.body.data?.markdown?.includes("JOTO GTM 周报"),
    weeklyReportMarkdown.body.message || `http ${weeklyReportMarkdown.httpStatus}`
  );

  assertCondition(
    "weekly_report_plan_preview_signal",
    weeklyReport.ok && weeklyReport.body.nextWeekSuggestions?.length >= 1,
    "weekly report provides signals for weekly plan preview"
  );

  const finalSnapshot = await request("/api/workbench-state");
  assertCondition("final_state_has_pipeline_runs", (finalSnapshot.body.state?.pipelineRuns?.length || 0) >= 1, `${finalSnapshot.body.state?.pipelineRuns?.length || 0} pipeline runs`);

  printJson({
    script: "smoke-workflow",
    baseUrl,
    status: failures.length ? "failed" : "success",
    passed: results.filter((item) => item.ok).length,
    failed: failures.length,
    results
  });

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  printJson({
    script: "smoke-workflow",
    baseUrl,
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown smoke failure",
    results
  });
  process.exitCode = 1;
});
