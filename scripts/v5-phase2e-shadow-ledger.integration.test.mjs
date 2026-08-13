import assert from "node:assert/strict";
import test from "node:test";
import { loadProjectEnv } from "./load-project-env.mjs";

import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository";
import { startProductGeoShadowWorkflow, resumeProductGeoShadowWorkflow } from "../src/lib/v5/graph/product-geo-workflow-service";
import { MySqlCheckpointSaver } from "../src/lib/v5/graph/mysql-checkpoint-saver";

loadProjectEnv();
const required = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

test("shadow runner persists node audit and rejects stale Human resume", { skip: missing.length ? `missing ${missing.join(",")}` : false }, async () => {
  const pool = getV5GovernancePool();
  let workflow;
  const ports = {
    async ensureSourceSnapshot(state) { return { sourceSnapshotId: state.sourceSnapshotId, sourceSnapshotHash: state.sourceSnapshotHash }; },
    async runResearch() { return { disposition: "passed", providerRunIds: ["provider-run-1"], researchEvidencePackId: "evidence-pack-1" }; },
    async compileStrategy() { return { strategyPackId: "strategy-pack-observed" }; },
    async applyStrategyDecision() { return { status: "approved" }; },
    async generateSample() { return { sampleTaskId: "sample-task-observed", sampleDraftId: "sample-draft-observed" }; },
    async applySampleDecision() { return { status: "approved", calibrationVersionId: "calibration-observed" }; }
  };
  try {
    workflow = await startProductGeoShadowWorkflow({
      productId: `phase2e-product-${suffix}`,
      sourceSnapshotId: `source-${suffix}`,
      sourceSnapshotHash: "d".repeat(64),
      researchPolicyVersion: `policy-${suffix}`,
      idempotencyKey: `start-${suffix}`,
      actor: { actorId: "phase2e-human", actorRole: "product_owner", actorType: "human", auditReason: "Phase 2E shadow integration" },
      ports
    });
    assert.equal(workflow.status, "awaiting_strategy_review");
    assert.equal(workflow.rowVersion, 2);

    await assert.rejects(
      resumeProductGeoShadowWorkflow({
        workflowId: workflow.id,
        expectedWorkflowVersion: 1,
        decision: { decision: "approve", actorId: "human", actorRole: "product_owner", reason: "stale", idempotencyKey: `stale-${suffix}`, expectedVersion: 1 },
        ports
      }),
      /graph_workflow_stale_version/
    );

    const samplePause = await resumeProductGeoShadowWorkflow({
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.rowVersion,
      decision: { decision: "approve", actorId: "human", actorRole: "product_owner", reason: "strategy accepted", idempotencyKey: `strategy-${suffix}`, expectedVersion: 1 },
      ports
    });
    assert.equal(samplePause.status, "awaiting_sample_review");
    const [events] = await pool.query("SELECT node_name, status FROM geo_graph_node_event WHERE workflow_run_id = ? ORDER BY id", [workflow.id]);
    assert.ok(events.some((event) => event.node_name === "research" && event.status === "completed"));
    assert.ok(events.some((event) => event.node_name === "generate_sample" && event.status === "completed"));
  } finally {
    if (workflow) {
      await new MySqlCheckpointSaver().deleteThread(workflow.threadId);
      await pool.query("DELETE FROM geo_graph_node_event WHERE workflow_run_id = ?", [workflow.id]);
      await pool.query("DELETE FROM governance_audit_event WHERE object_type = 'geo_graph_workflow_run' AND object_id = ?", [workflow.id]);
      await pool.query("DELETE FROM geo_graph_workflow_run WHERE id = ?", [workflow.id]);
    }
    await pool.end();
  }
});
