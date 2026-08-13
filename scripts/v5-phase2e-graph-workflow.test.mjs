import assert from "node:assert/strict";
import test from "node:test";
import { Command, MemorySaver } from "@langchain/langgraph";

import { createProductGeoWorkflow } from "../src/lib/v5/graph/product-geo-workflow";
import { createDomainShadowIdentityVersion } from "../src/lib/v5/graph/product-geo-workflow-service";

function initialState(suffix = "happy") {
  return {
    contractVersion: "product-geo-graph.v1",
    workflowId: `workflow-${suffix}`,
    threadId: `thread-${suffix}`,
    productId: "joto-workbuddy",
    sourceSnapshotId: "source-1",
    sourceSnapshotHash: "a".repeat(64),
    researchPolicyVersion: "geo-research.v2",
    executionMode: "shadow",
    providerRunIds: [],
    researchAttempt: 0,
    supplementaryRound: 0,
    status: "running",
    exceptionCodes: [],
    nodeHistory: []
  };
}

function decision(gate, expectedVersion = 1) {
  return {
    decision: "approve",
    actorId: "human-1",
    actorRole: "product_owner",
    reason: `${gate} human accepted`,
    idempotencyKey: `${gate}-idempotency-001`,
    expectedVersion
  };
}

function fakePorts(options = {}) {
  const calls = { research: 0, strategyApply: 0, sampleApply: 0 };
  const applied = new Set();
  const events = [];
  return {
    calls,
    events,
    ports: {
      async ensureSourceSnapshot(state) {
        return { sourceSnapshotId: state.sourceSnapshotId, sourceSnapshotHash: state.sourceSnapshotHash };
      },
      async runResearch() {
        calls.research += 1;
        if (options.failResearch) throw new Error("provider_timeout");
        const supplementRounds = options.supplementRounds ?? 0;
        return calls.research <= supplementRounds
          ? { disposition: "needs_supplement", providerRunIds: [`provider-${calls.research}`] }
          : { disposition: "passed", providerRunIds: [`provider-${calls.research}`], researchEvidencePackId: "evidence-pack-1" };
      },
      async compileStrategy() { return { strategyPackId: "strategy-pack-1" }; },
      async applyStrategyDecision(_state, input) {
        if (!applied.has(input.idempotencyKey)) { applied.add(input.idempotencyKey); calls.strategyApply += 1; }
        return { status: input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "changes_requested" };
      },
      async generateSample() { return { sampleTaskId: "sample-task-1", sampleDraftId: "sample-draft-1" }; },
      async applySampleDecision(_state, input) {
        if (!applied.has(input.idempotencyKey)) { applied.add(input.idempotencyKey); calls.sampleApply += 1; }
        return { status: input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "changes_requested", calibrationVersionId: "calibration-1" };
      },
      async onNodeEvent(event) { events.push(event); }
    }
  };
}

test("shadow Graph pauses at both Human gates and completes after explicit resumes", async () => {
  const fake = fakePorts({ supplementRounds: 2 });
  const graph = createProductGeoWorkflow(fake.ports, new MemorySaver());
  const config = { configurable: { thread_id: "thread-happy" } };

  const strategyPause = await graph.invoke(initialState(), config);
  assert.equal(strategyPause.status, "awaiting_strategy_review");
  assert.equal(strategyPause.supplementaryRound, 2);
  assert.equal(fake.calls.research, 3);
  assert.equal(strategyPause.providerRunIds.length, 3);
  assert.equal(strategyPause.__interrupt__[0].value.gate, "strategy_review");

  const samplePause = await graph.invoke(new Command({ resume: decision("strategy") }), config);
  assert.equal(samplePause.status, "awaiting_sample_review");
  assert.equal(fake.calls.strategyApply, 1);
  assert.equal(samplePause.__interrupt__[0].value.gate, "sample_review");

  const completed = await graph.invoke(new Command({ resume: decision("sample") }), config);
  assert.equal(completed.status, "completed");
  assert.equal(completed.calibrationVersionId, "calibration-1");
  assert.equal(fake.calls.sampleApply, 1);
});

test("research supplement loop has a hard maximum of two supplementary rounds", async () => {
  const fake = fakePorts({ supplementRounds: 99 });
  const graph = createProductGeoWorkflow(fake.ports, new MemorySaver());
  const result = await graph.invoke(initialState("loop"), { configurable: { thread_id: "thread-loop" } });
  assert.equal(result.supplementaryRound, 3);
  assert.equal(fake.calls.research, 3);
  assert.equal(result.strategyPackId, undefined);
});

test("provider failure is bounded by retry policy and never reaches a Human gate", async () => {
  const fake = fakePorts({ failResearch: true });
  const graph = createProductGeoWorkflow(fake.ports, new MemorySaver());
  await assert.rejects(
    graph.invoke(initialState("failure"), { configurable: { thread_id: "thread-failure" } }),
    /provider_timeout/
  );
  assert.equal(fake.calls.research, 2);
  assert.equal(fake.calls.strategyApply, 0);
  assert.equal(fake.calls.sampleApply, 0);
});

test("monthly production hot path has no Graph dependency", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("src/lib/v5/monthly-production-service.ts", "utf8"));
  assert.doesNotMatch(source, /langgraph|product-geo-workflow|geo_graph_workflow_run/i);
});

test("real domain Shadow reads formal truth but cannot own Human decisions", async () => {
  const { readFile } = await import("node:fs/promises");
  const [ports, route, service] = await Promise.all([
    readFile("src/lib/v5/graph/product-geo-domain-shadow-ports.ts", "utf8"),
    readFile("src/app/api/v5/products/[productId]/graph-shadow/route.ts", "utf8"),
    readFile("src/lib/v5/graph/product-geo-workflow-service.ts", "utf8")
  ]);
  assert.match(ports, /readLatestGeoSourceSnapshot/);
  assert.match(ports, /readGeoResearchWorkspace/);
  assert.match(ports, /readLatestProductStrategyPack/);
  assert.match(ports, /graph_shadow_formal_strategy_decision_missing/);
  assert.match(ports, /graph_shadow_formal_sample_decision_missing/);
  assert.doesNotMatch(ports, /decideProductGeoStrategyPack|decideSampleArticle/);
  assert.match(route, /startProductGeoDomainShadowWorkflow/);
  assert.match(route, /reconcileProductGeoDomainShadowWorkflow/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /geo-research\.v2\+domain-shadow\.v3/);
  assert.match(service, /executionMode: "shadow"/);
  assert.match(service, /reconcileProductGeoDomainShadowWorkflow/);
  const identity = createDomainShadowIdentityVersion("geo-research.v2+domain-shadow.v3", "strategy-pack-v8");
  assert.match(identity, /^geo-research\.v2\+domain-shadow\.v3\+s:[a-f0-9]{16}$/);
  assert.ok(identity.length <= 64);
});

test("a newer formal strategy receives a distinct Shadow checkpoint identity", () => {
  const base = "geo-research.v2+domain-shadow.v3";
  assert.notEqual(
    createDomainShadowIdentityVersion(base, "strategy-pack-v7"),
    createDomainShadowIdentityVersion(base, "strategy-pack-v8")
  );
});

test("formal Human routes reconcile Shadow only after the authoritative decision and degrade safely", async () => {
  const { readFile } = await import("node:fs/promises");
  const [strategyRoute, sampleRoute] = await Promise.all([
    readFile("src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", "utf8"),
    readFile("src/app/api/v5/drafts/[id]/sample-review/route.ts", "utf8")
  ]);
  for (const route of [strategyRoute, sampleRoute]) {
    assert.match(route, /await import\("@\/lib\/v5\/graph\/product-geo-workflow-service"\)/);
    assert.match(route, /status: "degraded"/);
    assert.match(route, /await reconcileGraphShadow/);
  }
  assert.ok(strategyRoute.indexOf("decideProductGeoStrategyPack") < strategyRoute.lastIndexOf("await reconcileGraphShadow"));
  assert.ok(sampleRoute.indexOf("decideSampleArticle") < sampleRoute.lastIndexOf("await reconcileGraphShadow"));
});
