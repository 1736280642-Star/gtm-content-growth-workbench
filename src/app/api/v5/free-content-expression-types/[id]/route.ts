import { NextResponse } from "next/server";
import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { getFreeContentExpressionType } from "@/lib/v5/free-content-expression-type-service";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json({ ok: true, data: await getFreeContentExpressionType(params.id) }); }
  catch (error) { return freeProductionErrorResponse(error); }
}
