import { NextRequest, NextResponse } from "next/server";
import { compactMonthlyWorkspace, getMonthlyWorkspaceReadModel } from "@/lib/v5/monthly-workspace-read-model";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const model = compactMonthlyWorkspace(await getMonthlyWorkspaceReadModel(request.nextUrl.searchParams.get("month") || undefined));
  return NextResponse.json({ ok: true, data: { month: model.month, productionTasks: model.productionTasks, batchQueueItems: model.batchQueueItems } }, { headers: { "cache-control": "no-store" } });
}
