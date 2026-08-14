import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { getV5Question } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    return NextResponse.json(getV5Question(routeParams.id));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function PATCH() {
  return NextResponse.json({
    ok: false,
    error: { code: "QUESTION_POOL_GOVERNANCE_RETIRED", message: "问题池二次人工治理已停用；问题以 GEO 调研结果确认内容为准。" }
  }, { status: 410 });
}
