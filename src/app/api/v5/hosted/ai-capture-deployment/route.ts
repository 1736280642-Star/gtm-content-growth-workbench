import type { RowDataPacket } from "mysql2/promise";
import { createCapturePairingCode, listAiFrontendConnections, listCaptureDevices } from "@/lib/v5/capture-repository";
import {
  DEPLOYMENT_CAPTURE_USER_ID,
  DEPLOYMENT_CAPTURE_WORKSPACE_ID,
  requireHostedCaptureSetupToken
} from "@/lib/v5/hosted-capture-deployment-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getV5GovernancePool } from "@/lib/v5/knowledge-governance-repository";
import { observationOk } from "@/lib/v5/observation-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    requireHostedCaptureSetupToken(String(form.get("setupToken") || ""));
    const action = String(form.get("action") || "status");
    if (action === "pair") {
      return observationOk(await createCapturePairingCode({
        workspaceId: DEPLOYMENT_CAPTURE_WORKSPACE_ID,
        userId: DEPLOYMENT_CAPTURE_USER_ID,
        executionScope: "deployment_shared",
        ttlMinutes: 10
      }), 201);
    }
    if (action !== "status") throw new ObservationServiceError(400, "CAPTURE_DEPLOYMENT_ACTION_INVALID", "不支持的部署操作。");
    const [devices, connections, queueRows] = await Promise.all([
      listCaptureDevices({ executionScope: "deployment_shared" }),
      listAiFrontendConnections({ executionScope: "deployment_shared" }),
      getV5GovernancePool().query<RowDataPacket[]>(
        `SELECT status, COUNT(*) AS total FROM capture_tasks
         WHERE connection_id IN (SELECT connection_id FROM ai_frontend_connections WHERE execution_scope = 'deployment_shared')
           AND status IN ('pending', 'leased') GROUP BY status`
      )
    ]);
    const queue = Object.fromEntries(queueRows[0].map((row) => [String(row.status), Number(row.total || 0)]));
    return observationOk({ devices, connections, queue });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
