import { NextRequest, NextResponse } from "next/server";
import { V5GovernanceRepositoryError } from "@/lib/v5/knowledge-governance-repository";
import { interceptV5ProductionTask, parseStrategyMutationRequest, V5ServiceError } from "@/lib/v5/monthly-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ month: string; taskId: string }> }
) {
  const { month, taskId } = await params;
  try {
    const data = await interceptV5ProductionTask(month, taskId, parseStrategyMutationRequest(await request.json()));
    return NextResponse.json({ ok: true, data, message: "已拦截发布，文章不会进入后续自动发布。" });
  } catch (error) {
    const detail = error instanceof V5ServiceError
      ? { status: error.status, code: error.code, message: error.message, details: error.details }
      : error instanceof V5GovernanceRepositoryError
        ? { status: error.httpStatus, code: error.code, message: error.message, details: error.nextAction ? [error.nextAction] : undefined }
        : { status: 500, code: "PUBLISH_INTERCEPTION_FAILED", message: "拦截发布失败，请稍后重试。", details: undefined };
    return NextResponse.json(
      { ok: false, error: { code: detail.code, message: detail.message, details: detail.details } },
      { status: detail.status }
    );
  }
}
