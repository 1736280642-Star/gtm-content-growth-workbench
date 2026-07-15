import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateG0,
  evaluateG1,
  evaluateG2,
  evaluateG3,
  evaluateG4,
  evaluateG5,
  evaluateG6,
  evaluateV5GovernanceWorkflow
} from "../src/lib/v5/knowledge-governance-workflow.ts";

const hash = "a".repeat(64);
const baseClaim = {
  claimId: "claim-001",
  claimType: "capability",
  normalizedClaim: "唯客 AI 护栏可在 Dify 调用链中执行输入输出检测",
  originalQuote: "原文定位到 Dify 调用链中的输入输出检测能力。",
  sourceId: "src-001",
  sourceRevisionId: "src-rev-001",
  sourceLocatorAvailable: true,
  authorityLevel: "A2",
  supportMode: "direct",
  capabilityStatus: "current",
  claimScope: "public_product",
  conditions: [],
  limitations: [],
  productVersion: "current",
  reviewStatus: "supported"
};

const passingWorkflow = {
  G0: {
    safetyScanCompleted: true,
    detectedRiskTypes: [],
    visibility: "public",
    restrictedUseApproved: false,
    processingMode: "external_model",
    sourceAuthorized: true
  },
  G1: {
    parseStatus: "parsed",
    normalizedTextRef: "asset://normalized/src-001",
    title: "唯客 AI 护栏产品页",
    contentHash: hash,
    canonicalResolved: true,
    sourceLocatorAvailable: true,
    contentLength: 1200,
    qualityFlags: []
  },
  G2: {
    documentType: "official_product_page",
    authorityLevel: "A2",
    lifecycleStatus: "current",
    visibility: "public",
    classificationConfidence: 0.96,
    productMatchStatus: "confirmed",
    productId: "weike-ai-guardrail",
    humanClassificationConfirmed: false,
    requiresHighRiskReview: false
  },
  G3: {
    claims: [baseClaim],
    extractorVersion: "extractor-v1",
    sourceRevisionId: "src-rev-001"
  },
  G4: { conflicts: [], gaps: [] },
  G5: {
    actorType: "human",
    actorId: "owner-001",
    rulePackageVersionId: "rule-version-001",
    rulePackageStatus: "draft_pending_confirmation",
    productIdentityComplete: true,
    approvedClaimCount: 1,
    pendingRoles: [],
    approvals: [{ role: "product_owner", action: "approve", status: "approved" }],
    unresolvedBlockingConflictCount: 0,
    unresolvedBlockingGapCount: 0,
    sourceSnapshotHash: hash
  },
  G6: {
    productId: "weike-ai-guardrail",
    rulePackageVersionId: "rule-version-001",
    rulePackageStatus: "active",
    sourceSnapshotHash: hash,
    allowedContentTypes: ["product_explainer"],
    conditionalContentTypes: [],
    blockedContentTypes: ["performance_benchmark"],
    allowedChannels: ["wechat"],
    requiredEvidenceRoles: ["official_product_page"],
    evidenceGapIds: [],
    globalBlockingGapIds: [],
    maxMonthlyQuota: 4,
    evaluatorVersion: "readiness-v1"
  }
};

test("G0 isolates sensitive sources before any external model work", () => {
  const result = evaluateG0({
    ...passingWorkflow.G0,
    detectedRiskTypes: ["credential", "personal_information"]
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, "isolate");
  assert.equal(result.modelEligible, false);
  assert.equal(result.output.sourceStatus, "isolated");
});

test("G0 allows approved restricted material only in local-only mode", () => {
  const result = evaluateG0({
    ...passingWorkflow.G0,
    detectedRiskTypes: ["restricted_customer_data"],
    visibility: "restricted_customer",
    restrictedUseApproved: true,
    processingMode: "local_only"
  });

  assert.equal(result.status, "conditional");
  assert.equal(result.modelEligible, false);
});

test("G0 allows a batch to continue after unsafe sources were independently isolated", () => {
  const result = evaluateG0({
    ...passingWorkflow.G0,
    isolatedSourceCount: 1,
    eligibleSourceCount: 15
  });

  assert.equal(result.status, "conditional");
  assert.equal(result.ok, true);
  assert.equal(result.output.isolatedSourceCount, 1);
});

test("G1 blocks error pages and missing stable hashes", () => {
  const result = evaluateG1({
    ...passingWorkflow.G1,
    contentHash: undefined,
    qualityFlags: ["blocked_page"]
  });

  assert.equal(result.ok, false);
  assert.match(result.reasonCodes.join(" "), /content_hash_missing/);
  assert.match(result.reasonCodes.join(" "), /blocked_page/);
});

test("G2 never auto-creates or guesses an ambiguous product", () => {
  const result = evaluateG2({
    ...passingWorkflow.G2,
    productMatchStatus: "new_candidate",
    productId: undefined
  });

  assert.equal(result.status, "pending_input");
  assert.match(result.reasonCodes.join(" "), /entity_new_candidate/);
});

test("G3 keeps performance numbers blocked when test conditions are absent", () => {
  const result = evaluateG3({
    claims: [{ ...baseClaim, claimType: "performance_metric", hasMetricTestConditions: false }],
    extractorVersion: "extractor-v1",
    sourceRevisionId: "src-rev-001"
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reasonCodes.join(" "), /metric_conditions_missing/);
});

test("G3 forbids derived privacy and compliance claims", () => {
  const result = evaluateG3({
    claims: [{ ...baseClaim, claimType: "data_flow_privacy", supportMode: "derived" }],
    extractorVersion: "extractor-v1",
    sourceRevisionId: "src-rev-001"
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reasonCodes.join(" "), /derived_forbidden/);
});

test("G4 blocks unresolved conflicts without a conservative temporary policy", () => {
  const result = evaluateG4({
    conflicts: [{
      conflictId: "conflict-001",
      severity: "blocking",
      status: "open",
      requiredRoles: ["privacy_owner"]
    }],
    gaps: []
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.output.unresolvedBlockingConflictCount, 1);
});

test("G4 allows scoped gaps to continue only as conditional rules", () => {
  const result = evaluateG4({
    conflicts: [],
    gaps: [{
      gapId: "gap-performance-test",
      severity: "blocking",
      status: "open",
      affectedRuleFields: ["performance_metric"],
      ownerRole: "technical_owner"
    }]
  });

  assert.equal(result.status, "conditional");
  assert.deepEqual(result.output.evidenceGapIds, ["gap-performance-test"]);
});

test("G4 can generate a conservative draft while a blocking conflict remains unresolved", () => {
  const result = evaluateG4({
    conflicts: [{
      conflictId: "conflict-pii-count",
      severity: "blocking",
      status: "open",
      temporaryPolicy: "block_public_expression",
      requiredRoles: ["security_owner"]
    }],
    gaps: []
  });

  assert.equal(result.status, "conditional");
  assert.equal(result.output.unresolvedBlockingConflictCount, 1);
});

test("G5 refuses agent activation even when every approval exists", () => {
  const result = evaluateG5({ ...passingWorkflow.G5, actorType: "agent" });

  assert.equal(result.status, "blocked");
  assert.match(result.reasonCodes.join(" "), /human_activation_required/);
});

test("G5 requires every pending role to be resolved", () => {
  const result = evaluateG5({ ...passingWorkflow.G5, pendingRoles: ["privacy_owner"] });

  assert.equal(result.status, "pending_input");
  assert.match(result.reasonCodes.join(" "), /required_approvals_pending/);
});

test("G6 never converts a target quota into evidence readiness", () => {
  const result = evaluateG6({
    ...passingWorkflow.G6,
    allowedContentTypes: [],
    maxMonthlyQuota: 20
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.output.monthlyProductionReady, false);
});

test("complete G0-G6 path returns a scoped monthly production readiness", () => {
  const result = evaluateV5GovernanceWorkflow(passingWorkflow);

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.completedGates, ["G0", "G1", "G2", "G3", "G4", "G5", "G6"]);
  assert.equal(result.monthlyProductionReady, true);
});

test("workflow stops at the first failed gate and does not pretend later gates ran", () => {
  const result = evaluateV5GovernanceWorkflow({
    ...passingWorkflow,
    G0: { ...passingWorkflow.G0, detectedRiskTypes: ["credential"] }
  });

  assert.equal(result.currentGate, "G0");
  assert.deepEqual(result.completedGates, []);
  assert.equal(result.results.length, 1);
  assert.equal(result.monthlyProductionReady, false);
});
