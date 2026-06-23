import { generateDraftForTask } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const result = await generateDraftForTask(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
