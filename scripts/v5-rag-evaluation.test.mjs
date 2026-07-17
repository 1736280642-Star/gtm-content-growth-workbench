import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function load() { const filePath = path.join(process.cwd(), "src/lib/v5/rag/evaluation-service.ts"); const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filePath }).outputText; const module = { exports: {} }; new Function("require", "module", "exports", output)(require, module, module.exports); return module.exports; }
const passing = { unapprovedProductionSources: 0, crossProductHits: 0, permissionBoundaryHits: 0, blockedClaimHits: 0, plannedAsCurrentHits: 0, claimLocatorCompleteness: 1, scopedFactRetention: 1, coreClaimRecallAt10: .95, conditionalLimitationRecall: 1, officialCitationHitRate: 1, duplicateClusterTop5Max: 1, previewRiskAccuracy: .95, finalPackDecisionAccuracy: .95, blockingFalseNegatives: 0 };
test("blocking safety metrics cannot be hidden by averages", () => { const { evaluateRagMetrics } = load(); assert.equal(evaluateRagMetrics(passing).passed, true); const failed = evaluateRagMetrics({ ...passing, coreClaimRecallAt10: 1, permissionBoundaryHits: 1 }); assert.equal(failed.passed, false); assert.equal(failed.blockers.some((item) => item.startsWith("permissionBoundaryHits")), true); });
test("badcases return to the owning stage", () => { const { routeRagBadcase } = load(); assert.equal(routeRagBadcase("claim_status_wrong").stage, "governance"); assert.equal(routeRagBadcase("cross_product_recall").stage, "retrieval"); assert.equal(routeRagBadcase("stale_pack_used").stage, "evidence"); });
