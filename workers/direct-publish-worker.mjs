import { getBaseUrl, parseArgs, postJson, printJson } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "direct-publish",
    usage: "node workers/direct-publish-worker.mjs [--base-url URL] [--interval-seconds 30] [--limit 20] [--once] [--max-runs N]"
  });
  process.exit(0);
}

function numberArg(name, fallback, min, max) {
  const parsed = Number(args[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const intervalSeconds = numberArg("interval-seconds", 30, 10, 3600);
const limit = numberArg("limit", 20, 1, 100);
const maxRuns = args.once ? 1 : numberArg("max-runs", Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

for (let index = 0; index < maxRuns && !stopping; index += 1) {
  const startedAt = new Date().toISOString();
  try {
    const response = await postJson(baseUrl, "/api/direct-publish", { limit });
    const attempts = Array.isArray(response.body?.data?.attempts) ? response.body.data.attempts : [];
    printJson({
      worker: "direct-publish",
      run: index + 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      httpStatus: response.status,
      ok: response.ok && response.body?.ok !== false,
      processed: attempts.length,
      statuses: attempts.map((attempt) => ({ scheduleId: attempt.scheduleId, status: attempt.status, failureCode: attempt.failureCode }))
    });
  } catch (error) {
    printJson({
      worker: "direct-publish",
      run: index + 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      message: error instanceof Error ? error.message : "Direct publish worker request failed."
    });
  }

  if (index < maxRuns - 1 && !stopping) await sleep(intervalSeconds * 1000);
}
