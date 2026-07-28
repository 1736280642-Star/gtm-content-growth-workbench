import { readRequestPayload } from "@/lib/api-utils";
import { getPromptVersionDetail, rollbackPromptVersion } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { id: string } }) {
  const result = getPromptVersionDetail(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "rollback";
  const result =
    action === "rollback"
      ? rollbackPromptVersion(params.id, payload)
      : {
          ok: false,
          status: "failed" as const,
          message: `不支持的模型规则版本动作：${action}`
        };

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
