import { readRequestPayload } from "@/lib/api-utils";
import { createPublishSchedules, readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const state = readWorkbenchState();

  return NextResponse.json({
    ok: true,
    status: "success",
    data: {
      schedules: state.publishSchedules,
      attempts: state.publishAttempts
    }
  });
}

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = createPublishSchedules(payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
