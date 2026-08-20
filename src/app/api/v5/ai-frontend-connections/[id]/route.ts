import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import type { AiFrontendConnectionStatus } from "@/lib/v5/observation-contracts";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { revokeAiFrontendConnection, updateAiFrontendConnectionStatus } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const mutableStatuses = new Set<AiFrontendConnectionStatus>(["ready", "needs_login", "isolation_unverified", "offline"]);

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await readObservationPayload(request);
    const deviceId = String(payload.deviceId || "").trim();
    const status = String(payload.status || "") as AiFrontendConnectionStatus;
    if (!deviceId || !mutableStatuses.has(status)) {
      throw new ObservationServiceError(400, "AI_FRONTEND_CONNECTION_STATUS_INVALID", "deviceId 和有效 status 为必填项。");
    }
    return observationOk(await updateAiFrontendConnectionStatus({
      connectionId: id,
      deviceId,
      status: status as Exclude<AiFrontendConnectionStatus, "revoked">,
      lastError: payload.lastError ? String(payload.lastError) : undefined,
      verified: payload.verified === true
    }));
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "AI_FRONTEND_CONNECTION_UPDATE_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return observationOk(await revokeAiFrontendConnection(id));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
