import { NextResponse } from "next/server";
import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { getFreeContentExpressionType } from "@/lib/v5/free-content-expression-type-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try { return NextResponse.json({ ok: true, data: await getFreeContentExpressionType(routeParams.id) }); }
  catch (error) { return freeProductionErrorResponse(error); }
}
