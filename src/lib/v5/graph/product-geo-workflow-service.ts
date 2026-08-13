import { Command } from "@langchain/langgraph";
import { createHash } from "node:crypto";
import type { V5GovernanceActor } from "../knowledge-governance-repository";
import { MySqlCheckpointSaver } from "./mysql-checkpoint-saver";
import {
  claimProductGeoGraphWorkflow,
  readLatestProductGeoGraphWorkflow,
  readProductGeoGraphWorkflow,
  recordProductGeoGraphNodeEvent,
  syncProductGeoGraphWorkflow
} from "./product-geo-workflow-repository";
import { productGeoGraphContractVersion, type HumanGraphDecision, type ProductGeoGraphPorts, type ProductGeoGraphStateValue } from "./product-geo-workflow-contracts";
import { createProductGeoWorkflow } from "./product-geo-workflow";
import { createProductGeoDomainShadowPorts } from "./product-geo-domain-shadow-ports";
import { readLatestGeoSourceSnapshot } from "../geo-research-repository";
import { readLatestProductStrategyPack } from "../product-strategy-pack-repository";
import { readLatestProductSampleArticle } from "../product-sample-article-service";
import { readSampleArticleReviewState } from "../sample-calibration-repository";

function graphState(value: unknown): ProductGeoGraphStateValue {
  return value as ProductGeoGraphStateValue;
}

export function createDomainShadowIdentityVersion(researchPolicyVersion: string, strategyPackId?: string) {
  const base = researchPolicyVersion.trim();
  if (!strategyPackId) return base;
  const strategyFingerprint = createHash("sha256").update(strategyPackId).digest("hex").slice(0, 16);
  return `${base}+s:${strategyFingerprint}`;
}

function auditedPorts(ports: ProductGeoGraphPorts): ProductGeoGraphPorts {
  return {
    ...ports,
    async onNodeEvent(event) {
      await ports.onNodeEvent?.(event);
      await recordProductGeoGraphNodeEvent(event);
    }
  };
}

export async function startProductGeoShadowWorkflow(input: {
  productId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  researchPolicyVersion: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
  ports: ProductGeoGraphPorts;
}) {
  const run = await claimProductGeoGraphWorkflow({ ...input, executionMode: "shadow" });
  if (run.status !== "running" || Object.keys(run.stateRefs).length) return run;
  const initial: ProductGeoGraphStateValue = {
    contractVersion: productGeoGraphContractVersion,
    workflowId: run.id,
    threadId: run.threadId,
    productId: run.productId,
    sourceSnapshotId: run.sourceSnapshotId,
    sourceSnapshotHash: run.sourceSnapshotHash,
    researchPolicyVersion: run.researchPolicyVersion,
    executionMode: "shadow",
    providerRunIds: [],
    researchAttempt: 0,
    supplementaryRound: 0,
    status: "running",
    exceptionCodes: [],
    nodeHistory: []
  };
  const graph = createProductGeoWorkflow(auditedPorts(input.ports), new MySqlCheckpointSaver());
  const result = await graph.invoke(initial, { configurable: { thread_id: run.threadId } });
  return syncProductGeoGraphWorkflow({ workflowId: run.id, expectedVersion: run.rowVersion, state: graphState(result) });
}

export async function startProductGeoDomainShadowWorkflow(input: {
  productId: string;
  researchPolicyVersion: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const [snapshot, strategy] = await Promise.all([
    readLatestGeoSourceSnapshot(input.productId),
    readLatestProductStrategyPack(input.productId)
  ]);
  if (!snapshot || snapshot.quality.status !== "ready") throw new Error("graph_shadow_source_snapshot_not_ready");
  return startProductGeoShadowWorkflow({
    ...input,
    // A product-profile correction can produce a new strategy without changing
    // the source snapshot. Include the formal strategy identity so an old
    // checkpoint can never be resumed against a newer Human decision target.
    researchPolicyVersion: createDomainShadowIdentityVersion(input.researchPolicyVersion, strategy?.id),
    sourceSnapshotId: snapshot.snapshotId,
    sourceSnapshotHash: snapshot.snapshotHash,
    ports: createProductGeoDomainShadowPorts()
  });
}

export async function resumeProductGeoShadowWorkflow(input: {
  workflowId: string;
  expectedWorkflowVersion: number;
  decision: HumanGraphDecision;
  ports: ProductGeoGraphPorts;
}) {
  const run = await readProductGeoGraphWorkflow(input.workflowId);
  if (!run) throw new Error("graph_workflow_not_found");
  if (run.executionMode !== "shadow") throw new Error("graph_active_cutover_blocked");
  if (run.rowVersion !== input.expectedWorkflowVersion) throw new Error("graph_workflow_stale_version");
  if (!["awaiting_strategy_review", "awaiting_sample_review"].includes(run.status)) throw new Error("graph_workflow_not_awaiting_human");
  const graph = createProductGeoWorkflow(auditedPorts(input.ports), new MySqlCheckpointSaver());
  const result = await graph.invoke(new Command({ resume: input.decision }), { configurable: { thread_id: run.threadId } });
  return syncProductGeoGraphWorkflow({ workflowId: run.id, expectedVersion: run.rowVersion, state: graphState(result) });
}

export async function reconcileProductGeoDomainShadowWorkflow(productId: string) {
  const run = await readLatestProductGeoGraphWorkflow(productId);
  if (!run) throw new Error("graph_workflow_not_found");
  const ports = createProductGeoDomainShadowPorts();
  if (run.status === "awaiting_strategy_review") {
    const strategy = await readLatestProductStrategyPack(productId);
    if (!strategy || strategy.id !== run.stateRefs.strategyPackId
      || !["strategy_approved", "pending_sample_review", "production_ready"].includes(strategy.status)
      || !strategy.strategyApprovedBy) return run;
    return resumeProductGeoShadowWorkflow({
      workflowId: run.id,
      expectedWorkflowVersion: run.rowVersion,
      decision: {
        decision: "approve",
        actorId: strategy.strategyApprovedBy,
        actorRole: "product_owner",
        reason: "Shadow 观察到正式产品策略已由用户确认",
        idempotencyKey: `shadow-observe-strategy:${strategy.id}:${strategy.rowVersion}`,
        expectedVersion: strategy.rowVersion
      },
      ports
    });
  }
  if (run.status === "awaiting_sample_review") {
    const sample = await readLatestProductSampleArticle(productId);
    const draftId = sample?.draft?.draftVersionId;
    if (!draftId || draftId !== run.stateRefs.sampleDraftId) return run;
    const review = await readSampleArticleReviewState(draftId);
    if (review.strategyStatus !== "production_ready" || review.latestDecision !== "approved"
      || !review.calibrationVersionId || !review.latestDecidedBy) return run;
    return resumeProductGeoShadowWorkflow({
      workflowId: run.id,
      expectedWorkflowVersion: run.rowVersion,
      decision: {
        decision: "approve",
        actorId: review.latestDecidedBy,
        actorRole: "content_reviewer",
        reason: "Shadow 观察到正式样稿已由用户验收",
        idempotencyKey: `shadow-observe-sample:${draftId}:${review.calibrationVersionId}`,
        expectedVersion: 1
      },
      ports
    });
  }
  return run;
}
