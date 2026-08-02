import { buildPublishReliabilityMetrics } from "@/lib/publish-reliability";
import { readWorkbenchState } from "@/lib/workbench-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = readWorkbenchState();
  return Response.json({
    generatedAt: new Date().toISOString(),
    metrics: buildPublishReliabilityMetrics(state.publishSchedules, state.publishAttempts)
  });
}
