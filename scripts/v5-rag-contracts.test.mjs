import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

async function loadTs(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filePath
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(require, module, module.exports);
  return module.exports;
}

test("RAG infrastructure fails closed without external configuration", async () => {
  const names = [
    "MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD",
    "OPENSEARCH_URL", "OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD", "RAG_EMBEDDING_PROVIDER",
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
  assert.match(route, /rollbackRagIndexSnapshot\(params\.id,[\s\S]*readRagActor\(payload\)\)/);
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
