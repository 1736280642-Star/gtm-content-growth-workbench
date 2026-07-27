import { NextResponse } from "next/server";
import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { getPublishingChannelReadiness } from "@/lib/v5/free-production-service";

export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json({ ok: true, data: getPublishingChannelReadiness() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return freeProductionErrorResponse(error); }
}
