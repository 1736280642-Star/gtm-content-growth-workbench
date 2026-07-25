import { verifyPublishSchedule } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const result = await verifyPublishSchedule(params.id);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 409 : 400 });
}
