import { getBaseUrl, getJson, parseArgs, parseList, postJson, printJson, shouldTreatAsFatal } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "run-pipeline",
    usage:
      "node workers/run-pipeline.mjs [--base-url URL] [--skip-blog] [--skip-log] [--skip-channel-metrics] [--skip-geo] [--week YYYY-MM-DD] [--blog-source-url URL] [--blog-source-urls URL1,URL2] [--blog-source-path PATH] [--blog-json TEXT] [--log-file-path PATH] [--log-source-type demo_csv|nginx_log|cdn_log] [--channel-metrics-path PATH] [--channel-metrics-csv TEXT] [--geo-platforms 通义千问,DeepSeek] [--geo-prompt TEXT]"
  });
  process.exit(0);
}

function isSkipped(name) {
  return Boolean(args[`skip-${name}`]);
}

function buildBlogPayload() {
  const payload = {};

  if (typeof args["blog-source-url"] === "string") {
    payload.sourceUrl = args["blog-source-url"];
  }

  if (typeof args["blog-source-urls"] === "string") {
    payload.sourceUrls = args["blog-source-urls"].split(",");
  }

  if (typeof args["blog-source-path"] === "string") {
    payload.sourcePath = args["blog-source-path"];
  }

  if (typeof args["blog-json"] === "string") {
    payload.json = args["blog-json"];
  }

  if (typeof args["blog-csv"] === "string") {
    payload.csv = args["blog-csv"];
  }

  return payload;
}

function buildLogPayload() {
  const payload = {
    sourceType: typeof args["log-source-type"] === "string" ? args["log-source-type"] : "demo_csv"
  };

  if (typeof args["log-file-path"] === "string") {
    payload.filePath = args["log-file-path"];
  }

  if (typeof args["log-source-path"] === "string") {
    payload.sourcePath = args["log-source-path"];
  }

  if (typeof args["log-csv"] === "string") {
    payload.csv = args["log-csv"];
  }

  return payload;
}

function buildChannelMetricsPayload() {
  const payload = {};

  if (typeof args["channel-metrics-path"] === "string") {
    payload.filePath = args["channel-metrics-path"];
  }

  if (typeof args["channel-metrics-source-path"] === "string") {
    payload.sourcePath = args["channel-metrics-source-path"];
  }

  if (typeof args["channel-metrics-csv"] === "string") {
    payload.csv = args["channel-metrics-csv"];
  }

  return payload;
}

function buildGeoPayload() {
  const payload = {};
  const platforms = parseList(args["geo-platforms"]);

  if (platforms.length) {
    payload.platforms = platforms;
  }

  if (typeof args["geo-prompt"] === "string") {
    payload.prompt = args["geo-prompt"];
  }

  if (typeof args["geo-prompt-group"] === "string") {
    payload.promptGroup = args["geo-prompt-group"];
  }

  return payload;
}

function summarizeStep(name, response) {
  return {
    name,
    httpStatus: response.status,
    ok: Boolean(response.body?.ok),
    status: response.body?.status || (response.ok ? "success" : "failed"),
    message: response.body?.message,
    missingConfig: response.body?.missingConfig,
    fatal: shouldTreatAsFatal(response.body, response.status)
  };
}

async function runStep(name, pathName, payload) {
  const response = await postJson(baseUrl, pathName, payload);
  return summarizeStep(name, response);
}

const startedAt = new Date().toISOString();
const steps = [];

try {
  if (!isSkipped("blog")) {
    steps.push(await runStep("sync_blog", "/api/blog-articles/sync", buildBlogPayload()));
  }

  if (!isSkipped("log")) {
    steps.push(await runStep("import_log", "/api/log-imports", buildLogPayload()));
  }

  if (!isSkipped("channel-metrics")) {
    steps.push(await runStep("import_channel_metrics", "/api/channel-metrics/import", buildChannelMetricsPayload()));
  }

  if (!isSkipped("geo")) {
    steps.push(await runStep("run_geo_tests", "/api/geo-tests/run", buildGeoPayload()));
  }

  const week = typeof args.week === "string" ? args.week : new Date().toISOString().slice(0, 10);
  const weeklyReport = await getJson(baseUrl, `/api/weekly-reports/${week}`);
  const stateSnapshot = await getJson(baseUrl, "/api/workbench-state");
  const fatalSteps = steps.filter((step) => step.fatal);
  const pendingSteps = steps.filter((step) => step.status === "pending_config" || step.status === "pending_input");

  printJson({
    worker: "run-pipeline",
    baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: fatalSteps.length ? "failed" : pendingSteps.length ? "partial" : "success",
    steps,
    weeklyReport: weeklyReport.body,
    summary: stateSnapshot.body?.summary
  });

  process.exitCode = fatalSteps.length ? 1 : 0;
} catch (error) {
  printJson({
    worker: "run-pipeline",
    baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown pipeline error",
    steps
  });
  process.exitCode = 1;
}
