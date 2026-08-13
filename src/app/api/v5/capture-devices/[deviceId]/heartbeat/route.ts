import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk } from "@/lib/v5/observation-api";
import { heartbeatCaptureDevice } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Capture devices - heartbeat / keepalive
export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const routeParams = await params;
  try {
    const body = await _request.json().catch(() => ({}));
    return observationOk(await heartbeatCaptureDevice({
      deviceId: routeParams.deviceId,
      status: body.status || "online",
      adapterVersion: body.adapterVersion || undefined
    }));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
