import { getBaseUrl, parseArgs, parseList, postJson, printJson, readStdinText, readTextFromPath, shouldTreatAsFatal } from "./worker-utils.mjs";

const args = parseArgs();
const baseUrl = getBaseUrl(args);

if (args.help || args.h) {
  printJson({
    worker: "run-geo-tests",
    usage: "node workers/run-geo-tests.mjs [--base-url URL] [--platforms DeepSeek,豆包,通义千问] [--prompt TEXT] [--prompt-file PATH] [--prompt-group VALUE]"
  });
  process.exit(0);
}

let prompt = typeof args.prompt === "string" ? args.prompt : undefined;

if (!prompt && typeof args["prompt-file"] === "string") {
  const file = await readTextFromPath(args["prompt-file"]);
  prompt = file.text;
}

if (!prompt) {
  const stdin = await readStdinText();
  prompt = stdin.trim() || undefined;
}

const payload = {};
const platforms = parseList(args.platforms);

if (platforms.length) {
  payload.platforms = platforms;
}

if (prompt) {
  payload.prompt = prompt;
}

if (typeof args["prompt-group"] === "string") {
  payload.promptGroup = args["prompt-group"];
}

try {
  const result = await postJson(baseUrl, "/api/geo-tests/run", payload);

  printJson({
    worker: "run-geo-tests",
    baseUrl,
    httpStatus: result.status,
    ...result.body
  });

  process.exitCode = shouldTreatAsFatal(result.body, result.status) ? 1 : 0;
} catch (error) {
  printJson({
    worker: "run-geo-tests",
    baseUrl,
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown worker error"
  });
  process.exitCode = 1;
}
