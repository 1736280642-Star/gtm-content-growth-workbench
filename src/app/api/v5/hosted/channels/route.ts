import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { listHostedChannelOptions } from "@/lib/v5/hosted-channel-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const productId = new URL(request.url).searchParams.get("productId")?.trim() || undefined;
    return NextResponse.json(
      { ok: true, channels: await listHostedChannelOptions(productId) },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
