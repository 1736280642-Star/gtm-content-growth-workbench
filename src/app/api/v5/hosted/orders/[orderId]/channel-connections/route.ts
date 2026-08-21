import { NextResponse } from "next/server";
import {
  createChannelAuthorizationSession,
  listOrderChannelConnections
} from "@/lib/v5/channel-account-connection-service";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const identity = await requireHostedIdentity(request);
    const { orderId } = await params;
    return NextResponse.json({ ok: true, channels: await listOrderChannelConnections(identity, orderId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const identity = await requireHostedIdentity(request);
    const { orderId } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await createChannelAuthorizationSession({
      identity,
      orderId,
      channel: String(body.channel || ""),
      executorType: body.executorType ? String(body.executorType) : undefined,
      connectorDeviceId: body.connectorDeviceId ? String(body.connectorDeviceId) : undefined
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

