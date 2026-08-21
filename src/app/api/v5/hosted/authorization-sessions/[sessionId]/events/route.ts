import { listChannelAuthorizationEvents, readChannelAuthorizationSession } from "@/lib/v5/channel-account-connection-service";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const identity = await requireHostedIdentity(request);
  const { sessionId } = await params;
  await readChannelAuthorizationSession(identity, sessionId);
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      let sequence = Number(new URL(request.url).searchParams.get("after") || 0);
      const startedAt = Date.now();
      const push = (event: string, data: unknown, id?: number) => {
        controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      push("ready", { sessionId });
      while (!cancelled && Date.now() - startedAt < 25_000) {
        const events = await listChannelAuthorizationEvents(identity, sessionId, sequence);
        for (const event of events) {
          sequence = event.sequence;
          push(event.eventType, event, event.sequence);
        }
        const session = await readChannelAuthorizationSession(identity, sessionId);
        if (["confirmed", "failed", "expired", "cancelled"].includes(session.status)) {
          push("terminal", { status: session.status, session });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!cancelled) controller.close();
    },
    cancel() { cancelled = true; }
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive"
    }
  });
}

