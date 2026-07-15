import { NextRequest, NextResponse } from "next/server";
import type { V5ApiEnvelope, V5MonthlyWorkspace } from "@/lib/v5/monthly-workspace-contracts";
import { getV5MonthlyWorkspace, V5ServiceError } from "@/lib/v5/monthly-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get("month") || undefined;
    const data = await getV5MonthlyWorkspace(month);
    return NextResponse.json<V5ApiEnvelope<V5MonthlyWorkspace>>(
      { ok: true, data },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const serviceError = error instanceof V5ServiceError ? error : new V5ServiceError(500, "V5_WORKSPACE_READ_FAILED", "V5 月度工作区读取失败，请稍后重试。");
    return NextResponse.json<V5ApiEnvelope<never>>(
      {
        ok: false,
        error: { code: serviceError.code, message: serviceError.message, details: serviceError.details }
      },
      { status: serviceError.status }
    );
  }
}
