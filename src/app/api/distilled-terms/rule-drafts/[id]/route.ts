import { activateDistilledTermRuleDraft, discardDistilledTermRuleDraft } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(_request: Request, { params }: { params: { id: string } }) {
  const result = activateDistilledTermRuleDraft(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = discardDistilledTermRuleDraft(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
