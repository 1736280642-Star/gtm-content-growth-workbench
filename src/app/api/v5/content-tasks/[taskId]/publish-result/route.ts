import { NextRequest, NextResponse } from "next/server";
import { parseSavePublishResultRequest, saveV5PublishResult, V5ServiceError } from "@/lib/v5/monthly-service";
import { V5GovernanceRepositoryError } from "@/lib/v5/knowledge-governance-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const data = await saveV5PublishResult(params.taskId, parseSavePublishResultRequest(await request.json()));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof V5GovernanceRepositoryError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction } }, { status: error.httpStatus });
    }
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "PUBLISH_RESULT_SAVE_FAILED", "发布结果保存失败，请稍后重试。");
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
