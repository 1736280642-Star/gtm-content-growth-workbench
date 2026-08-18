import type { UpdateGeoMonitoringQuestionRequest } from "@/lib/v5/geo-monitoring-contracts";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { reviseGeoMonitoringQuestion } from "@/lib/v5/geo-monitoring-service";

export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return observationOk(await reviseGeoMonitoringQuestion((await params).id, (await readObservationPayload(request)) as unknown as UpdateGeoMonitoringQuestionRequest)); }
  catch (error) { return v5GovernanceErrorResponse(error); }
}
