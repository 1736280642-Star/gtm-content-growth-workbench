import { readRequestPayload } from "@/lib/api-utils";
import {
  activateProductExpressionRuleDraft,
  discardProductExpressionRuleDraft,
  regenerateProductExpressionRuleDraft,
  rollbackProductExpressionRuleDraft
} from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "regenerate";
  const result =
    action === "activate"
      ? activateProductExpressionRuleDraft(routeParams.id)
      : action === "discard"
        ? discardProductExpressionRuleDraft(routeParams.id)
      : action === "rollback"
        ? rollbackProductExpressionRuleDraft(routeParams.id)
        : regenerateProductExpressionRuleDraft(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
