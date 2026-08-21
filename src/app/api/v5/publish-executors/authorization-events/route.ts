import { NextResponse } from "next/server";
import { recordExecutorAuthorizationEvent } from "@/lib/v5/channel-account-connection-service";
import { assertExecutorOwnsAuthorizationSession, requireBrowserExecutor } from "@/lib/v5/browser-executor-pool";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5GovernanceRepositoryError } from "@/lib/v5/knowledge-governance-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const executor = await requireBrowserExecutor(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const allowed = new Set(["window_opened", "waiting_for_login", "manual_takeover_required", "account_detected", "permission_checked", "failed"]);
    const eventType = String(body.eventType || "");
    if (!allowed.has(eventType)) throw new V5GovernanceRepositoryError("publish_executor_event_invalid", "执行节点事件类型无效。", 422);
    const authorizationSessionId = String(body.authorizationSessionId || "");
    await assertExecutorOwnsAuthorizationSession(executor, authorizationSessionId);
    const session = await recordExecutorAuthorizationEvent({
      sessionId: authorizationSessionId,
      eventType: eventType as Parameters<typeof recordExecutorAuthorizationEvent>[0]["eventType"],
      payload: body.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : undefined
    });
    return NextResponse.json({ ok: true, session }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
