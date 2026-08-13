import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateProductRolloutReadiness } from "../src/lib/v5/product-rollout-readiness-service";

const base = {
  productId: "joto-workbuddy",
  platform: "wechat",
  strategyPackId: "strategy-1",
  strategyStatus: "production_ready",
  calibrationVersionId: "calibration-1",
  productionInputs: { ok: true, detail: "ready" },
  accountConfigured: true,
  auth: { ok: true, message: "ready" }
};

test("real publish needs content readiness, account selection and live auth", () => {
  const ready = evaluateProductRolloutReadiness(base);
  assert.equal(ready.canEnterBatchGeneration, true);
  assert.equal(ready.canScheduleRealPublish, true);
  assert.equal(ready.gates.every((gate) => gate.status === "passed"), true);

  const noCalibration = evaluateProductRolloutReadiness({ ...base, calibrationVersionId: undefined });
  assert.equal(noCalibration.canEnterBatchGeneration, false);
  assert.equal(noCalibration.canScheduleRealPublish, false);

  const missingInputs = evaluateProductRolloutReadiness({
    ...base,
    productionInputs: { ok: false, detail: "missing evidence-ready article type", nextAction: "repair inputs" }
  });
  assert.equal(missingInputs.canEnterBatchGeneration, false);
  assert.equal(missingInputs.gates.find((gate) => gate.key === "production_inputs")?.status, "blocked");

  const bridgeOffline = evaluateProductRolloutReadiness({ ...base, auth: { ok: false, message: "bridge offline", nextAction: "start bridge" } });
  assert.equal(bridgeOffline.canEnterBatchGeneration, true);
  assert.equal(bridgeOffline.canScheduleRealPublish, false);
});

test("automatic content worker explicitly uses batch production mode", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("workers/content-production-worker.mjs", "utf8"));
  assert.match(source, /productionMode: "batch"/);
});

test("server publish route enforces the same rollout gate and forbids sample drafts", async () => {
  const { readFile } = await import("node:fs/promises");
  const [route, readiness] = await Promise.all([
    readFile("src/app/api/v5/content-tasks/[taskId]/publish-job/route.ts", "utf8"),
    readFile("src/lib/v5/product-rollout-readiness-service.ts", "utf8")
  ]);
  assert.match(route, /assertFormalDraftRolloutReady\(draft\.productionContractId, platform\)/);
  assert.match(readiness, /sample_draft_publish_forbidden/);
  assert.match(readiness, /String\(contract\.production_mode\) !== "batch"/);
  assert.match(readiness, /real_publish_readiness_blocked/);
});

test("product account binding is human-confirmed, versioned and audited", async () => {
  const { readFile } = await import("node:fs/promises");
  const [migration, service, component] = await Promise.all([
    readFile("database/migrations/20260812_026_v5_product_publish_account_binding.sql", "utf8"),
    readFile("src/lib/v5/product-rollout-readiness-service.ts", "utf8"),
    readFile("src/components/ProductRolloutReadinessPanel.tsx", "utf8")
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS product_publish_account_binding/);
  assert.match(migration, /UNIQUE KEY uq_product_publish_account_platform/);
  assert.match(service, /product_publish_account_confirmed/);
  assert.match(service, /confirmedAccount === configuredAccountCandidate/);
  assert.match(component, /useState<DirectPublishPlatformKey>\("wechat"\)/);
  assert.match(component, /确认用于当前产品/);
});

test("a single connected platform account can be confirmed on the product page without duplicate Settings input", async () => {
  const [service, panel] = await Promise.all([
    readFile("src/lib/v5/product-rollout-readiness-service.ts", "utf8"),
    readFile("src/components/ProductRolloutReadinessPanel.tsx", "utf8")
  ]);
  assert.match(service, /resolvePublishAccountCandidate/);
  assert.match(service, /getPublishingChannelReadiness/);
  assert.match(service, /readiness\.accounts\.length !== 1/);
  assert.match(service, /configuredAccountCandidateLabel/);
  assert.match(panel, /configuredAccountCandidateLabel \|\| data\.configuredAccountCandidate/);
  assert.match(panel, /确认用于当前产品/);
  assert.match(panel, /存在多个账号/);

  const awaitingConfirmation = evaluateProductRolloutReadiness({
    ...base,
    accountConfigured: false,
    accountCandidateAvailable: true
  });
  const accountGate = awaitingConfirmation.gates.find((gate) => gate.key === "account");
  assert.equal(accountGate?.status, "blocked");
  assert.match(accountGate?.nextAction || "", /当前产品页/);
});

test("monthly automation reuses the approved product strategy portfolio and fails closed", async () => {
  const { readFile } = await import("node:fs/promises");
  const [automation, monthlyService] = await Promise.all([
    readFile("src/lib/v5/monthly-automation-service.ts", "utf8"),
    readFile("src/lib/v5/monthly-service.ts", "utf8")
  ]);
  assert.match(automation, /deriveProductStrategyMonthlyTypeQuotas/);
  assert.match(automation, /typeMatchRunId: `product-strategy:\$\{packId\}`/);
  assert.match(automation, /不会回退到通用文章类型流程/);
  assert.match(automation, /blockedManagedProducts/);
  assert.match(automation, /managedProductIdentities\.has\(normalizeIdentity\(item\.productId\)\)/);
  assert.match(automation, /parseV5Json<string\[\]>\(row\.aliases, \[\]\)/);
  assert.match(automation, /productIdentities\.has\(normalizeIdentity\(question\.productId\)\)/);
  assert.match(monthlyService, /loadProductStrategyMonthlyReferences/);
  assert.match(monthlyService, /sp\.status = 'production_ready'/);
  assert.match(monthlyService, /provider: "product_geo_strategy"/);
});

test("monthly read model exposes latest GEO questions without bypassing human approval", async () => {
  const { readFile } = await import("node:fs/promises");
  const [readModel, repository, governance] = await Promise.all([
    readFile("src/lib/v5/monthly-workspace-read-model.ts", "utf8"),
    readFile("src/lib/v5/knowledge-governance-repository.ts", "utf8"),
    readFile("src/lib/v5/monthly-workspace-governance.ts", "utf8")
  ]);
  assert.match(readModel, /readProductStrategyTargetQuestions/);
  assert.match(readModel, /sp2\.product_id = p\.id/);
  assert.match(readModel, /'pending_strategy_review'/);
  assert.match(readModel, /String\(row\.status\) === "production_ready" \? "monthly_ready"/);
  assert.match(readModel, /strategy-question-/);
  assert.match(repository, /\["active", "enabled", "pending_config"\]\.includes\(String\(row\.status\)\)/);
  assert.match(repository, /String\(readinessRows\[0\]\.status\) === "approved"/);
  assert.match(repository, /String\(readinessRows\[0\]\.source_snapshot_hash \|\| ""\) === String\(version\.source_snapshot_hash \|\| ""\)/);
  assert.match(governance, /knowledgeBase\.status === "enabled" \|\| knowledgeBase\.status === "ready"/);
});
