import { NextResponse } from "next/server";
import { heartbeatBrowserExecutor, requireBrowserExecutor } from "@/lib/v5/browser-executor-pool";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await requireBrowserExecutor(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return NextResponse.json(await heartbeatBrowserExecutor(identity, {
      adapterVersion: body.adapterVersion ? String(body.adapterVersion) : undefined,
      capacity: body.capacity ? Number(body.capacity) : undefined,
      supportedChannels: Array.isArray(body.supportedChannels) ? body.supportedChannels.map(String) : undefined
    }));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

