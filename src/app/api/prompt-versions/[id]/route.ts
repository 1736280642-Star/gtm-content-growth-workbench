import { readRequestPayload } from "@/lib/api-utils";
import { canManagePromptVersions, canViewAiGovernance } from "@/lib/permissions";
import { getPromptVersionDetail, readWorkbenchState, rollbackPromptVersion } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { id: string } }) {
  const state = readWorkbenchState();

  if (!canViewAiGovernance(state.workspaceSetting.currentRole)) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "当前角色无权查看模型规则版本详情。"
      },
      { status: 403 }
    );
  }

  const result = getPromptVersionDetail(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const state = readWorkbenchState();

  if (!canManagePromptVersions(state.workspaceSetting.currentRole)) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "当前角色无权回滚模型规则版本。"
      },
      { status: 403 }
    );
  }

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
