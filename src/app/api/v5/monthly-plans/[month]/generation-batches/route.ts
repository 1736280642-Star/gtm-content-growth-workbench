import { NextRequest, NextResponse } from "next/server";
import { createGenerationBatch } from "@/lib/v5/generation-batch-service";
import { V5ServiceError } from "@/lib/v5/monthly-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  const routeParams = await params;
  try {
    const body = await request.json() as { taskIds?: unknown; auditReason?: unknown };
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String) : [];
    const data = await createGenerationBatch(routeParams.month, taskIds, String(body.auditReason || ""));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "GENERATION_BATCH_CREATE_FAILED", "生成批次创建失败，请稍后重试。");
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
