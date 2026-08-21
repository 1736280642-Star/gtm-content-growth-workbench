import { NextResponse } from "next/server";
import { confirmDetectedPublishAccount } from "@/lib/v5/channel-account-connection-service";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5GovernanceRepositoryError } from "@/lib/v5/knowledge-governance-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const identity = await requireHostedIdentity(request);
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || body.idempotencyKey || "").trim();
    if (!idempotencyKey || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      throw new V5GovernanceRepositoryError("invalid_contract", "expectedVersion 和幂等提交标识为必填项。", 400);
    }
    const result = await confirmDetectedPublishAccount({
      identity,
      sessionId,
      expectedVersion: Number(body.expectedVersion),
      idempotencyKey: `${identity.workspaceId}:${idempotencyKey}`
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
