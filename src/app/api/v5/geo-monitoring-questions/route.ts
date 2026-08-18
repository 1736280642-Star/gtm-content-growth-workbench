import type { CreateGeoMonitoringQuestionRequest } from "@/lib/v5/geo-monitoring-contracts";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { activateGeoMonitoringQuestion, readGeoMonitoringWorkspace } from "@/lib/v5/geo-monitoring-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
    return observationOk(await readGeoMonitoringWorkspace(month));
  } catch (error) { return v5GovernanceErrorResponse(error); }
}

export async function POST(request: Request) {
  try { return observationOk(await activateGeoMonitoringQuestion((await readObservationPayload(request)) as unknown as CreateGeoMonitoringQuestionRequest), 201); }
  catch (error) { return v5GovernanceErrorResponse(error); }
}
