import { NextRequest, NextResponse } from "next/server";
import { mutateGenerationBatch, type GenerationBatchAction } from "@/lib/v5/generation-batch-service";
import { V5ServiceError } from "@/lib/v5/monthly-service";

const actions: GenerationBatchAction[] = ["start", "pause", "resume", "claim-next", "task-completed", "task-failed", "cancel"];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const routeParams = await params;
  try {
    const body = await request.json() as { action?: unknown; taskId?: unknown };
    const action = String(body.action || "") as GenerationBatchAction;
    if (!actions.includes(action)) throw new V5ServiceError(422, "INVALID_GENERATION_BATCH_ACTION", "生成批次操作不正确。");
    const data = await mutateGenerationBatch(routeParams.batchId, action, body.taskId ? String(body.taskId) : undefined);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "GENERATION_BATCH_UPDATE_FAILED", "生成批次更新失败，请稍后重试。");
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
