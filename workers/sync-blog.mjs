import { getBaseUrl, parseArgs, postJson, printJson, readStdinText, shouldTreatAsFatal } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "sync-blog",
    usage: "node workers/sync-blog.mjs [--base-url URL] [--source-url URL] [--source-urls URL1,URL2] [--source-path PATH] [--csv TEXT] [--json TEXT] [--text TEXT]",
    note: "If no source is provided, the API uses the default multi-source sitemap list."
  });
  process.exit(0);
}

const payload = {};

if (typeof args["source-url"] === "string") {
  payload.sourceUrl = args["source-url"];
}

if (typeof args["source-urls"] === "string") {
  payload.sourceUrls = args["source-urls"].split(",");
}

if (typeof args["source-path"] === "string") {
  payload.sourcePath = args["source-path"];
}

if (typeof args["file-path"] === "string") {
  payload.sourcePath = args["file-path"];
}

if (typeof args.csv === "string") {
  payload.csv = args.csv;
}

if (typeof args.json === "string") {
  payload.json = args.json;
}

if (typeof args.text === "string") {
  payload.text = args.text;
}

if (typeof args.raw === "string") {
  payload.raw = args.raw;
}

if (!Object.keys(payload).length) {
  const stdin = await readStdinText();

  if (stdin.trim()) {
    payload.text = stdin;
  }
}

try {
  const result = await postJson(baseUrl, "/api/blog-articles/sync", payload);

  printJson({
    worker: "sync-blog",
    baseUrl,
    httpStatus: result.status,
    ...result.body
  });

  process.exitCode = shouldTreatAsFatal(result.body, result.status) ? 1 : 0;
} catch (error) {
  printJson({
    worker: "sync-blog",
    baseUrl,
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown worker error"
  });
  process.exitCode = 1;
}
