import { readRequestPayload } from "@/lib/api-utils";
import { getPromptVersionDetail, rollbackPromptVersion } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = getPromptVersionDetail(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "rollback";
  const result =
    action === "rollback"
      ? rollbackPromptVersion(routeParams.id, payload)
      : {
          ok: false,
          status: "failed" as const,
          message: `不支持的模型规则版本动作：${action}`
        };

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
