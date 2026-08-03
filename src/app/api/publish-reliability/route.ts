import {
  buildPublishReliabilityMetrics,
  evaluatePublishRolloutReadiness,
  getPublishReliabilityThresholds
} from "@/lib/publish-reliability";
import { readWorkbenchState } from "@/lib/workbench-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = readWorkbenchState();
  const metrics = buildPublishReliabilityMetrics(state.publishSchedules, state.publishAttempts);
  const thresholds = getPublishReliabilityThresholds();
  const readiness = evaluatePublishRolloutReadiness(metrics, thresholds);
  return Response.json({
    generatedAt: new Date().toISOString(),
    metrics,
    thresholds,
    readiness,
    rolloutReady: readiness.every((item) => item.ready)
  });
}
