import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { listV5Questions } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(listV5Questions());
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function POST() {
  return NextResponse.json({
    ok: false,
    error: { code: "MANUAL_QUESTION_ENTRY_RETIRED", message: "人工补充问题入口已停用，请在 GEO 调研结果中一次确认并纳入监控。" }
  }, { status: 410 });
}
