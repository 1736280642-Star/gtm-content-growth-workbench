import { approveDraft } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = approveDraft(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
