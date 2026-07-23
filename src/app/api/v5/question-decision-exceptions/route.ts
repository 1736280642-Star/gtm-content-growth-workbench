import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { listV5Questions } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const result = listV5Questions();
    return NextResponse.json({ ok: true, status: "success", data: { exceptions: result.data.decisionExceptions, stateVersion: result.data.stateVersion } });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
