import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import {
  assertHumanGraphDecision,
  type HumanGraphDecision,
  type ProductGeoGraphPorts,
  type ProductGeoGraphStateValue
} from "./product-geo-workflow-contracts";

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export const ProductGeoGraphState = Annotation.Root({
  contractVersion: Annotation<ProductGeoGraphStateValue["contractVersion"]>(),
  workflowId: Annotation<string>(),
  threadId: Annotation<string>(),
  productId: Annotation<string>(),
  sourceSnapshotId: Annotation<string>(),
  sourceSnapshotHash: Annotation<string>(),
  researchPolicyVersion: Annotation<string>(),
  executionMode: Annotation<ProductGeoGraphStateValue["executionMode"]>(),
  providerRunIds: Annotation<string[]>({ reducer: (left, right) => unique([...left, ...right]), default: () => [] }),
  researchEvidencePackId: Annotation<string | undefined>(),
  researchAttempt: Annotation<number>(),
  supplementaryRound: Annotation<number>(),
  researchDisposition: Annotation<ProductGeoGraphStateValue["researchDisposition"]>(),
  strategyPackId: Annotation<string | undefined>(),
  strategyDecision: Annotation<HumanGraphDecision | undefined>(),
  sampleTaskId: Annotation<string | undefined>(),
  sampleDraftId: Annotation<string | undefined>(),
  sampleDecision: Annotation<HumanGraphDecision | undefined>(),
  calibrationVersionId: Annotation<string | undefined>(),
  status: Annotation<ProductGeoGraphStateValue["status"]>(),
  currentNode: Annotation<string | undefined>(),
  exceptionCodes: Annotation<string[]>({ reducer: (left, right) => unique([...left, ...right]), default: () => [] }),
  nodeHistory: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] })
});

type GraphState = typeof ProductGeoGraphState.State;

function refs(state: GraphState) {
  return {
    productId: state.productId,
    sourceSnapshotId: state.sourceSnapshotId,
    researchEvidencePackId: state.researchEvidencePackId,
    strategyPackId: state.strategyPackId,
    sampleDraftId: state.sampleDraftId
  };
}

function wrapNode(
  ports: ProductGeoGraphPorts,
  nodeName: string,
  action: (state: GraphState) => Promise<Partial<GraphState>> | Partial<GraphState>
) {
  return async (state: GraphState) => {
    const startedAt = Date.now();
    try {
      const output = await action(state);
      await ports.onNodeEvent?.({
        workflowId: state.workflowId,
        threadId: state.threadId,
        nodeName,
        status: "completed",
        inputRefs: refs(state),
        outputRefs: { ...refs({ ...state, ...output } as GraphState), status: output.status },
        durationMs: Date.now() - startedAt
      });
      return { ...output, currentNode: nodeName, nodeHistory: [nodeName] };
    } catch (error) {
      const errorCode = error instanceof Error && error.message ? error.message.slice(0, 64) : "graph_node_failed";
      await ports.onNodeEvent?.({
        workflowId: state.workflowId,
        threadId: state.threadId,
        nodeName,
        status: "failed",
        inputRefs: refs(state),
        outputRefs: {},
        durationMs: Date.now() - startedAt,
        errorCode
      });
      throw error;
    }
  };
}

export function createProductGeoWorkflow(ports: ProductGeoGraphPorts, checkpointer: BaseCheckpointSaver) {
  const sourceSnapshot = wrapNode(ports, "source_snapshot", async (state) => ({
    ...await ports.ensureSourceSnapshot(state),
    status: "running" as const
  }));

  const research = wrapNode(ports, "research", async (state) => {
    const result = await ports.runResearch(state);
    return {
      providerRunIds: result.providerRunIds ?? [],
      researchEvidencePackId: result.researchEvidencePackId,
      researchDisposition: result.disposition,
      researchAttempt: state.researchAttempt + 1,
      supplementaryRound: result.disposition === "needs_supplement" ? state.supplementaryRound + 1 : state.supplementaryRound,
      status: result.disposition === "pending_config" ? "awaiting_research_config" as const : result.disposition === "failed" ? "failed" as const : "running" as const,
      exceptionCodes: result.errorCode ? [result.errorCode] : []
    };
  });

  const compileStrategy = wrapNode(ports, "compile_strategy", async (state) => ({
    ...await ports.compileStrategy(state),
    status: "awaiting_strategy_review" as const
  }));

  // Interrupt nodes have no side effects before interrupt(): resumption may re-enter a node.
  const strategyReview = (state: GraphState) => {
    const decision = interrupt({ gate: "strategy_review", workflowId: state.workflowId, strategyPackId: state.strategyPackId });
    assertHumanGraphDecision(decision);
    return { strategyDecision: decision, status: "awaiting_strategy_review" as const, currentNode: "strategy_review", nodeHistory: ["strategy_review"] };
  };

  const applyStrategyDecision = wrapNode(ports, "apply_strategy_decision", async (state) => {
    if (!state.strategyDecision) throw new Error("strategy_decision_missing");
    const result = await ports.applyStrategyDecision(state, state.strategyDecision);
    return { status: result.status === "approved" ? "running" as const : "awaiting_changes" as const };
  });

  const generateSample = wrapNode(ports, "generate_sample", async (state) => ({
    ...await ports.generateSample(state),
    status: "awaiting_sample_review" as const
  }));

  const sampleReview = (state: GraphState) => {
    const decision = interrupt({ gate: "sample_review", workflowId: state.workflowId, sampleDraftId: state.sampleDraftId });
    assertHumanGraphDecision(decision);
    return { sampleDecision: decision, status: "awaiting_sample_review" as const, currentNode: "sample_review", nodeHistory: ["sample_review"] };
  };

  const applySampleDecision = wrapNode(ports, "apply_sample_decision", async (state) => {
    if (!state.sampleDecision) throw new Error("sample_decision_missing");
    const result = await ports.applySampleDecision(state, state.sampleDecision);
    return {
      calibrationVersionId: result.calibrationVersionId,
      status: result.status === "approved" ? "completed" as const : "awaiting_changes" as const
    };
  });

  return new StateGraph(ProductGeoGraphState)
    .addNode("source_snapshot", sourceSnapshot)
    .addNode("research", research, { retryPolicy: { maxAttempts: 2 }, timeout: 120_000 })
    .addNode("compile_strategy", compileStrategy, { retryPolicy: { maxAttempts: 2 }, timeout: 60_000 })
    .addNode("strategy_review", strategyReview)
    .addNode("apply_strategy_decision", applyStrategyDecision)
    .addNode("generate_sample", generateSample, { retryPolicy: { maxAttempts: 2 }, timeout: 120_000 })
    .addNode("sample_review", sampleReview)
    .addNode("apply_sample_decision", applySampleDecision)
    .addEdge(START, "source_snapshot")
    .addEdge("source_snapshot", "research")
    .addConditionalEdges("research", (state) => {
      if (state.researchDisposition === "passed") return "compile_strategy";
      if (state.researchDisposition === "needs_supplement" && state.supplementaryRound <= 2) return "research";
      return END;
    })
    .addEdge("compile_strategy", "strategy_review")
    .addEdge("strategy_review", "apply_strategy_decision")
    .addConditionalEdges("apply_strategy_decision", (state) => state.status === "running" ? "generate_sample" : END)
    .addEdge("generate_sample", "sample_review")
    .addEdge("sample_review", "apply_sample_decision")
    .addEdge("apply_sample_decision", END)
    .compile({ checkpointer });
}
