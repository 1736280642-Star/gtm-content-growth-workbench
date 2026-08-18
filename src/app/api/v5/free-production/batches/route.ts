import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { deleteFreeProductionBatches, listFreeProductionBatches } from "@/lib/v5/free-production-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: await listFreeProductionBatches() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await readFreeProductionPayload(request);
    const items = Array.isArray(payload.items)
      ? payload.items.map((item) => {
          const value = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
          return { id: typeof value.id === "string" ? value.id : "", expectedVersion: Number(value.expectedVersion) };
        })
      : [];
    const data = await deleteFreeProductionBatches(
      { items, auditReason: typeof payload.auditReason === "string" ? payload.auditReason : "" },
      request.headers.get("x-idempotency-key")
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}
