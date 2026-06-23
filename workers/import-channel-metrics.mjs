import { getBaseUrl, parseArgs, postJson, printJson, readStdinText, shouldTreatAsFatal } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "import-channel-metrics",
    usage: "node workers/import-channel-metrics.mjs [--base-url URL] [--file-path PATH] [--source-path PATH] [--csv TEXT]"
  });
  process.exit(0);
}

const payload = {};

if (typeof args["file-path"] === "string") {
  payload.filePath = args["file-path"];
}

if (typeof args["source-path"] === "string") {
  payload.sourcePath = args["source-path"];
}

if (typeof args.csv === "string") {
  payload.csv = args.csv;
}

if (!Object.keys(payload).length) {
  const stdin = await readStdinText();

  if (stdin.trim()) {
    payload.csv = stdin;
  }
}

try {
  const result = await postJson(baseUrl, "/api/channel-metrics/import", payload);

  printJson({
    worker: "import-channel-metrics",
    baseUrl,
    httpStatus: result.status,
    ...result.body
  });

  process.exitCode = shouldTreatAsFatal(result.body, result.status) ? 1 : 0;
} catch (error) {
  printJson({
    worker: "import-channel-metrics",
    baseUrl,
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown worker error"
  });
  process.exitCode = 1;
}
