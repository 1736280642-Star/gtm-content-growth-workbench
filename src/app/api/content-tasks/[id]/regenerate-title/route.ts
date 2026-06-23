import { regenerateContentTaskTitle } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export function POST(_: Request, { params }: { params: { id: string } }) {
  const result = regenerateContentTaskTitle(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
