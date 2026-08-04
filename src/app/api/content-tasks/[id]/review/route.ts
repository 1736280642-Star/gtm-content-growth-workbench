import { readRequestPayload } from "@/lib/api-utils";
import { rejectContentTask, restoreRejectedContentTask } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "reject";
  const result =
    action === "restore"
      ? restoreRejectedContentTask(routeParams.id, payload)
      : action === "reject"
        ? rejectContentTask(routeParams.id, payload)
        : {
            ok: false,
            status: "failed" as const,
            message: `不支持的计划项复核动作：${action}`
          };

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
