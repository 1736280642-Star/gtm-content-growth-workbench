import { getBaseUrl, parseArgs, parseList, postJson, printJson, shouldTreatAsFatal } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "schedule-pipeline",
    usage:
      "node workers/schedule-pipeline.mjs [--base-url URL] [--repeat] [--interval-seconds 3600] [--max-runs 24] [--skip-blog] [--skip-log] [--skip-channel-metrics] [--skip-geo] [--week YYYY-MM-DD] [--log-file-path PATH] [--channel-metrics-path PATH] [--geo-platforms 通义千问,DeepSeek] [--geo-prompt TEXT]"
  });
  process.exit(0);
}

function numberArg(name, fallback, min, max) {
  const parsed = Number(args[name]);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function buildPayload() {
  const payload = {
    skipBlog: Boolean(args["skip-blog"]),
    skipLog: Boolean(args["skip-log"]),
    skipChannelMetrics: Boolean(args["skip-channel-metrics"]),
    skipGeo: Boolean(args["skip-geo"])
  };

  if (typeof args.week === "string") {
    payload.week = args.week;
  }

  if (typeof args["log-file-path"] === "string" || typeof args["log-source-type"] === "string") {
    payload.log = {
      sourceType: typeof args["log-source-type"] === "string" ? args["log-source-type"] : "demo_csv",
      filePath: typeof args["log-file-path"] === "string" ? args["log-file-path"] : undefined
    };
  }

  if (typeof args["channel-metrics-path"] === "string") {
    payload.channelMetrics = {
      filePath: args["channel-metrics-path"]
    };
  }

  const platforms = parseList(args["geo-platforms"]);

  if (platforms.length || typeof args["geo-prompt"] === "string") {
    payload.geo = {
      platforms: platforms.length ? platforms : undefined,
      prompt: typeof args["geo-prompt"] === "string" ? args["geo-prompt"] : undefined,
      promptGroup: typeof args["geo-prompt-group"] === "string" ? args["geo-prompt-group"] : undefined
    };
  }

  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const repeat = Boolean(args.repeat);
const intervalSeconds = numberArg("interval-seconds", 3600, 10, 86400);
const maxRuns = repeat ? numberArg("max-runs", 24, 1, 1000) : 1;
const startedAt = new Date().toISOString();
const runs = [];

for (let index = 0; index < maxRuns; index += 1) {
  const runStartedAt = new Date().toISOString();
  const response = await postJson(baseUrl, "/api/pipeline/run", buildPayload());
  const body = response.body || {};
  const run = {
    index: index + 1,
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    httpStatus: response.status,
    ok: response.ok,
    status: body.status || (response.ok ? "success" : "failed"),
    runStatus: body.data?.run?.status,
    message: body.message,
    fatal: shouldTreatAsFatal(body, response.status)
  };
  runs.push(run);
  printJson({
    worker: "schedule-pipeline",
    baseUrl,
    repeat,
    intervalSeconds,
    maxRuns,
    startedAt,
    latest: run
  });

  if (run.fatal || index === maxRuns - 1) {
    break;
  }

  await sleep(intervalSeconds * 1000);
}

printJson({
  worker: "schedule-pipeline",
  baseUrl,
  startedAt,
  finishedAt: new Date().toISOString(),
  status: runs.some((run) => run.fatal) ? "failed" : runs.some((run) => run.runStatus === "partial") ? "partial" : "success",
  runs
});

process.exitCode = runs.some((run) => run.fatal) ? 1 : 0;
