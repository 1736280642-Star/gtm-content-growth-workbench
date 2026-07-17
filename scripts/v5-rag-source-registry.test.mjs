import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sourceRootEnvNames = [
  "RAG_SOURCE_ROOT_PHARAOH_COMMAND",
  "RAG_SOURCE_ROOT_NOTEFLOW",
  "RAG_SOURCE_ROOT_WEIKE_GUARDRAIL",
  "RAG_SOURCE_ROOT_PHARAOH_WECHAT"
];
function loadSourceRegistry() {
  const filePath = path.join(process.cwd(), "src/lib/v5/rag/source-registry.ts");
  const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filePath
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(require, module, module.exports);
  return module.exports;
}

test("fixed source registry enforces authority and namespace boundaries", () => {
  const saved = Object.fromEntries(sourceRootEnvNames.map((name) => [name, process.env[name]]));
  sourceRootEnvNames.forEach((name) => delete process.env[name]);
  const { ragSourceRegistry } = loadSourceRegistry();
  assert.equal(ragSourceRegistry.length, 4);
  const command = ragSourceRegistry.find((item) => item.registryId.startsWith("pharaoh-command-official"));
  assert.equal(command.classify("pages/006-page-6.md").authorityLevel, "A2");
  assert.equal(command.classify("pages/008-terms-html.md").authorityLevel, "A1");
  assert.equal(command.classify("combined.md").disposition, "excluded_text");
  const noteflow = ragSourceRegistry.find((item) => item.productId === "noteflow");
  assert.equal(noteflow.classify("public-rendered-full/blog/001-blog.md").allowedEvidenceRoles.includes("industry_background"), true);
  assert.equal(noteflow.classify("public-rendered-full/blog/001-blog.md").forbiddenUsage.includes("current_product_capability"), true);
  const wechat = ragSourceRegistry.find((item) => item.registryId.includes("wechat-history"));
  assert.equal(wechat.classify("01.md").disposition, "production_candidate");
  assert.equal(wechat.classify("article.cleaned.md").namespace, "governance_preview");
  sourceRootEnvNames.forEach((name) => saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name]);
});

test("real source import plan is traceable and excludes aggregate copies", async () => {
  const saved = Object.fromEntries(sourceRootEnvNames.map((name) => [name, process.env[name]]));
  sourceRootEnvNames.forEach((name) => delete process.env[name]);
  const { buildRagSourceImportPlan, summarizeRagSourceImportPlan } = loadSourceRegistry();
  const plan = await buildRagSourceImportPlan();
  const summary = summarizeRagSourceImportPlan(plan);
  assert.equal(summary.byDisposition.production_candidate, 625);
  assert.equal(plan.some((item) => item.relativePath.endsWith("combined.md") && item.disposition === "excluded_text"), true);
  assert.equal(plan.filter((item) => item.disposition === "production_candidate").every((item) => item.contentHash.length === 64 && item.normalizedTextRef), true);
  assert.equal(plan.filter((item) => item.productId === "pharaoh-command" && item.disposition === "production_candidate").length, 11);
  assert.equal(plan.filter((item) => item.productId === "noteflow" && item.disposition === "production_candidate").length, 297);
  assert.equal(plan.filter((item) => item.productId === "weike-ai-guardrail" && item.disposition === "production_candidate").length, 317);
  sourceRootEnvNames.forEach((name) => saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name]);
});

test("source roots support environment overrides without changing local defaults", () => {
  const saved = process.env.RAG_SOURCE_ROOT_PHARAOH_COMMAND;
  process.env.RAG_SOURCE_ROOT_PHARAOH_COMMAND = "D:/custom/pharaoh-command-source";
  const { ragSourceRegistry, RAG_SOURCE_ROOT_ENV } = loadSourceRegistry();
  assert.equal(RAG_SOURCE_ROOT_ENV.command, "RAG_SOURCE_ROOT_PHARAOH_COMMAND");
  assert.equal(ragSourceRegistry.find((item) => item.registryId.startsWith("pharaoh-command-official")).rootPath, "D:/custom/pharaoh-command-source");
  saved === undefined ? delete process.env.RAG_SOURCE_ROOT_PHARAOH_COMMAND : process.env.RAG_SOURCE_ROOT_PHARAOH_COMMAND = saved;
});

test("source import worker defaults to dry-run and never promotes governed truth", () => {
  const result = require("node:child_process").spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-transform-types", "--loader", "./workers/typescript-loader.mjs", "workers/rag-source-import-worker.mjs", "--production-text-only"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.status, "dry_run");
  assert.equal(output.summary.reviewRequired, 625);
  assert.equal(output.summary.sourceRevisionCandidates >= 625, true);
  assert.equal(output.summary.skipped > 0, true);
});

test("source import worker supports an explicit single-product scope", () => {
  const result = require("node:child_process").spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-transform-types", "--loader", "./workers/typescript-loader.mjs", "workers/rag-source-import-worker.mjs", "--product=pharaoh-command"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.status, "dry_run");
  assert.equal(output.productScope, "pharaoh-command");
  assert.equal(output.registrySummary.total, 77);
  assert.equal(output.registrySummary.byDisposition.production_candidate, 11);
  assert.equal(output.summary.writable, 75);
  assert.deepEqual(output.summary.byProduct, { "pharaoh-command": 75 });
});
