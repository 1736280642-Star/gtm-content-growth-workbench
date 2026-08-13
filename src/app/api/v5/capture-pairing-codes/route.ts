import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk } from "@/lib/v5/observation-api";
import { createCapturePairingCode } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return observationOk(await createCapturePairingCode({ workspaceId: "local-workbench", userId: "local-workbench-user", ttlMinutes: 10 }), 201);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
