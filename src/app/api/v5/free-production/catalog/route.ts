import { NextResponse } from "next/server";
import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { getFreeProductionCatalog } from "@/lib/v5/free-production-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: await getFreeProductionCatalog() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}
