import { NextResponse } from "next/server";
import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { getFreeProductionBatch } from "@/lib/v5/free-production-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ ok: true, data: await getFreeProductionBatch(params.id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}
