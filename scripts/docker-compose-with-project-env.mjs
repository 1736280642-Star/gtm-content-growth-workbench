import process from "node:process";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";

const composeArguments = process.argv.slice(2);
if (composeArguments.length === 0) {
  console.error("Usage: node scripts/docker-compose-with-project-env.mjs <docker compose arguments>");
  process.exit(2);
}

// Keep private values out of Compose's --env-file parser. In particular, API
// keys may legally contain "$", which Compose otherwise treats as another
// interpolation expression. Only business integration settings may override
// compose/.env here: local Next.js database and service addresses must never
// mutate the identity of an existing Docker data volume.
const inheritedEnvironment = { ...process.env };
nextEnv.loadEnvConfig(process.cwd());

const localBusinessEnvironment = process.env;
const businessIntegrationNames = new Set([
  "DASHSCOPE_API_KEY",
  "QWEN_MODEL",
  "QWEN_EMBEDDING_MODEL",
  "QWEN_BASE_URL",
  "QWEN_EMBEDDING_BASE_URL",
  "DOUBAO_API_KEY",
  "DOUBAO_MODEL",
  "DOUBAO_BASE_URL",
  "RAG_EMBEDDING_PROVIDER",
  "V5_FORMAL_ARTICLE_PROVIDER",
  "V5_SAMPLE_ARTICLE_PROVIDER",
  "CONTENT_GENERATION_PROVIDER",
  "ARTICLE_TYPE_AI_PROVIDER",
  "EMBEDDING_PROVIDER_TIMEOUT_MS",
  "AI_PROVIDER_TIMEOUT_MS",
  "WECHATSYNC_ENABLED",
  "WECHATSYNC_MOCK"
]);
const childEnvironment = { ...inheritedEnvironment };
for (const [name, value] of Object.entries(localBusinessEnvironment)) {
  if (name.startsWith("GEO_RESEARCH_") || businessIntegrationNames.has(name)) {
    childEnvironment[name] = value;
  }
}

// Reuse an existing supplier credential in Docker when no GEO-specific
// override was configured. Dedicated GEO values always keep precedence.
const geoSupplierFallbacks = {
  GEO_RESEARCH_DOUBAO_API_KEY: "DOUBAO_API_KEY",
  GEO_RESEARCH_DOUBAO_MODEL: "DOUBAO_MODEL",
  GEO_RESEARCH_DOUBAO_BASE_URL: "DOUBAO_BASE_URL",
  GEO_RESEARCH_QWEN_API_KEY: "DASHSCOPE_API_KEY",
  GEO_RESEARCH_QWEN_MODEL: "QWEN_MODEL",
  GEO_RESEARCH_QWEN_BASE_URL: "QWEN_BASE_URL"
};
for (const [geoName, supplierName] of Object.entries(geoSupplierFallbacks)) {
  if (!childEnvironment[geoName]?.trim() && childEnvironment[supplierName]?.trim()) {
    childEnvironment[geoName] = childEnvironment[supplierName];
  }
}

const child = spawn("docker", ["compose", ...composeArguments], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  console.error(`Unable to start Docker Compose: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Docker Compose stopped by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
