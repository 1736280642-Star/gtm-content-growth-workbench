import { activateDistilledTermRuleDraft, discardDistilledTermRuleDraft } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = activateDistilledTermRuleDraft(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = discardDistilledTermRuleDraft(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
