import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
async function loadTs(relativePath) {
  const filePath = path.join(root, relativePath);
  const baseRequire = createRequire(filePath);
  const localRequire = (specifier) => specifier === "../deployment-ai-config"
    ? { getDeploymentRuntimeValue: (name) => process.env[name]?.trim() || undefined }
    : baseRequire(specifier);
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filePath
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

test("RAG infrastructure fails closed without external configuration", async () => {
  const names = [
    "MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD",
    "OPENSEARCH_URL", "OPENSEARCH_AUTH_MODE", "OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD", "RAG_EMBEDDING_PROVIDER",
    "DASHSCOPE_API_KEY", "QWEN_EMBEDDING_MODEL", "DOUBAO_API_KEY", "DOUBAO_EMBEDDING_MODEL"
  ];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  const { getRagInfrastructureStatus, assertRagInfrastructureReady } = await loadTs("src/lib/v5/rag/infrastructure.ts");
  const status = getRagInfrastructureStatus();
  assert.equal(status.status, "pending_config");
  assert.equal(status.mysql.status, "pending_config");
  assert.equal(status.opensearch.status, "pending_config");
  assert.equal(status.embedding.status, "pending_config");
  assert.throws(() => assertRagInfrastructureReady(), /尚未完整配置/);
  names.forEach((name) => saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name]);
});

test("OpenSearch supports anonymous and Basic authentication without ambiguous partial credentials", async () => {
  const names = ["OPENSEARCH_URL", "OPENSEARCH_AUTH_MODE", "OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const { getOpenSearchAuthorizationHeader, getOpenSearchMissingConfig } = await loadTs("src/lib/v5/rag/infrastructure.ts");
  try {
    process.env.OPENSEARCH_URL = "http://127.0.0.1:9200";
    process.env.OPENSEARCH_AUTH_MODE = "none";
    delete process.env.OPENSEARCH_USERNAME;
    delete process.env.OPENSEARCH_PASSWORD;
    assert.deepEqual(getOpenSearchMissingConfig(), []);
    assert.equal(getOpenSearchAuthorizationHeader(), undefined);

    process.env.OPENSEARCH_AUTH_MODE = "auto";
    process.env.OPENSEARCH_USERNAME = "admin";
    delete process.env.OPENSEARCH_PASSWORD;
    assert.deepEqual(getOpenSearchMissingConfig(), ["OPENSEARCH_PASSWORD"]);

    process.env.OPENSEARCH_AUTH_MODE = "basic";
    process.env.OPENSEARCH_PASSWORD = "secret";
    assert.match(getOpenSearchAuthorizationHeader(), /^Basic /);

    process.env.OPENSEARCH_AUTH_MODE = "typo";
    assert.deepEqual(getOpenSearchMissingConfig(), ["OPENSEARCH_AUTH_MODE"]);
  } finally {
    names.forEach((name) => saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name]);
  }
});

test("IndexSnapshot and job state machines reject unsafe shortcuts", async () => {
  const { assertRagIndexTransition, assertRagJobTransition } = await loadTs("src/lib/v5/rag/state-machines.ts");
  assert.doesNotThrow(() => assertRagIndexTransition("ready", "active"));
  assert.doesNotThrow(() => assertRagIndexTransition("superseded", "rollback_target"));
  assert.doesNotThrow(() => assertRagIndexTransition("rollback_target", "active"));
  assert.throws(() => assertRagIndexTransition("building", "active"), /不能从 building 变更为 active/);
  assert.doesNotThrow(() => assertRagJobTransition("running", "awaiting_validation"));
  assert.throws(() => assertRagJobTransition("queued", "completed"), /不能从 queued 变更为 completed/);
});

test("rollback route is explicit and production writes fail closed", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/rag/index-snapshots/[id]/rollback/route.ts"), "utf8");
  const api = fs.readFileSync(path.join(root, "src/lib/v5/rag/rag-api.ts"), "utf8");
  const service = fs.readFileSync(path.join(root, "src/lib/v5/rag/rag-service.ts"), "utf8");
  const repository = fs.readFileSync(path.join(root, "src/lib/v5/rag/rag-repository.ts"), "utf8");
  assert.match(route, /readRagPayload\(request\)/);
  assert.match(route, /rollbackRagIndexSnapshot\((?:params|routeParams)\.id,[\s\S]*readRagActor\(payload\)\)/);
  assert.match(api, /NODE_ENV === "production"/);
  assert.match(api, /authorization_not_configured/);
  assert.match(service, /current\.status !== "active"/);
  assert.match(service, /rollback_target_invalid/);
  assert.match(service, /rollback_partition_mismatch/);
  assert.match(service, /target\.validationSummary\?\.passed/);
  assert.match(repository, /FOR UPDATE/);
  assert.match(repository, /activeIds\.length !== 1/);
  assert.match(repository, /superseded\.affectedRows !== 1/);
});

test("automatic knowledge refresh closes governance, evaluation and task release without UI actions", () => {
  const refreshWorker = fs.readFileSync(path.join(root, "workers/knowledge-refresh-worker.mjs"), "utf8");
  const indexWorker = fs.readFileSync(path.join(root, "workers/rag-index-worker.mjs"), "utf8");
  const refreshRepository = fs.readFileSync(path.join(root, "src/lib/v5/rag/knowledge-refresh-repository.ts"), "utf8");
  const evaluation = fs.readFileSync(path.join(root, "src/lib/v5/rag/automatic-index-evaluation-service.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(refreshWorker, /leaseNextRagJob\(workerId, 300, \["knowledge_refresh"\]\)/);
  assert.match(refreshRepository, /INSERT INTO source_snapshot/);
  assert.match(refreshRepository, /INSERT INTO rule_package_version/);
  assert.match(refreshRepository, /INSERT INTO monthly_production_readiness/);
  assert.match(refreshRepository, /status = 'ready_for_generation'/);
  assert.match(evaluation, /keywordSearch\(snapshot\.indexName, request, 10\)/);
  assert.match(evaluation, /evaluateRagMetrics\(metrics\)/);
  assert.match(indexWorker, /validateRagIndexSnapshot/);
  assert.match(indexWorker, /activateRagIndexSnapshot/);
  assert.match(indexWorker, /releaseAutomaticKnowledgeTasksRecord/);
  assert.equal(typeof packageJson.scripts["worker:v5-rag:knowledge-refresh"], "string");
});

test("Qwen embedding batches are capped at the provider limit", () => {
  const indexBuildService = fs.readFileSync(path.join(root, "src/lib/v5/rag/index-build-service.ts"), "utf8");
  assert.match(indexBuildService, /provider === "qwen_embedding" \? 10 : 32/);
  assert.match(indexBuildService, /boundedPositiveInteger\(process\.env\.RAG_EMBEDDING_BATCH_SIZE, providerBatchMaximum, providerBatchMaximum\)/);
});

test("automatic refresh keeps blocked text out of parent chunks and versions indexes by governed claim set", () => {
  const chunking = fs.readFileSync(path.join(root, "src/lib/v5/rag/chunking-service.ts"), "utf8");
  const refresh = fs.readFileSync(path.join(root, "src/lib/v5/rag/knowledge-refresh-service.ts"), "utf8");
  const refreshRepository = fs.readFileSync(path.join(root, "src/lib/v5/rag/knowledge-refresh-repository.ts"), "utf8");
  const evaluation = fs.readFileSync(path.join(root, "src/lib/v5/rag/automatic-index-evaluation-service.ts"), "utf8");
  assert.match(chunking, /sanitizeBlockedText/);
  assert.match(chunking, /code !== "too_short"/);
  assert.match(refresh, /manifest\.manifestHash\.slice\(0, 16\)/);
  assert.match(refresh, /claim-aware@2/);
  assert.match(refresh, /automatic-knowledge@3/);
  assert.match(refreshRepository, /claimSetHash\.slice\(0, 8\)/);
  assert.match(evaluation, /claim\.reviewStatus === "rejected"/);
  assert.doesNotMatch(evaluation, /claim\.reviewStatus !== "superseded"/);
});

test("Final EvidencePack accepts an approved matrix item after automatic release", () => {
  const service = fs.readFileSync(path.join(root, "src/lib/v5/rag/rag-service.ts"), "utf8");
  assert.match(service, /\["approved", "ready_for_generation"\]\.includes\(matrix\.itemStatus\)/);
});

test("product-intro retrieval prioritizes governed role coverage and enough evidence for formal generation", () => {
  const routes = fs.readFileSync(path.join(root, "src/lib/v5/rag/retrieval-route-registry.ts"), "utf8");
  const retrieval = fs.readFileSync(path.join(root, "src/lib/v5/rag/retrieval-service.ts"), "utf8");
  assert.match(routes, /explicit_product_intro: \{ \.\.\.base, sourcePageLimit: 10/);
  assert.match(routes, /routeVersion: "v2"/);
  assert.match(retrieval, /for \(const role of route\.requiredEvidenceRoles\)/);
  assert.match(retrieval, /\["A1", "A2"\]\.includes\(chunk\.authorityLevel\)/);
});

test("Claim-aware chunk ids are deterministic within an immutable snapshot", async () => {
  const { buildClaimAwareChunks } = await loadTs("src/lib/v5/rag/chunking-service.ts");
  const input = {
    indexSnapshotId: "index-snapshot-1",
    namespace: "production_public",
    productId: "pharaoh-command",
    productName: "Pharaoh Command",
    knowledgeBaseIds: ["kb-pharaoh-command-official"],
    rulePackageVersionId: "rule-1",
    source: {
      sourceId: "source-1", batchId: "batch-1", knowledgeBaseId: "kb-pharaoh-command-official", importMethod: "file",
      documentType: "official_product_page", authorityLevel: "A2", lifecycleStatus: "current", visibility: "public", title: "权限控制",
      productCandidates: ["pharaoh-command"], classificationConfidence: 1, classificationReasons: [], status: "approved_for_claim_extraction",
      qualityFlags: [], monthlySupport: { supportedContentTypes: [], supportedChannels: [], evidenceRoles: [], limitationCodes: [] },
      safetyStatus: "passed", safetyRiskTypes: [], createdBy: "test"
    },
    revision: {
      sourceRevisionId: "revision-1", sourceId: "source-1", revisionNumber: 1, contentHash: "hash", normalizedTextRef: "fixture.md",
      capturedAt: "2026-07-16T00:00:00.000Z", parserName: "test", parserVersion: "1", parseStatus: "parsed", qualityFlags: [], contentLength: 120
    },
    normalizedMarkdown: "# 权限控制\nPharaoh Command 支持审批后执行变更，并保留回滚路径。",
    approvedClaims: [{
      claimId: "claim-1", productId: "pharaoh-command", subjectType: "product", claimType: "capability",
      normalizedClaim: "支持审批后执行变更", originalQuote: "Pharaoh Command 支持审批后执行变更，并保留回滚路径。",
      sourceId: "source-1", sourceRevisionId: "revision-1", sourceLocator: { headingPath: ["权限控制"] }, authorityLevel: "A2",
      supportMode: "direct", capabilityStatus: "current", claimScope: "public_product", conditions: [], limitations: [], confidence: 1,
      extractorVersion: "test", parentClaimIds: [], reviewStatus: "supported", conflictGroupId: "conflict-1"
    }],
    blockedClaimIds: [],
    chunkerVersion: "claim-aware@1"
  };
  const first = buildClaimAwareChunks(input);
  const second = buildClaimAwareChunks(input);
  assert.deepEqual(first.chunks.map((chunk) => chunk.chunkId), second.chunks.map((chunk) => chunk.chunkId));
  assert.equal(new Set(first.chunks.map((chunk) => chunk.chunkId)).size, first.chunks.length);
  const nextSnapshot = buildClaimAwareChunks({ ...input, indexSnapshotId: "index-snapshot-2" });
  assert.notDeepEqual(first.chunks.map((chunk) => chunk.chunkId), nextSnapshot.chunks.map((chunk) => chunk.chunkId));
  assert.equal(first.chunks.every((chunk) => chunk.conflictGroupIds.length === 0), true);
  const unresolved = buildClaimAwareChunks({ ...input, unresolvedConflictIds: ["conflict-1"] });
  assert.equal(unresolved.chunks.some((chunk) => chunk.conflictGroupIds.includes("conflict-1")), true);
});
