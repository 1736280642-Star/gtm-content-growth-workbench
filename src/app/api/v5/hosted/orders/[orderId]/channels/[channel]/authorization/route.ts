import { NextResponse } from "next/server";
import { openHostedChannelAuthorization } from "@/lib/v5/hosted-channel-authorization-service";
import { readTrustedServerActor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string; channel: string }> }) {
  try {
    const trusted = readTrustedServerActor("product_owner");
    if (process.env.NODE_ENV === "production" && !trusted) {
      throw new V5GovernanceServiceError("authorization_not_configured", "生产环境尚未配置可信用户身份。", 503);
    }
    const { orderId, channel } = await params;
    const result = await openHostedChannelAuthorization({ orderId, channel });
    return NextResponse.json(
      { ok: result.ok, authorization: result },
      { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
