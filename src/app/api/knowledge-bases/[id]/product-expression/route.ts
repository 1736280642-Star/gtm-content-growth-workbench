import { readRequestPayload } from "@/lib/api-utils";
import { canManageProductExpressionRules } from "@/lib/permissions";
import {
  activateProductExpressionRuleDraft,
  discardProductExpressionRuleDraft,
  readWorkbenchState,
  regenerateProductExpressionRuleDraft,
  rollbackProductExpressionRuleDraft
} from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const state = readWorkbenchState();

  if (!canManageProductExpressionRules(state.workspaceSetting.currentRole)) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "当前角色无权操作产品表达规则包，请联系知识库 / 产品表达维护人员或工作台运营。"
      },
      { status: 403 }
    );
  }

  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "regenerate";
  const result =
    action === "activate"
      ? activateProductExpressionRuleDraft(params.id)
      : action === "discard"
        ? discardProductExpressionRuleDraft(params.id)
      : action === "rollback"
        ? rollbackProductExpressionRuleDraft(params.id)
        : regenerateProductExpressionRuleDraft(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
