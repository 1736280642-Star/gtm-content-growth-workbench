import { NextRequest, NextResponse } from "next/server";
import { getMonthlyWorkspaceReadModel } from "@/lib/v5/monthly-workspace-read-model";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const model = await getMonthlyWorkspaceReadModel(request.nextUrl.searchParams.get("month") || undefined);
  const { productionTasks: _productionTasks, batchQueueItems: _batchQueueItems, ...summary } = model;
  return NextResponse.json({ ok: true, data: summary }, { headers: { "cache-control": "no-store" } });
}
