import { getWechatsyncStatus } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getWechatsyncStatus();

  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
