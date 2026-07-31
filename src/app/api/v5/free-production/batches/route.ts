import { NextResponse } from "next/server";
import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { listFreeProductionBatches } from "@/lib/v5/free-production-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: await listFreeProductionBatches() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}
