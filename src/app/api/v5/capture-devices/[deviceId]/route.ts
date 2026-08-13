import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk } from "@/lib/v5/observation-api";
import { revokeCaptureDevice } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Capture devices - revoke/unpair a device
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const routeParams = await params;
  try {
    return observationOk(await revokeCaptureDevice(routeParams.deviceId));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
