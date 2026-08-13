import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { createCaptureTask, listCaptureTasks } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
    return observationOk({ tasks: await listCaptureTasks(taskId) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

// Phase 1: Capture tasks - create task matrix
export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    const productId = String(payload.productId || "").trim();
    const question = String(payload.question || "").trim();
    const platform = String(payload.platform || "").trim();
    const idempotencyKey = String(payload.idempotencyKey || request.headers.get("x-idempotency-key") || "").trim();

    if (!productId || !question || !platform || !idempotencyKey) {
      throw new ObservationServiceError(400, "INVALID_TASK_PAYLOAD", "productId、question、platform 和 idempotencyKey 为必填项。");
    }
    return observationOk(await createCaptureTask({
      productId,
      question,
      platform,
      idempotencyKey,
      priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 0
    }), 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "CAPTURE_TASK_CREATE_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
