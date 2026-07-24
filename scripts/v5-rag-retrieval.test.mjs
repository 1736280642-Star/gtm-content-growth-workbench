import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function load(relativePath) { const filePath = path.join(process.cwd(), relativePath); const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filePath }).outputText; const module = { exports: {} }; new Function("require", "module", "exports", output)(require, module, module.exports); return module.exports; }

function chunk(id, overrides = {}) { return { chunkId: id, indexSnapshotId: "idx-1", namespace: "production_public", productId: "pharaoh-command", productName: "Pharaoh Command", knowledgeBaseIds: ["kb"], sourceId: `source-${id}`, sourceRevisionId: `rev-${id}`, claimIds: [`claim-${id}`], sourceLocator: { headingPath: ["能力"] }, semanticType: "claim_chunk", chunkTitle: id, summary: id, content: id.repeat(30), originalQuote: id.repeat(10), documentType: "official_product_page", authorityLevel: "A2", lifecycleStatus: "current", visibility: "public", supportMode: "direct", claimScope: "public_product", capabilityStatus: "current", conditions: [], limitations: [], scenarioTags: [], capabilityTags: [], audienceTags: [], problemTags: [], channelTags: [], distilledTermIds: [], questionCandidateIds: [], conflictGroupIds: [], rulePackageVersionId: "rule-1", contentHash: id, semanticHash: id, duplicateClusterId: `cluster-${id}`, status: "active", chunkerVersion: "v1", ...overrides }; }
function request() { return { retrievalRequestId: "req-1", matrixItemId: "matrix-1", productId: "pharaoh-command", productName: "Pharaoh Command", namespace: "production_public", language: "zh-CN", title: "网络运维", channel: "wechat", contentType: "education", platformContentType: "implicit_painpoint_education", targetAudience: "网络工程师", sourceProblem: "排障上下文分散", distilledTermIds: [], rulePackageVersionId: "rule-1", permissionScope: ["public"], lifecycleStatuses: ["current"], requestedAt: new Date().toISOString() }; }

test("hybrid retrieval excludes cross-product, blocked lifecycle and conflicts before ranking", () => {
  const { runHybridRetrieval } = load("src/lib/v5/rag/retrieval-service.ts");
  const { ragRetrievalRoutes } = load("src/lib/v5/rag/retrieval-route-registry.ts");
  const good = chunk("good"); const cross = chunk("cross", { productId: "noteflow" }); const planned = chunk("planned", { lifecycleStatus: "planned", capabilityStatus: "planned" }); const conflict = chunk("conflict", { conflictGroupIds: ["conflict-1"] });
  const run = runHybridRetrieval({ request: request(), route: ragRetrievalRoutes.implicit_painpoint_education, indexSnapshotIds: ["idx-1"], retrievalPolicyVersion: "v1", pools: { bm25: [good, cross, planned, conflict].map((item, i) => ({ chunk: item, score: 1 - i * .1 })), vector: [], relation: [], required: [{ chunk: good, score: 1, evidenceRoles: ["problem_context", "product_mechanism", "human_boundary", "official_citation"] }] } });
  assert.deepEqual(run.selectedChunkIds, ["good"]);
  assert.equal(run.candidates.find((item) => item.chunk.chunkId === "cross").exclusionReasons.includes("product_mismatch"), true);
  assert.equal(run.candidates.find((item) => item.chunk.chunkId === "planned").exclusionReasons.includes("lifecycle_mismatch"), true);
  assert.equal(run.candidates.find((item) => item.chunk.chunkId === "conflict").exclusionReasons.includes("unresolved_conflict"), true);
  assert.equal(run.status, "completed");
});

test("hybrid retrieval enforces duplicate quota and reports missing evidence roles", () => {
  const { runHybridRetrieval } = load("src/lib/v5/rag/retrieval-service.ts"); const { ragRetrievalRoutes } = load("src/lib/v5/rag/retrieval-route-registry.ts");
  const a = chunk("a", { duplicateClusterId: "same" }); const b = chunk("b", { duplicateClusterId: "same" });
  const run = runHybridRetrieval({ request: request(), route: ragRetrievalRoutes.implicit_painpoint_education, indexSnapshotIds: ["idx-1"], retrievalPolicyVersion: "v1", pools: { bm25: [{ chunk: a, score: 1 }, { chunk: b, score: .9 }], vector: [], relation: [], required: [] } });
  assert.equal(run.selectedChunkIds.length, 1); assert.equal(run.status, "needs_material"); assert.equal(run.missingEvidenceRoles.length > 0, true);
});

test("required evidence roles are derived from governed chunk semantics", () => {
  const { inferEvidenceRoles } = load("src/lib/v5/rag/retrieval-service.ts");
  assert.deepEqual(inferEvidenceRoles(chunk("limit", { semanticType: "limitation_chunk", limitations: ["需人工确认"] })).sort(), ["human_boundary"].sort());
  assert.equal(inferEvidenceRoles(chunk("citation", { semanticType: "official_citation" })).includes("official_citation"), true);
  assert.equal(inferEvidenceRoles(chunk("step", { semanticType: "method_step" })).includes("method_step"), true);
});

test("planned capability is only eligible on the launch route and unknown direct claims stay blocked", () => {
  const { runHybridRetrieval } = load("src/lib/v5/rag/retrieval-service.ts");
  const { ragRetrievalRoutes } = load("src/lib/v5/rag/retrieval-route-registry.ts");
  const planned = chunk("planned-launch", { lifecycleStatus: "current", capabilityStatus: "planned", semanticType: "release" });
  const unknownDirect = chunk("unknown-direct", { lifecycleStatus: "unknown", capabilityStatus: "unknown", supportMode: "direct" });
  const launchRequest = { ...request(), platformContentType: "explicit_launch_matrix", lifecycleStatuses: ["current", "planned", "unknown"] };
  const launch = runHybridRetrieval({
    request: launchRequest,
    route: ragRetrievalRoutes.explicit_launch_matrix,
    indexSnapshotIds: ["idx-1"],
    retrievalPolicyVersion: "v1",
    pools: { bm25: [{ chunk: planned, score: 1 }, { chunk: unknownDirect, score: .9 }], vector: [], relation: [], required: [] }
  });
  assert.equal(launch.selectedChunkIds.includes("planned-launch"), true);
  assert.equal(launch.candidates.find((item) => item.chunk.chunkId === "unknown-direct").exclusionReasons.includes("unknown_capability_status"), true);
  const ordinary = runHybridRetrieval({
    request: { ...request(), lifecycleStatuses: ["current", "planned", "unknown"] },
    route: ragRetrievalRoutes.implicit_painpoint_education,
    indexSnapshotIds: ["idx-1"],
    retrievalPolicyVersion: "v1",
    pools: { bm25: [{ chunk: planned, score: 1 }], vector: [], relation: [], required: [] }
  });
  assert.equal(ordinary.candidates[0].exclusionReasons.includes("planned_capability_not_allowed"), true);
});
