import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const routeFiles = [
  "src/app/api/knowledge-governance/knowledge-bases/route.ts",
  "src/app/api/knowledge-ingestion/batches/route.ts",
  "src/app/api/knowledge-ingestion/batches/[id]/sources/route.ts",
  "src/app/api/source-assets/[id]/revisions/route.ts",
  "src/app/api/source-assets/[id]/classification/route.ts",
  "src/app/api/source-assets/[id]/extract-claims/route.ts",
  "src/app/api/product-claims/[id]/review/route.ts",
  "src/app/api/products/[productId]/conflicts/route.ts",
  "src/app/api/products/[productId]/evidence-gaps/route.ts",
  "src/app/api/products/[productId]/rule-packages/drafts/route.ts",
  "src/app/api/rule-package-versions/[id]/approve/route.ts",
  "src/app/api/rule-package-versions/[id]/activate/route.ts",
  "src/app/api/products/[productId]/monthly-production-readiness/evaluate/route.ts",
  "src/app/api/products/[productId]/claims/route.ts",
  "src/app/api/products/[productId]/review-queue/route.ts",
  "src/app/api/claim-conflicts/[id]/resolve/route.ts",
  "src/app/api/evidence-gaps/[id]/route.ts",
  "src/app/api/rule-package-versions/[id]/route.ts",
  "src/app/api/rule-package-versions/[id]/activation-preview/route.ts",
  "src/app/api/rule-package-changes/[id]/review/route.ts",
  "src/app/api/rule-package-versions/[id]/rollback/route.ts",
  "src/app/api/monthly-production-pool/[productId]/route.ts",
  "src/app/api/monthly-production-pool/[productId]/activate/route.ts",
  "src/app/api/monthly-production-pool/[productId]/suspend/route.ts"
];

test("V5 backend exposes every G0-G6 vertical-slice handoff", async () => {
  await Promise.all(routeFiles.map((file) => access(file)));
  assert.equal(routeFiles.length, 24);
});

test("governance writes use idempotency, optimistic versions and audit persistence", async () => {
  const repository = await readFile("src/lib/v5/knowledge-governance-repository.ts", "utf8");
  const materialRepository = await readFile("src/lib/v5/knowledge-governance-material-repository.ts", "utf8");
  const combined = `${repository}\n${materialRepository}`;

  assert.match(combined, /governance_idempotency_record/);
  assert.match(combined, /governance_audit_event/);
  assert.match(combined, /row_version/);
  assert.match(combined, /version_conflict/);
  assert.match(combined, /FOR UPDATE/);
});

test("production writes fail closed until trusted server identity exists", async () => {
  const api = await readFile("src/lib/v5/knowledge-governance-api.ts", "utf8");

  assert.match(api, /process\.env\.NODE_ENV === "production"/);
  assert.match(api, /authorization_not_configured/);
  assert.match(api, /生产环境拒绝使用请求体自报角色/);
});

test("monthly readiness is derived from active rule, fixed snapshot and evidence scope", async () => {
  const service = await readFile("src/lib/v5/knowledge-governance-service.ts", "utf8");

  assert.match(service, /readV5ReadinessContext/);
  assert.match(service, /rulePackageStatus/);
  assert.match(service, /sourceSnapshotHash/);
  assert.match(service, /globalBlockingGapIds/);
  assert.match(service, /maxMonthlyQuota/);
  assert.match(service, /evaluateG6/);
});

test("human review queue exposes only unresolved governance work", async () => {
  const repository = await readFile("src/lib/v5/knowledge-governance-review-repository.ts", "utf8");

  assert.match(repository, /review_status IN \('candidate', 'disputed'\)/);
  assert.match(repository, /claim_conflict WHERE product_id = \? AND status = 'open'/);
  assert.match(repository, /status IN \('open', 'in_progress'\)/);
  assert.match(repository, /status LIKE 'draft_pending_%'/);
  assert.match(repository, /review_status IN \('pending', 'changes_requested'\)/);
});

test("conflict and evidence-gap mutations require human ownership, complete evidence and concurrency guards", async () => {
  const service = await readFile("src/lib/v5/knowledge-governance-review-service.ts", "utf8");
  const repository = await readFile("src/lib/v5/knowledge-governance-review-repository.ts", "utf8");
  const combined = `${service}\n${repository}`;

  assert.match(service, /actor\.actorType !== "human"/);
  assert.match(repository, /SELECT \* FROM claim_conflict WHERE id = \? FOR UPDATE/);
  assert.match(repository, /claimDecisions\.length !== conflictClaimIds\.length/);
  assert.match(repository, /uniqueDecisionClaimIds\.size !== input\.claimDecisions\.length/);
  assert.match(repository, /decisionClaimIds\.some\(\(claimId\) => !conflictClaimIds\.includes\(claimId\)\)/);
  assert.match(repository, /selectedClaimId.*conflictClaimIds/);
  assert.match(repository, /SELECT \* FROM evidence_gap WHERE id = \? FOR UPDATE/);
  assert.match(repository, /resolvedBySourceIds\.length === 0/);
  assert.match(repository, /allowedActions\[currentStatus\]/);
  assert.match(repository, /source_asset WHERE id IN/);
  assert.match(repository, /approved_for_claim_extraction/);
  assert.match(repository, /triggerSourceIds/);
  assert.match(repository, /gap\.owner_role.*product_owner/);
  assert.match(combined, /version_conflict/);
  assert.match(combined, /governance_audit_event|writeV5GovernanceAudit/);
  assert.match(combined, /governance_idempotency_record|writeV5Idempotency/);
});

test("rule-package change review is role-scoped and audit-backed", async () => {
  const repository = await readFile("src/lib/v5/knowledge-governance-review-repository.ts", "utf8");

  assert.match(repository, /requiredRoles\.includes\(input\.role\)/);
  assert.match(repository, /input\.actor\.actorRole !== input\.role/);
  assert.match(repository, /status <> 'deferred' FOR UPDATE/);
  assert.match(repository, /requiredRoles\.every\(\(role\) => approvedRoles\.has\(role\)\)/);
  assert.match(repository, /already_reviewed/);
  assert.match(repository, /object_type, object_id, confirmation_unit, role, action, status/);
  assert.match(repository, /eventType: "rule_change_reviewed"/);
  assert.match(repository, /operationType: "review_rule_package_change"/);
});

test("rule-package rollback is explicit, historical, snapshot-bound and fail-closed", async () => {
  const service = await readFile("src/lib/v5/knowledge-governance-service.ts", "utf8");
  const repository = await readFile("src/lib/v5/knowledge-governance-repository.ts", "utf8");

  assert.match(service, /actor\.actorType !== "human" \|\| input\.actor\.actorRole !== "product_owner"/);
  assert.match(service, /targetRulePackageVersionId/);
  assert.match(service, /targetExpectedVersion/);
  assert.match(repository, /active_version_id = \? FOR UPDATE/);
  assert.match(repository, /String\(current\.rule_package_id\) !== String\(target\.rule_package_id\)/);
  assert.match(repository, /\["deprecated", "rolled_back"\]/);
  assert.match(repository, /!target\.immutable_at/);
  assert.match(repository, /!target\.approved_at \|\| !target\.approved_by/);
  assert.match(repository, /source_snapshot WHERE product_id = \? AND snapshot_hash = \?/);
  assert.match(repository, /status = 'rolled_back'/);
  assert.match(repository, /production_pool_suspended_by_rule_rollback/);
  assert.match(repository, /eventType: "rule_package_rollback_target_activated"/);
  assert.match(repository, /operationType: "rollback_rule_package_version"/);
});

test("monthly production pool requires active rule, approved readiness, fixed snapshot and bounded quota", async () => {
  const service = await readFile("src/lib/v5/knowledge-governance-production-pool-service.ts", "utf8");
  const repository = await readFile("src/lib/v5/knowledge-governance-production-pool-repository.ts", "utf8");

  assert.match(service, /actor\.actorType !== "human"/);
  assert.match(service, /\["product_owner", "business_owner"\]/);
  assert.match(service, /Number\.isInteger\(input\.monthlyQuota\)/);
  assert.match(repository, /FROM monthly_plan WHERE id = \? FOR UPDATE/);
  assert.match(repository, /p\.status = 'active' AND v\.status = 'active'/);
  assert.match(repository, /monthly_production_ready/);
  assert.match(repository, /String\(readiness\.status\) !== "approved"/);
  assert.match(repository, /sourceSnapshotHash !== String\(activeVersion\.source_snapshot_hash\)/);
  assert.match(repository, /FROM source_snapshot WHERE id = \? AND product_id = \? AND snapshot_hash = \?/);
  assert.match(repository, /input\.monthlyQuota > maxMonthlyQuota/);
  assert.match(repository, /currentVersion !== input\.expectedVersion/);
  assert.match(repository, /status = 'approved'.*activated_at = NOW\(\).*suspended_at = NULL/s);
  assert.match(repository, /eventType: "production_pool_activated"/);
  assert.match(repository, /operationType: "activate_production_pool_entry"/);
});

test("monthly production pool suspension is versioned, human-owned and audited", async () => {
  const repository = await readFile("src/lib/v5/knowledge-governance-production-pool-repository.ts", "utf8");

  assert.match(repository, /production_pool_entry WHERE monthly_plan_id = \? AND product_id = \? FOR UPDATE/);
  assert.match(repository, /String\(entry\.status\) !== "approved"/);
  assert.match(repository, /status = 'blocked', suspended_at = NOW\(\), version = version \+ 1/);
  assert.match(repository, /eventType: "production_pool_suspended"/);
  assert.match(repository, /operationType: "suspend_production_pool_entry"/);
});
