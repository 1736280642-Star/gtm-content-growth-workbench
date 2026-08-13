import { readGeoResearchWorkspace, readLatestGeoSourceSnapshot } from "../geo-research-repository";
import { readLatestProductSampleArticle } from "../product-sample-article-service";
import { readLatestProductStrategyPack } from "../product-strategy-pack-repository";
import { readSampleArticleReviewState } from "../sample-calibration-repository";
import type { ProductGeoGraphPorts } from "./product-geo-workflow-contracts";

/**
 * Real domain adapter for Shadow mode. It may read formal business truth and
 * create Graph-only checkpoints/audit, but it never writes strategy/sample
 * decisions. Human approvals remain owned by the existing deterministic APIs.
 */
export function createProductGeoDomainShadowPorts(): ProductGeoGraphPorts {
  return {
    async ensureSourceSnapshot(state) {
      const snapshot = await readLatestGeoSourceSnapshot(state.productId);
      if (!snapshot || snapshot.quality.status !== "ready") throw new Error("graph_shadow_source_snapshot_not_ready");
      if (snapshot.snapshotId !== state.sourceSnapshotId || snapshot.snapshotHash !== state.sourceSnapshotHash) {
        throw new Error("graph_shadow_source_snapshot_changed");
      }
      return { sourceSnapshotId: snapshot.snapshotId, sourceSnapshotHash: snapshot.snapshotHash };
    },
    async runResearch(state) {
      const workspace = await readGeoResearchWorkspace(state.productId);
      const run = workspace?.latestRun;
      if (!run) return { disposition: "pending_config", errorCode: "graph_shadow_research_run_missing" };
      const providerRunIds = [...new Set(workspace.latestEvidence.flatMap((evidence) => {
        const values = evidence.contentLocator.providerRunIds;
        return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
      }))];
      if (run.status === "failed" || run.status === "blocked") {
        return { disposition: "failed", providerRunIds, errorCode: run.failureCode || `graph_shadow_research_${run.status}` };
      }
      if (!["pending_review", "completed"].includes(run.status) || !run.liveSearchVerified) {
        return { disposition: "pending_config", providerRunIds, errorCode: "graph_shadow_research_not_completed" };
      }
      const strategy = await readLatestProductStrategyPack(state.productId);
      const evidencePackId = strategy?.contentPlan && "researchEvidencePackId" in strategy.contentPlan
        ? String(strategy.contentPlan.researchEvidencePackId || "")
        : "";
      if (!evidencePackId) return { disposition: "needs_supplement", providerRunIds, errorCode: "graph_shadow_evidence_pack_missing" };
      return { disposition: "passed", providerRunIds, researchEvidencePackId: evidencePackId };
    },
    async compileStrategy(state) {
      const strategy = await readLatestProductStrategyPack(state.productId);
      if (!strategy || !strategy.contentPlan || strategy.contentPlan.sourceSnapshotId !== state.sourceSnapshotId) {
        throw new Error("graph_shadow_strategy_not_ready");
      }
      return { strategyPackId: strategy.id };
    },
    async applyStrategyDecision(state) {
      const strategy = await readLatestProductStrategyPack(state.productId);
      if (!strategy || strategy.id !== state.strategyPackId) throw new Error("graph_shadow_strategy_reference_changed");
      if (!["strategy_approved", "pending_sample_review", "production_ready"].includes(strategy.status)) {
        throw new Error("graph_shadow_formal_strategy_decision_missing");
      }
      return { status: "approved" };
    },
    async generateSample(state) {
      const sample = await readLatestProductSampleArticle(state.productId);
      if (!sample?.draft?.draftVersionId) throw new Error("graph_shadow_sample_not_generated_by_formal_flow");
      return { sampleTaskId: sample.taskId, sampleDraftId: sample.draft.draftVersionId };
    },
    async applySampleDecision(state) {
      if (!state.sampleDraftId) throw new Error("graph_shadow_sample_reference_missing");
      const review = await readSampleArticleReviewState(state.sampleDraftId);
      if (review.strategyStatus !== "production_ready" || review.latestDecision !== "approved" || !review.calibrationVersionId) {
        throw new Error("graph_shadow_formal_sample_decision_missing");
      }
      return { status: "approved", calibrationVersionId: review.calibrationVersionId };
    }
  };
}
