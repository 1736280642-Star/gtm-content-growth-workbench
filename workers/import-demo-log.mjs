import { getBaseUrl, parseArgs, postJson, printJson, readStdinText, shouldTreatAsFatal } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "import-demo-log",
    usage: "node workers/import-demo-log.mjs [--base-url URL] [--source-type demo_csv|nginx_log|cdn_log] [--file-path PATH] [--source-path PATH] [--csv TEXT] [--raw-log TEXT]"
  });
  process.exit(0);
}

const payload = {};

if (typeof args["source-type"] === "string") {
  payload.sourceType = args["source-type"];
}

if (typeof args["file-path"] === "string") {
  payload.filePath = args["file-path"];
}

if (typeof args["source-path"] === "string") {
  payload.sourcePath = args["source-path"];
}

if (typeof args.csv === "string") {
  payload.csv = args.csv;
}

if (typeof args["raw-log"] === "string") {
  payload.rawLog = args["raw-log"];
}

if (!Object.keys(payload).length) {
  const stdin = await readStdinText();

  if (stdin.trim()) {
    payload.csv = stdin;
  }
}

try {
  const result = await postJson(baseUrl, "/api/log-imports", payload);

  printJson({
    worker: "import-demo-log",
    baseUrl,
    httpStatus: result.status,
    ...result.body
  });

  process.exitCode = shouldTreatAsFatal(result.body, result.status) ? 1 : 0;
} catch (error) {
  printJson({
    worker: "import-demo-log",
    baseUrl,
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown worker error"
  });
  process.exitCode = 1;
}
