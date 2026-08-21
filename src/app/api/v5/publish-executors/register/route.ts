import { NextResponse } from "next/server";
import { registerBrowserExecutor } from "@/lib/v5/browser-executor-pool";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const executorType = body.executorType === "desktop_connector" ? "desktop_connector" : "cloud_browser";
    const result = await registerBrowserExecutor({
      executorType,
      displayName: String(body.displayName || "Browser Executor"),
      supportedChannels: Array.isArray(body.supportedChannels) ? body.supportedChannels.map(String) : [],
      capacity: Number(body.capacity || 1),
      pairingCode: body.pairingCode ? String(body.pairingCode) : undefined,
      registrationSecret: body.registrationSecret ? String(body.registrationSecret) : undefined
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

