import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "@langchain/langgraph";

import { loadProjectEnv } from "./load-project-env.mjs";
import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository";
import { MySqlCheckpointSaver } from "../src/lib/v5/graph/mysql-checkpoint-saver";
import { createProductGeoWorkflow } from "../src/lib/v5/graph/product-geo-workflow";

loadProjectEnv();
const required = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const threadId = `phase2e-restart-${suffix}`;

function humanDecision(gate) {
  return {
    decision: "approve",
    actorId: "phase2e-human",
    actorRole: "product_owner",
    reason: `Human accepted ${gate}`,
    idempotencyKey: `${gate}-${suffix}`,
    expectedVersion: 1
  };
}

test("MySQL checkpoint resumes both Human gates after graph process recreation", { skip: missing.length ? `missing ${missing.join(",")}` : false }, async () => {
  const calls = { strategy: 0, sample: 0 };
  const acceptedKeys = new Set();
  const ports = {
    async ensureSourceSnapshot(state) { return { sourceSnapshotId: state.sourceSnapshotId, sourceSnapshotHash: state.sourceSnapshotHash }; },
    async runResearch() { return { disposition: "passed", providerRunIds: ["zhipu-run-1"], researchEvidencePackId: "evidence-pack-1" }; },
    async compileStrategy() { return { strategyPackId: "strategy-pack-1" }; },
    async applyStrategyDecision(_state, decision) {
      if (!acceptedKeys.has(decision.idempotencyKey)) { acceptedKeys.add(decision.idempotencyKey); calls.strategy += 1; }
      return { status: "approved" };
    },
    async generateSample() { return { sampleTaskId: "sample-task-1", sampleDraftId: "sample-draft-1" }; },
    async applySampleDecision(_state, decision) {
      if (!acceptedKeys.has(decision.idempotencyKey)) { acceptedKeys.add(decision.idempotencyKey); calls.sample += 1; }
      return { status: "approved", calibrationVersionId: "calibration-1" };
    }
  };
  const initial = {
    contractVersion: "product-geo-graph.v1",
    workflowId: `workflow-${suffix}`,
    threadId,
    productId: "joto-workbuddy",
    sourceSnapshotId: "source-1",
    sourceSnapshotHash: "c".repeat(64),
    researchPolicyVersion: "geo-research.v2",
    executionMode: "shadow",
    providerRunIds: [],
    researchAttempt: 0,
    supplementaryRound: 0,
    status: "running",
    exceptionCodes: [],
    nodeHistory: []
  };
  const config = { configurable: { thread_id: threadId } };
  const firstSaver = new MySqlCheckpointSaver();
  try {
    const firstProcess = createProductGeoWorkflow(ports, firstSaver);
    const strategyPause = await firstProcess.invoke(initial, config);
    assert.equal(strategyPause.__interrupt__[0].value.gate, "strategy_review");

    const secondProcess = createProductGeoWorkflow(ports, new MySqlCheckpointSaver());
    const samplePause = await secondProcess.invoke(new Command({ resume: humanDecision("strategy") }), config);
    assert.equal(samplePause.__interrupt__[0].value.gate, "sample_review");
    assert.equal(calls.strategy, 1);

    const thirdProcess = createProductGeoWorkflow(ports, new MySqlCheckpointSaver());
    const complete = await thirdProcess.invoke(new Command({ resume: humanDecision("sample") }), config);
    assert.equal(complete.status, "completed");
    assert.equal(calls.sample, 1);

    const tuple = await new MySqlCheckpointSaver().getTuple(config);
    assert.ok(tuple?.checkpoint.id);
    assert.equal(tuple.config.configurable.thread_id, threadId);
  } finally {
    await firstSaver.deleteThread(threadId);
    await getV5GovernancePool().end();
  }
});
