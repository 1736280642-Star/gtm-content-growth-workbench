import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { V5_KNOWLEDGE_WORKFLOW_RULES, evaluateV5KnowledgeWorkflow } from "../src/lib/v5-knowledge-workflow-policy.ts";

const baseOperation = {
  idempotencyKey: "test-operation-001",
  expectedVersion: 1,
  actorId: "test-operator",
  actorType: "human",
  auditReason: "V5 workflow policy regression test"
};

const readyGovernance = {
  approvedClaimCount: 3,
  requiredApprovalsComplete: true,
  unresolvedBlockingConflictCount: 0,
  rulePackageStatus: "active",
  rulePackageVersionId: "rule-v1",
  monthlyProductionReady: true,
  allowedContentTypes: ["technical"],
  allowedChannels: ["wechat"],
  maxMonthlyQuota: 4,
  ragManifestId: "manifest-v1"
};

const readyMonthly = {
  monthlyPlanId: "month-2026-07",
  strategyStatus: "approved",
  matrixVersionId: "matrix-v1",
  matrixItemId: "matrix-item-001",
  matrixStatus: "approved",
  evidencePreviewId: "preview-001",
  platformExpressionPrecheck: {
    evidenceSupported: true,
    bodyProvable: true,
    roleBoundarySafe: true,
    humanConfirmed: true
  }
};

const readyEvidence = {
  finalEvidencePackId: "evidence-pack-001",
  gateStatus: "generatable",
  downgradeApproved: false
};

function findFailure(decision, code) {
  return decision.failures.find((failure) => failure.code === code);
}

test("all policy rule codes are unique", () => {
  assert.equal(V5_KNOWLEDGE_WORKFLOW_RULES.length, 15);
  assert.equal(new Set(V5_KNOWLEDGE_WORKFLOW_RULES.map((rule) => rule.code)).size, V5_KNOWLEDGE_WORKFLOW_RULES.length);
});

test("every policy rule points to an existing design source", () => {
  const missingSources = V5_KNOWLEDGE_WORKFLOW_RULES.flatMap((rule) =>
    rule.sourceDocs.filter((sourceDoc) => !existsSync(sourceDoc)).map((sourceDoc) => `${rule.code}: ${sourceDoc}`)
  );

  assert.deepEqual(missingSources, []);
});

test("sensitive data blocks claim extraction before model work", () => {
  const decision = evaluateV5KnowledgeWorkflow("claim_extraction", {
    source: {
      sensitiveDataChecked: true,
      sensitiveDataDetected: true,
      parseStatus: "parsed",
      sourceId: "source-001",
      sourceRevisionId: "source-revision-001",
      sourceLocator: "line:1",
      productId: "product-001",
      documentType: "official_product_page",
      authorityLevel: "A2",
      visibility: "public"
    },
    operation: baseOperation
  });

  assert.equal(decision.status, "failed");
  assert.equal(findFailure(decision, "V5-KB-001")?.passed, false);
});

test("agent cannot activate a rule package", () => {
  const decision = evaluateV5KnowledgeWorkflow("rule_package_activation", {
    governance: readyGovernance,
    operation: { ...baseOperation, actorType: "agent" }
  });

  assert.equal(decision.status, "failed");
  assert.match(findFailure(decision, "V5-KB-003")?.message || "", /Agent/);
});

test("draft rule package and false readiness stay outside production pool", () => {
  const decision = evaluateV5KnowledgeWorkflow("production_pool_entry", {
    governance: {
      ...readyGovernance,
      rulePackageStatus: "draft_pending_business_confirmation",
      monthlyProductionReady: false
    },
    operation: baseOperation
  });

  assert.equal(decision.status, "pending_input");
  assert.equal(findFailure(decision, "V5-KB-005")?.passed, false);
});

test("RAG production ingestion reports missing embedding as pending_config", () => {
  const decision = evaluateV5KnowledgeWorkflow("rag_ingestion", {
    governance: readyGovernance,
    runtime: { embeddingConfigured: false },
    operation: baseOperation
  });

  assert.equal(decision.status, "pending_config");
  assert.equal(findFailure(decision, "V5-KB-010")?.status, "pending_config");
});

test("matrix approval requires a human actor", () => {
  const decision = evaluateV5KnowledgeWorkflow("matrix_approval", {
    governance: readyGovernance,
    monthly: readyMonthly,
    operation: { ...baseOperation, actorType: "agent" }
  });

  assert.equal(decision.status, "failed");
  assert.equal(findFailure(decision, "V5-KB-008")?.passed, false);
});

test("approved matrix with final evidence can enter batch generation", () => {
  const decision = evaluateV5KnowledgeWorkflow("batch_generation", {
    governance: readyGovernance,
    monthly: readyMonthly,
    evidence: readyEvidence,
    runtime: { providerConfigured: true },
    operation: { ...baseOperation, actorType: "system" }
  });

  assert.equal(decision.status, "success");
  assert.equal(decision.ok, true);
  assert.equal(decision.failures.length, 0);
});

test("downgraded evidence cannot generate without explicit approval", () => {
  const decision = evaluateV5KnowledgeWorkflow("batch_generation", {
    governance: readyGovernance,
    monthly: readyMonthly,
    evidence: {
      finalEvidencePackId: "evidence-pack-002",
      gateStatus: "generatable_with_downgrade",
      downgradeApproved: false
    },
    runtime: { providerConfigured: true },
    operation: baseOperation
  });

  assert.equal(decision.status, "failed");
  assert.equal(findFailure(decision, "V5-KB-009")?.passed, false);
});

test("local preview cannot enter publish schedule", () => {
  const decision = evaluateV5KnowledgeWorkflow("publish_schedule", {
    governance: readyGovernance,
    monthly: readyMonthly,
    evidence: readyEvidence,
    generation: {
      mode: "local_preview",
      hardRulePassed: true,
      qualityEvaluationPassed: true,
      draftVersionId: "draft-v1"
    },
    operation: baseOperation
  });

  assert.equal(decision.status, "failed");
  assert.equal(findFailure(decision, "V5-KB-011")?.passed, false);
});

test("draft_only capability cannot execute formal publication", () => {
  const decision = evaluateV5KnowledgeWorkflow("formal_publish", {
    monthly: readyMonthly,
    generation: { draftVersionId: "draft-v1" },
    runtime: { publishingPlatformConfigured: true },
    publishing: {
      publishScheduleId: "schedule-001",
      capability: "draft_only",
      approvalStatus: "approved",
      scheduleStatus: "scheduled"
    },
    operation: baseOperation
  });

  assert.equal(decision.status, "failed");
  assert.equal(findFailure(decision, "V5-KB-012")?.passed, false);
});

test("published state requires external success and a public URL", () => {
  const decision = evaluateV5KnowledgeWorkflow("publication_record", {
    monthly: readyMonthly,
    generation: { draftVersionId: "draft-v1" },
    publishing: {
      publishScheduleId: "schedule-001",
      externalResult: "success"
    },
    operation: baseOperation
  });

  assert.equal(decision.status, "pending_input");
  assert.equal(findFailure(decision, "V5-KB-013")?.passed, false);
});

test("monthly review rejects draft and pending config as published success", () => {
  const decision = evaluateV5KnowledgeWorkflow("monthly_review", {
    monthly: readyMonthly,
    review: {
      usesRealMetricsOnly: true,
      countsDraftCreatedAsPublished: true,
      countsManualHandoffAsPublished: false,
      countsPendingConfigAsPublished: false
    },
    operation: baseOperation
  });

  assert.equal(decision.status, "failed");
  assert.equal(findFailure(decision, "V5-KB-015")?.passed, false);
});
