import { readRequestPayload } from "@/lib/api-utils";
import {
  activateProductExpressionRuleDraft,
  discardProductExpressionRuleDraft,
  regenerateProductExpressionRuleDraft,
  rollbackProductExpressionRuleDraft
} from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
